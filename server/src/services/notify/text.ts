import type { FetchLike, SendResult } from "../automation/types.js";
import { gcrConfigured, readNextgentConfig, type NextgentConfig } from "../nextgent-config.js";
import { signNextgentRequest, splitRequestUrl } from "../nextgent-service-signing.js";

/**
 * Platform texts (DECISIONS #85): there is one telephony integration and it
 * lives in gcr-api-clean, so Paperclip asks it to send from the platform
 * number through the signed endpoint
 *
 *   POST /api/nextgent/platform-text   { companyId, to, body, kind?, ref? }
 *
 * which answers { sent: true, id } (200), { sent: false, reason: "opted_out" }
 * (200, a rule) or { sent: false, reason } (502). The company must be linked
 * to a business (409 otherwise). Without GCR_API_URL / NEXTGENT_SERVICE_SECRET
 * every text is skipped with reason "text_unconfigured".
 */
export const PLATFORM_TEXT_PATH = "/api/nextgent/platform-text";

export interface PlatformTextRequest {
  companyId: string;
  to: string;
  body: string;
  kind?: string | null;
  ref?: string | null;
}

export interface TextSender {
  send(request: PlatformTextRequest): Promise<SendResult>;
}

export function platformTextSender(options: { config?: NextgentConfig; fetch?: FetchLike } = {}): TextSender {
  const config = options.config ?? readNextgentConfig();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(request) {
      if (!gcrConfigured(config)) return { success: false, reason: "text_unconfigured" };
      const body: Record<string, unknown> = { companyId: request.companyId, to: request.to, body: request.body };
      if (request.kind) body.kind = request.kind;
      if (request.ref) body.ref = request.ref;
      const rawBody = JSON.stringify(body);
      const url = `${config.gcrApiUrl}${PLATFORM_TEXT_PATH}`;
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...signNextgentRequest(config.serviceSecret, { method: "POST", ...splitRequestUrl(url), rawBody }),
          },
          body: rawBody,
        });
        const text = await response.text();
        let parsed: { sent?: boolean; id?: string | null; reason?: string; error?: string } | null = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (parsed?.sent === true) return { success: true, id: parsed.id ?? null };
        return { success: false, reason: parsed?.reason || parsed?.error || `http_${response.status}` };
      } catch (error) {
        return { success: false, reason: (error as Error).message };
      }
    },
  };
}
