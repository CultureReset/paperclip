import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Service-to-service signing between Paperclip and gcr-api-clean (both
 * directions). Contract §3:
 *   x-nextgent-timestamp: unix seconds
 *   x-nextgent-nonce:     random, at least 16 bytes, hex
 *   x-nextgent-signature: hex HMAC-SHA256 of
 *     `${timestamp}\n${nonce}\n${METHOD}\n${pathname}\n${query}\n${sha256hex(rawBody)}`
 *   (METHOD upper-case, query without its leading "?", "" when there is none,
 *   rawBody "" when there is none).
 * Rejected when older than 300 s (either direction), when the nonce was seen
 * before inside that window (replay), or when the signature does not match
 * (constant-time compare).
 *
 * The previous format (`${timestamp}.${rawBody}`, no nonce, replayable for
 * 300 s) is accepted only when NEXTGENT_ACCEPT_LEGACY_SIGNATURES is set,
 * for the switch-over; it is off by default.
 */
export const NEXTGENT_TIMESTAMP_HEADER = "x-nextgent-timestamp";
export const NEXTGENT_NONCE_HEADER = "x-nextgent-nonce";
export const NEXTGENT_SIGNATURE_HEADER = "x-nextgent-signature";
export const NEXTGENT_SIGNATURE_MAX_AGE_SECONDS = 300;
export const NEXTGENT_NONCE_MIN_BYTES = 16;

/** The parts of a request that are signed. */
export interface NextgentSignedRequest {
  method: string;
  /** Path only, e.g. "/api/nextgent/receipts". */
  pathname: string;
  /** Raw query string without the leading "?"; "" or undefined when there is none. */
  query?: string;
  rawBody?: string | Buffer;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Split a request target into the signed pathname and raw query. Takes a
 * path ("/x/y?a=1") or an absolute URL ("https://host/x/y?a=1"); nothing is
 * re-encoded, so both sides sign the same bytes.
 */
export function splitRequestUrl(target: string): { pathname: string; query: string } {
  let rest = target;
  const scheme = rest.indexOf("://");
  if (scheme !== -1) {
    const pathStart = rest.indexOf("/", scheme + 3);
    rest = pathStart === -1 ? "/" : rest.slice(pathStart);
  }
  const hash = rest.indexOf("#");
  if (hash !== -1) rest = rest.slice(0, hash);
  const q = rest.indexOf("?");
  if (q === -1) return { pathname: rest || "/", query: "" };
  return { pathname: rest.slice(0, q) || "/", query: rest.slice(q + 1) };
}

/** The exact string both sides sign. */
export function nextgentSigningString(timestamp: string, nonce: string, request: NextgentSignedRequest): string {
  return [
    timestamp,
    nonce,
    request.method.toUpperCase(),
    request.pathname,
    request.query ?? "",
    sha256Hex(request.rawBody ?? ""),
  ].join("\n");
}

function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function newNextgentNonce(): string {
  return randomBytes(NEXTGENT_NONCE_MIN_BYTES).toString("hex");
}

/** Headers for an outgoing signed request. */
export function signNextgentRequest(
  secret: string,
  request: NextgentSignedRequest,
  options: { nowSeconds?: number; nonce?: string } = {},
): Record<string, string> {
  const timestamp = String(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? newNextgentNonce();
  return {
    [NEXTGENT_TIMESTAMP_HEADER]: timestamp,
    [NEXTGENT_NONCE_HEADER]: nonce,
    [NEXTGENT_SIGNATURE_HEADER]: hmacHex(secret, nextgentSigningString(timestamp, nonce, request)),
  };
}

/**
 * Nonces seen inside the acceptance window. In memory, so it covers one
 * server process: a multi-instance deployment needs a shared store behind
 * this interface for the guard to hold across instances.
 */
export interface NextgentNonceStore {
  /** Record `nonce` as seen; true when it had already been seen (a replay). */
  seen(nonce: string, nowSeconds: number): boolean;
}

export function createNextgentNonceStore(maxAgeSeconds = NEXTGENT_SIGNATURE_MAX_AGE_SECONDS): NextgentNonceStore {
  const expiresAt = new Map<string, number>();
  return {
    seen(nonce, nowSeconds) {
      // A nonce can only be replayed while its timestamp is still accepted:
      // keep it for the whole window on either side of "now".
      for (const [key, at] of expiresAt) if (at <= nowSeconds) expiresAt.delete(key);
      if (expiresAt.has(nonce)) return true;
      expiresAt.set(nonce, nowSeconds + 2 * maxAgeSeconds);
      return false;
    },
  };
}

const defaultNonceStore = createNextgentNonceStore();

export type NextgentSignatureFailure = "missing" | "stale" | "mismatch" | "replayed" | "unconfigured";

function constantTimeEqualHex(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(providedHex, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function verifyNextgentSignature(input: {
  secret: string | null;
  request: NextgentSignedRequest;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  nowSeconds?: number;
  nonces?: NextgentNonceStore;
  /** Accept the old `${timestamp}.${rawBody}` signature without a nonce (NEXTGENT_ACCEPT_LEGACY_SIGNATURES). */
  acceptLegacy?: boolean;
}): { ok: true } | { ok: false; reason: NextgentSignatureFailure } {
  if (!input.secret) return { ok: false, reason: "unconfigured" };
  const timestamp = input.timestamp?.trim() ?? "";
  const nonce = input.nonce?.trim().toLowerCase() ?? "";
  const signature = input.signature?.trim().toLowerCase() ?? "";
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "stale" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > NEXTGENT_SIGNATURE_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };

  if (!nonce) {
    if (!input.acceptLegacy) return { ok: false, reason: "missing" };
    const legacy = createHmac("sha256", input.secret).update(`${timestamp}.`).update(input.request.rawBody ?? "").digest("hex");
    return constantTimeEqualHex(legacy, signature) ? { ok: true } : { ok: false, reason: "mismatch" };
  }

  if (!/^[0-9a-f]+$/.test(nonce) || nonce.length < NEXTGENT_NONCE_MIN_BYTES * 2) return { ok: false, reason: "missing" };
  const expected = hmacHex(input.secret, nextgentSigningString(timestamp, nonce, input.request));
  if (!constantTimeEqualHex(expected, signature)) return { ok: false, reason: "mismatch" };
  // Only a correctly signed nonce is recorded, so junk cannot fill the store.
  if ((input.nonces ?? defaultNonceStore).seen(nonce, now)) return { ok: false, reason: "replayed" };
  return { ok: true };
}
