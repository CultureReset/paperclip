import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  NEXTGENT_SIGNATURE_HEADER,
  NEXTGENT_TIMESTAMP_HEADER,
  signNextgentBody,
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

describe("NEXT GENT service signing (contract §3)", () => {
  it("signs `${timestamp}.${rawBody}` and verifies the same bytes", () => {
    const body = JSON.stringify({ companyId: "c1", action: "x" });
    const headers = signNextgentBody(SECRET, body, 1_000);
    expect(headers[NEXTGENT_TIMESTAMP_HEADER]).toBe("1000");
    expect(headers[NEXTGENT_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyNextgentSignature({
        secret: SECRET,
        rawBody: Buffer.from(body),
        timestamp: headers[NEXTGENT_TIMESTAMP_HEADER],
        signature: headers[NEXTGENT_SIGNATURE_HEADER],
        nowSeconds: 1_100,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a changed body, a wrong secret, a stale timestamp and missing headers", () => {
    const body = "{\"a\":1}";
    const headers = signNextgentBody(SECRET, body, 1_000);
    const base = { timestamp: headers[NEXTGENT_TIMESTAMP_HEADER], signature: headers[NEXTGENT_SIGNATURE_HEADER] };
    expect(verifyNextgentSignature({ secret: SECRET, rawBody: "{\"a\":2}", ...base, nowSeconds: 1_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyNextgentSignature({ secret: "other", rawBody: body, ...base, nowSeconds: 1_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyNextgentSignature({ secret: SECRET, rawBody: body, ...base, nowSeconds: 1_301 })).toEqual({ ok: false, reason: "stale" });
    expect(verifyNextgentSignature({ secret: SECRET, rawBody: body, ...base, nowSeconds: 699 })).toEqual({ ok: false, reason: "stale" });
    expect(verifyNextgentSignature({ secret: SECRET, rawBody: body, timestamp: undefined, signature: base.signature })).toEqual({ ok: false, reason: "missing" });
    expect(verifyNextgentSignature({ secret: null, rawBody: body, ...base })).toEqual({ ok: false, reason: "unconfigured" });
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
  });
});
