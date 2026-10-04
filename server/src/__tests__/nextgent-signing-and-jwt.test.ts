import { createHmac, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNextgentNonceStore,
  NEXTGENT_NONCE_HEADER,
  NEXTGENT_SIGNATURE_HEADER,
  NEXTGENT_TIMESTAMP_HEADER,
  nextgentSigningString,
  sha256Hex,
  signNextgentRequest,
  splitRequestUrl,
  verifyNextgentSignature,
} from "../services/nextgent-service-signing.js";
import {
  BUSINESS_TOKEN_AUDIENCE,
  businessTokenJwks,
  loadSigningKey,
  resetBusinessTokenKeyForTests,
  signBusinessToken,
} from "../services/nextgent-business-jwt.js";
import { readNextgentConfig } from "../services/nextgent-config.js";

const SECRET = "test-shared-secret";
const NONCE = "0123456789abcdef0123456789abcdef";

describe("NEXT GENT service signing (contract §3)", () => {
  const post = (rawBody: string) => ({ method: "post", pathname: "/api/nextgent/receipts", query: "", rawBody });

  it("signs timestamp, nonce, method, path, query and body hash, and verifies the same request", () => {
    const body = JSON.stringify({ companyId: "c1", action: "x" });
    const headers = signNextgentRequest(SECRET, post(body), { nowSeconds: 1_000, nonce: NONCE });
    expect(headers[NEXTGENT_TIMESTAMP_HEADER]).toBe("1000");
    expect(headers[NEXTGENT_NONCE_HEADER]).toBe(NONCE);
    expect(headers[NEXTGENT_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect(nextgentSigningString("1000", NONCE, post(body))).toBe(`1000\n${NONCE}\nPOST\n/api/nextgent/receipts\n\n${sha256Hex(body)}`);
    expect(
      verifyNextgentSignature({
        secret: SECRET,
        request: { ...post(""), rawBody: Buffer.from(body) },
        timestamp: headers[NEXTGENT_TIMESTAMP_HEADER],
        nonce: headers[NEXTGENT_NONCE_HEADER],
        signature: headers[NEXTGENT_SIGNATURE_HEADER],
        nowSeconds: 1_100,
        nonces: createNextgentNonceStore(),
      }),
    ).toEqual({ ok: true });
  });

  it("generates a fresh nonce of at least 16 bytes per request", () => {
    const a = signNextgentRequest(SECRET, post(""));
    const b = signNextgentRequest(SECRET, post(""));
    expect(a[NEXTGENT_NONCE_HEADER]).toMatch(/^[0-9a-f]{32,}$/);
    expect(a[NEXTGENT_NONCE_HEADER]).not.toBe(b[NEXTGENT_NONCE_HEADER]);
  });

  it("rejects a replay of the same signed request", () => {
    const body = "{\"a\":1}";
    const headers = signNextgentRequest(SECRET, post(body), { nowSeconds: 1_000, nonce: NONCE });
    const nonces = createNextgentNonceStore();
    const input = {
      secret: SECRET,
      request: post(body),
      timestamp: headers[NEXTGENT_TIMESTAMP_HEADER],
      nonce: headers[NEXTGENT_NONCE_HEADER],
      signature: headers[NEXTGENT_SIGNATURE_HEADER],
      nowSeconds: 1_001,
      nonces,
    };
    expect(verifyNextgentSignature(input)).toEqual({ ok: true });
    expect(verifyNextgentSignature(input)).toEqual({ ok: false, reason: "replayed" });
    // A wrong signature with a fresh nonce never records that nonce.
    const other = { ...input, nonce: "ffffffffffffffffffffffffffffffff", signature: "0".repeat(64) };
    expect(verifyNextgentSignature(other)).toEqual({ ok: false, reason: "mismatch" });
    const good = signNextgentRequest(SECRET, post(body), { nowSeconds: 1_000, nonce: other.nonce });
    expect(verifyNextgentSignature({ ...other, signature: good[NEXTGENT_SIGNATURE_HEADER] })).toEqual({ ok: true });
  });

  it("rejects a changed body, method, path or query, a wrong secret, a stale timestamp and missing headers", () => {
    const body = "{\"a\":1}";
    const headers = signNextgentRequest(SECRET, post(body), { nowSeconds: 1_000, nonce: NONCE });
    const base = {
      timestamp: headers[NEXTGENT_TIMESTAMP_HEADER],
      nonce: headers[NEXTGENT_NONCE_HEADER],
      signature: headers[NEXTGENT_SIGNATURE_HEADER],
      nowSeconds: 1_000,
    };
    const verify = (overrides: Partial<Parameters<typeof verifyNextgentSignature>[0]>) =>
      verifyNextgentSignature({ secret: SECRET, request: post(body), ...base, nonces: createNextgentNonceStore(), ...overrides });
    expect(verify({ request: post("{\"a\":2}") })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ request: { ...post(body), method: "PUT" } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ request: { ...post(body), pathname: "/api/nextgent/conversations" } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ request: { ...post(body), query: "x=1" } })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ secret: "other" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verify({ nowSeconds: 1_301 })).toEqual({ ok: false, reason: "stale" });
    expect(verify({ nowSeconds: 699 })).toEqual({ ok: false, reason: "stale" });
    expect(verify({ timestamp: undefined })).toEqual({ ok: false, reason: "missing" });
    expect(verify({ nonce: undefined })).toEqual({ ok: false, reason: "missing" });
    expect(verify({ nonce: "abcd" })).toEqual({ ok: false, reason: "missing" });
    expect(verify({ secret: null })).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("accepts the old `${timestamp}.${rawBody}` format only behind NEXTGENT_ACCEPT_LEGACY_SIGNATURES", () => {
    const body = "{\"a\":1}";
    const legacy = createHmac("sha256", SECRET).update(`1000.${body}`).digest("hex");
    const input = { secret: SECRET, request: post(body), timestamp: "1000", nonce: undefined, signature: legacy, nowSeconds: 1_000 };
    expect(verifyNextgentSignature(input)).toEqual({ ok: false, reason: "missing" });
    expect(verifyNextgentSignature({ ...input, acceptLegacy: true })).toEqual({ ok: true });
    expect(verifyNextgentSignature({ ...input, acceptLegacy: true, request: post("{}") })).toEqual({ ok: false, reason: "mismatch" });
    expect(readNextgentConfig({}).acceptLegacySignatures).toBe(false);
    expect(readNextgentConfig({ NEXTGENT_ACCEPT_LEGACY_SIGNATURES: "true" }).acceptLegacySignatures).toBe(true);
    expect(readNextgentConfig({ NEXTGENT_ACCEPT_LEGACY_SIGNATURES: "false" }).acceptLegacySignatures).toBe(false);
  });

  it("splits paths and absolute URLs into pathname and raw query without re-encoding", () => {
    expect(splitRequestUrl("/api/nextgent/receipts")).toEqual({ pathname: "/api/nextgent/receipts", query: "" });
    expect(splitRequestUrl("/api/nextgent/entitlement?companyId=c%201&itemKey=k")).toEqual({ pathname: "/api/nextgent/entitlement", query: "companyId=c%201&itemKey=k" });
    expect(splitRequestUrl("https://gcr.example.test/base/api/x?a=1")).toEqual({ pathname: "/base/api/x", query: "a=1" });
    expect(splitRequestUrl("https://gcr.example.test")).toEqual({ pathname: "/", query: "" });
  });
});

function decode(token: string) {
  const [header, claims, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString()),
    signingInput: `${header}.${claims}`,
    signature: Buffer.from(signature, "base64url"),
  };
}

describe("business token (contract §1)", () => {
  const original = process.env.NEXTGENT_JWT_PRIVATE_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXTGENT_JWT_PRIVATE_KEY;
    else process.env.NEXTGENT_JWT_PRIVATE_KEY = original;
    resetBusinessTokenKeyForTests();
  });

  it("signs EdDSA tokens that verify against the published JWKS key", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.NEXTGENT_JWT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    resetBusinessTokenKeyForTests();
    const { token, expiresAt } = signBusinessToken({
      issuer: "https://paperclip.example.test",
      userId: "user-1",
      companyId: "company-1",
      role: "owner",
      ttlSeconds: 300,
      nowSeconds: 1_000,
    });
    const decoded = decode(token);
    expect(decoded.header.alg).toBe("EdDSA");
    expect(decoded.claims).toEqual({
      iss: "https://paperclip.example.test",
      aud: BUSINESS_TOKEN_AUDIENCE,
      sub: "user-1",
      company_id: "company-1",
      role: "owner",
      iat: 1_000,
      exp: 1_300,
    });
    expect(expiresAt).toBe(new Date(1_300_000).toISOString());
    const jwks = businessTokenJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe(decoded.header.kid);
    expect(jwks.keys[0]).not.toHaveProperty("d");
    const publicKey = createPublicKey({ key: jwks.keys[0] as never, format: "jwk" });
    expect(verify(null, Buffer.from(decoded.signingInput), publicKey, decoded.signature)).toBe(true);
  });

  it("supports RS256 keys from PEM with escaped newlines", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.NEXTGENT_JWT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString().replace(/\n/g, "\\n");
    resetBusinessTokenKeyForTests();
    const { token } = signBusinessToken({ issuer: "i", userId: "u", companyId: "c", role: "member", ttlSeconds: 60 });
    const decoded = decode(token);
    expect(decoded.header.alg).toBe("RS256");
    const publicKey = createPublicKey({ key: businessTokenJwks().keys[0] as never, format: "jwk" });
    expect(verify("sha256", Buffer.from(decoded.signingInput), publicKey, decoded.signature)).toBe(true);
  });

  it("never issues a token living longer than 300 seconds", () => {
    const { claims } = signBusinessToken({ issuer: "i", userId: "u", companyId: "c", role: "member", ttlSeconds: 86_400, nowSeconds: 0 });
    expect(claims.exp - claims.iat).toBe(300);
    expect(readNextgentConfig({ NEXTGENT_BUSINESS_TOKEN_TTL_SECONDS: "9999" }).businessTokenTtlSeconds).toBe(300);
    expect(readNextgentConfig({ NEXTGENT_BUSINESS_TOKEN_TTL_SECONDS: "120" }).businessTokenTtlSeconds).toBe(120);
  });

  it("generates a dev key when none is configured", () => {
    const key = loadSigningKey({});
    expect(key.generated).toBe(true);
    expect(key.alg).toBe("EdDSA");
    expect(loadSigningKey({ NODE_ENV: "test" }).generated).toBe(true);
  });

  it("refuses to generate a key in production: NEXTGENT_JWT_PRIVATE_KEY must be set", () => {
    expect(() => loadSigningKey({ NODE_ENV: "production" })).toThrow(/NEXTGENT_JWT_PRIVATE_KEY/);
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(loadSigningKey({ NODE_ENV: "production", NEXTGENT_JWT_PRIVATE_KEY: pem }).generated).toBe(false);
    // The same check guards the JWKS and every token mint at runtime.
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.NEXTGENT_JWT_PRIVATE_KEY;
    resetBusinessTokenKeyForTests();
    try {
      expect(() => businessTokenJwks()).toThrow(/NEXTGENT_JWT_PRIVATE_KEY/);
      expect(() => signBusinessToken({ issuer: "i", userId: "u", companyId: "c", role: "member", ttlSeconds: 60 })).toThrow(/NEXTGENT_JWT_PRIVATE_KEY/);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });
});
