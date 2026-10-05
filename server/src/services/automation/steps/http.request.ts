import { asObject, truncate } from "../template.js";
import type { StepModule } from "../types.js";

/** AUTOMATION_HTTP_TIMEOUT_MS: how long a call may take; default 10000. */
export function httpTimeoutMs(env: Record<string, string | undefined>): number {
  const n = Number(env.AUTOMATION_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10000;
}

/** Calls any URL from this server, so only the platform's builder has it (adminOnly). */
export const httpRequest: StepModule = {
  type: "http.request",
  async run({ config, dryRun, deps }) {
    const url = String(config.url ?? "");
    if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
    const method = String(config.method || "POST").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(asObject(config.headers) as Record<string, string>) };
    const body = method === "GET" ? undefined : JSON.stringify(asObject(config.body));
    if (dryRun) return { dry_run: true, would_call: { method, url, body: asObject(config.body) } };

    const timeout = httpTimeoutMs(deps.env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await deps.fetch(url, { method, headers, body, signal: controller.signal });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      return { status: res.status, ok: res.ok, body: truncate(parsed) };
    } catch (e) {
      throw new Error((e as Error).name === "AbortError" ? `timed out after ${Math.round(timeout / 1000)}s` : (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  },
};
