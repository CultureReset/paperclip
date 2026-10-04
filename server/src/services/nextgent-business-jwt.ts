import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { logger } from "../middleware/logger.js";
import { BUSINESS_TOKEN_MAX_TTL_SECONDS } from "./nextgent-config.js";

/**
 * Short-lived business tokens for screens (contract §1). Paperclip signs,
 * gcr-api-clean verifies against `GET /.well-known/jwks.json`.
 *
 *   header: { alg: "EdDSA" | "RS256", kid, typ: "JWT" }
 *   claims: { iss, aud: "gcr-api-clean", sub, company_id, role, iat, exp }
 *
 * The private key comes from NEXTGENT_JWT_PRIVATE_KEY (PEM, Ed25519 or RSA).
 * Without it a key is generated at start and a warning logged, in dev and
 * test only: in production (NODE_ENV=production) the server refuses, since
 * every restart would invalidate issued tokens and every server instance
 * would publish a different key.
 */

export const BUSINESS_TOKEN_AUDIENCE = "gcr-api-clean";
export type BusinessTokenRole = "owner" | "member" | "instance_admin";

export interface BusinessTokenClaims {
  iss: string;
  aud: typeof BUSINESS_TOKEN_AUDIENCE;
  sub: string;
  /** Absent on an instance-admin token (contract §12). */
  company_id?: string;
  role: BusinessTokenRole;
  iat: number;
  exp: number;
}

interface SigningKey {
  privateKey: KeyObject;
  publicJwk: Record<string, unknown>;
  alg: "EdDSA" | "RS256";
  kid: string;
  generated: boolean;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

/** RFC 7638 JWK thumbprint: a stable kid derived from the public key itself. */
function thumbprint(jwk: Record<string, unknown>): string {
  const members = jwk.kty === "OKP"
    ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x }
    : { e: jwk.e, kty: jwk.kty, n: jwk.n };
  return base64url(createHash("sha256").update(JSON.stringify(members)).digest());
}

function keyFromPrivate(privateKey: KeyObject, generated: boolean): SigningKey {
  const type = privateKey.asymmetricKeyType;
  if (type !== "ed25519" && type !== "rsa") {
    throw new Error(`NEXTGENT_JWT_PRIVATE_KEY must be an Ed25519 or RSA private key (got ${type ?? "unknown"})`);
  }
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, unknown>;
  const alg = type === "ed25519" ? "EdDSA" : "RS256";
  const kid = thumbprint(jwk);
  return { privateKey, publicJwk: { ...jwk, kid, alg, use: "sig" }, alg, kid, generated };
}

/**
 * PEM from env; literal "\n" sequences are accepted for single-line env files.
 * A temporary key is generated only outside production: with NODE_ENV=production
 * a missing key is a configuration error, never a throwaway key.
 */
export function loadSigningKey(env: Record<string, string | undefined> = process.env): SigningKey {
  const pem = env.NEXTGENT_JWT_PRIVATE_KEY?.trim();
  if (pem) return keyFromPrivate(createPrivateKey(pem.replace(/\\n/g, "\n")), false);
  if (env.NODE_ENV === "production") {
    throw new Error(
      "NEXTGENT_JWT_PRIVATE_KEY is not set. In production the business-token signing key must be configured " +
        "(a generated key would change on every restart and differ per instance). Generate one with: openssl genpkey -algorithm ed25519",
    );
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  return keyFromPrivate(privateKey, true);
}

let cached: SigningKey | null = null;

function currentKey(): SigningKey {
  if (!cached) {
    cached = loadSigningKey();
    if (cached.generated) {
      logger.warn(
        "NEXTGENT_JWT_PRIVATE_KEY is not set: generated a temporary business-token signing key. " +
          "Tokens stop verifying on restart and differ per server instance. Set it in production.",
      );
    }
  }
  return cached;
}

/** Test hook: forget the loaded key so the next call re-reads the environment. */
export function resetBusinessTokenKeyForTests() {
  cached = null;
}

/**
 * Startup check: load the key now so a production server without
 * NEXTGENT_JWT_PRIVATE_KEY fails at start with the error above, instead of at
 * the first token mint.
 */
export function assertBusinessTokenKeyLoadable(): void {
  currentKey();
}

export function businessTokenJwks(): { keys: Record<string, unknown>[] } {
  return { keys: [currentKey().publicJwk] };
}

export function signBusinessToken(input: {
  issuer: string;
  userId: string;
  /** null for an instance-admin token, which names no company. */
  companyId: string | null;
  role: BusinessTokenRole;
  ttlSeconds: number;
  nowSeconds?: number;
}): { token: string; expiresAt: string; claims: BusinessTokenClaims } {
  const key = currentKey();
  const iat = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.max(1, Math.min(input.ttlSeconds, BUSINESS_TOKEN_MAX_TTL_SECONDS));
  const claims: BusinessTokenClaims = {
    iss: input.issuer,
    aud: BUSINESS_TOKEN_AUDIENCE,
    sub: input.userId,
    ...(input.companyId ? { company_id: input.companyId } : {}),
    role: input.role,
    iat,
    exp: iat + ttl,
  };
  const header = { alg: key.alg, kid: key.kid, typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = key.alg === "EdDSA"
    ? sign(null, Buffer.from(signingInput), key.privateKey)
    : sign("sha256", Buffer.from(signingInput), key.privateKey);
  return {
    token: `${signingInput}.${base64url(signature)}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    claims,
  };
}
