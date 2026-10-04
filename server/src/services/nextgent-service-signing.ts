import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Service-to-service signing between Paperclip and gcr-api-clean (both
 * directions). Contract §3:
 *   x-nextgent-timestamp: unix seconds
 *   x-nextgent-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 * Rejected when older than 300 s or when the signature does not match
 * (constant-time compare).
 */
export const NEXTGENT_TIMESTAMP_HEADER = "x-nextgent-timestamp";
export const NEXTGENT_SIGNATURE_HEADER = "x-nextgent-signature";
export const NEXTGENT_SIGNATURE_MAX_AGE_SECONDS = 300;

export function signNextgentBody(secret: string, rawBody: string | Buffer, nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = String(nowSeconds);
  const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return {
    [NEXTGENT_TIMESTAMP_HEADER]: timestamp,
    [NEXTGENT_SIGNATURE_HEADER]: signature,
  };
}

export type NextgentSignatureFailure = "missing" | "stale" | "mismatch" | "unconfigured";

export function verifyNextgentSignature(input: {
  secret: string | null;
  rawBody: string | Buffer | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: NextgentSignatureFailure } {
  if (!input.secret) return { ok: false, reason: "unconfigured" };
  const timestamp = input.timestamp?.trim() ?? "";
  const signature = input.signature?.trim().toLowerCase() ?? "";
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "stale" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > NEXTGENT_SIGNATURE_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.`)
    .update(input.rawBody ?? "")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
