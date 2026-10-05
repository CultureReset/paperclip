import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import type { NextgentConfig } from "../services/nextgent-config.js";
import { gcrClient, GcrNotConfiguredError } from "../services/nextgent-gcr-client.js";
import { verifyNextgentSignature } from "../services/nextgent-service-signing.js";
import { applyModelGatewayEnv, modelGatewayEnvFor } from "../services/nextgent-model-gateway.js";
import {
  describePermissions,
  newPermissions,
  nextgentSectionOf,
  permissionsOf,
  samePermissions,
} from "../services/nextgent-store.js";
import { parseStorePayload } from "../services/store-content.js";
import { inviteAcceptUrl, sendInviteEmail } from "../services/nextgent-invite-email.js";

const config: NextgentConfig = {
  gcrApiUrl: "https://gcr.example.test",
  serviceSecret: "s3cret",
  publicUrl: null,
  litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null },
  assistant: { name: null, instructionsFile: null, adapterType: null },
  platformCompanyId: null,
  businessTokenTtlSeconds: 300,
  acceptLegacySignatures: false,
  storePricing: { models: [], intervals: [], defaultCurrency: null },
};

function recordingFetch(response: { status?: number; body?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  });
  return { calls, fetch };
}

describe("gcr-api-clean client (contract §4)", () => {
  it("signs every request over its exact body", async () => {
    const { calls, fetch } = recordingFetch({ body: { entitySlug: "biz", forwardingAddress: "f@x.test", businessToken: "t" } });
    const client = gcrClient({ config, fetch });
    await client.link({ companyId: "c1", entitySlug: "biz" });
    expect(calls[0].url).toBe("https://gcr.example.test/api/nextgent/link");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ companyId: "c1", entitySlug: "biz" });
    expect(headers["x-nextgent-nonce"]).toMatch(/^[0-9a-f]{32,}$/);
    expect(
      verifyNextgentSignature({
        secret: "s3cret",
        request: { method: "POST", pathname: "/api/nextgent/link", query: "", rawBody: String(calls[0].init.body) },
        timestamp: headers["x-nextgent-timestamp"],
        nonce: headers["x-nextgent-nonce"],
        signature: headers["x-nextgent-signature"],
      }),
    ).toEqual({ ok: true });
  });

  it("uses the contract paths for installs, uninstall and entitlement", async () => {
    const { calls, fetch } = recordingFetch({ body: { allowed: true } });
    const client = gcrClient({ config, fetch });
    await client.install({ companyId: "c1", installId: "i1", itemKey: "k", kind: "agent", version: "1.0.0", permissions: ["menu:read"] });
    await client.uninstall("i1");
    await client.entitlement("c1", "k");
    await client.unlink({ companyId: "c1", export: true });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "POST https://gcr.example.test/api/nextgent/installs",
      "DELETE https://gcr.example.test/api/nextgent/installs/i1",
      "GET https://gcr.example.test/api/nextgent/entitlement?companyId=c1&itemKey=k",
      "POST https://gcr.example.test/api/nextgent/unlink",
    ]);
    // Bodyless requests are signed over the empty body; the method, path and raw query are part of the signature.
    const signed = (index: number, method: string, pathname: string, query = "") => {
      const headers = calls[index].init.headers as Record<string, string>;
      return verifyNextgentSignature({
        secret: "s3cret",
        request: { method, pathname, query, rawBody: calls[index].init.body ? String(calls[index].init.body) : "" },
        timestamp: headers["x-nextgent-timestamp"],
        nonce: headers["x-nextgent-nonce"],
        signature: headers["x-nextgent-signature"],
      });
    };
    expect(signed(1, "DELETE", "/api/nextgent/installs/i1")).toEqual({ ok: true });
    expect(signed(2, "GET", "/api/nextgent/entitlement", "companyId=c1&itemKey=k")).toEqual({ ok: true });
    expect(signed(2, "GET", "/api/nextgent/entitlement", "")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("patches an install's switch, version and manifest at the contract path, signed like the others", async () => {
    const { calls, fetch } = recordingFetch({ body: { updated: true, projected: true } });
    const client = gcrClient({ config, fetch });
    const app = { schema_version: 1, id: "k", version: "1.1.0", runtime: { type: "engine" }, ui: {}, permissions: [] };
    expect(await client.patchInstall("i1", { version: "1.1.0", app })).toEqual({ updated: true, projected: true });
    await client.patchInstall("i1", { enabled: false });
    const layout = { id: "front-page", version: "2.0.0" };
    await client.patchInstall("i2", { version: "2.0.0", layout });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "PATCH https://gcr.example.test/api/nextgent/installs/i1",
      "PATCH https://gcr.example.test/api/nextgent/installs/i1",
      "PATCH https://gcr.example.test/api/nextgent/installs/i2",
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: "1.1.0", app });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ enabled: false });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ version: "2.0.0", layout });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(
      verifyNextgentSignature({
        secret: "s3cret",
        request: { method: "PATCH", pathname: "/api/nextgent/installs/i1", query: "", rawBody: String(calls[0].init.body) },
        timestamp: headers["x-nextgent-timestamp"],
        nonce: headers["x-nextgent-nonce"],
        signature: headers["x-nextgent-signature"],
      }),
    ).toEqual({ ok: true });
  });

  it("passes client errors through and maps server errors to 502", async () => {
    const notClaimed = gcrClient({ config, fetch: recordingFetch({ status: 409, body: { error: "Business is not claimed" } }).fetch });
    await expect(notClaimed.link({ companyId: "c1", entitySlug: "x" })).rejects.toMatchObject({ status: 409, message: "Business is not claimed" });
    const down = gcrClient({ config, fetch: recordingFetch({ status: 500 }).fetch });
    await expect(down.link({ companyId: "c1", entitySlug: "x" })).rejects.toBeInstanceOf(HttpError);
    await expect(down.link({ companyId: "c1", entitySlug: "x" })).rejects.toMatchObject({ status: 502 });
  });

  it("refuses to call out without its settings", async () => {
    const client = gcrClient({ config: { ...config, serviceSecret: null }, fetch: vi.fn() });
    expect(client.configured).toBe(false);
    await expect(client.entitlement("c1", "k")).rejects.toBeInstanceOf(GcrNotConfiguredError);
  });
});

describe("model gateway env (contract §8)", () => {
  it("points the CLI providers at LiteLLM with the company key", () => {
    expect(modelGatewayEnvFor("https://llm.example.test", "sk-company")).toEqual({
      ANTHROPIC_BASE_URL: "https://llm.example.test",
      ANTHROPIC_API_KEY: "sk-company",
      OPENAI_BASE_URL: "https://llm.example.test/v1",
      OPENAI_API_KEY: "sk-company",
    });
  });

  it("lets explicit run settings win", () => {
    const merged = applyModelGatewayEnv({ ANTHROPIC_API_KEY: "agent-own", OTHER: "x" }, modelGatewayEnvFor("u", "k"));
    expect(merged.ANTHROPIC_API_KEY).toBe("agent-own");
    expect(merged.ANTHROPIC_BASE_URL).toBe("u");
    expect(merged.OTHER).toBe("x");
  });
});

describe("store NEXT GENT section (plan §7)", () => {
  const release = {
    agents: [{ key: "booking", name: "Booking" }],
    nextgent: {
      kind: "agent",
      permissions: [
        { permission: "bookings:write", reason: "Creates bookings" },
        { permission: "availability:read", reason: "Checks what is open" },
      ],
    },
  };

  it("keeps the section through release validation", () => {
    const parsed = parseStorePayload(release);
    expect(nextgentSectionOf(parsed)?.kind).toBe("agent");
    expect(permissionsOf(nextgentSectionOf(parsed))).toEqual(["availability:read", "bookings:write"]);
  });

  it("rejects malformed permissions, agent items without agents and stray hand-offs", () => {
    expect(() => parseStorePayload({ ...release, nextgent: { ...release.nextgent, permissions: [{ permission: "everything", reason: "x" }] } })).toThrow();
    expect(() => parseStorePayload({ nextgent: { kind: "agent", permissions: [] } })).toThrow(/at least one agent/);
    expect(() => parseStorePayload({ ...release, nextgent: { ...release.nextgent, handoff: { agentKey: "booking" } } })).toThrow(/Only automations/);
    expect(() => parseStorePayload({ nextgent: { kind: "automation", handoff: { agentKey: "missing" } } })).toThrow(/unknown agent/);
    expect(parseStorePayload({ nextgent: { kind: "automation", handoff: { agentKey: "review", itemKey: "review-agent" } } }).nextgent?.handoff?.itemKey).toBe(
      "review-agent",
    );
  });

  it("flags new permissions and marks the ones that change things", () => {
    const section = nextgentSectionOf(release);
    expect(newPermissions(["availability:read"], section)).toEqual(["bookings:write"]);
    expect(newPermissions(["availability:read", "bookings:write", "menu:read"], section)).toEqual([]);
    expect(samePermissions(["bookings:write", "availability:read"], permissionsOf(section))).toBe(true);
    expect(samePermissions(["availability:read"], permissionsOf(section))).toBe(false);
    expect(describePermissions(section)).toEqual([
      { permission: "bookings:write", resource: "bookings", action: "write", reason: "Creates bookings", optional: false, changesThings: true },
      { permission: "availability:read", resource: "availability", action: "read", reason: "Checks what is open", optional: false, changesThings: false },
    ]);
    expect(nextgentSectionOf({})).toBeNull();
  });
});

describe("invite email", () => {
  const db = {} as never;
  const input = { companyId: "c1", to: "invitee@example.test", token: "tok en", businessName: "Biz", inviterUserId: null, role: "operator" };

  it("builds the accept link from OWNER_APP_URL", () => {
    expect(inviteAcceptUrl("https://owner.example.test/", "abc")).toBe("https://owner.example.test/#/invite/abc");
  });

  it("asks gcr-api-clean to send the team invite template", async () => {
    const { calls, fetch } = recordingFetch({ body: { sent: true } });
    const result = await sendInviteEmail(db, input, { config, fetch, ownerAppUrl: "https://owner.example.test" });
    expect(result).toEqual({ emailSent: true });
    expect(calls[0].url).toBe("https://gcr.example.test/api/nextgent/email");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      companyId: "c1",
      to: "invitee@example.test",
      template: "team-invite",
      data: { business_name: "Biz", inviter: "Biz", role: "operator", accept_link: "https://owner.example.test/#/invite/tok%20en" },
    });
  });

  it("reports, never throws, when the email cannot go out", async () => {
    expect(await sendInviteEmail(db, input, { config, fetch: recordingFetch({ status: 502, body: { sent: false } }).fetch, ownerAppUrl: "https://o.example.test" })).toMatchObject({ emailSent: false });
    expect(await sendInviteEmail(db, input, { config, fetch: vi.fn(), ownerAppUrl: null })).toMatchObject({ emailSent: false, emailError: expect.stringMatching(/OWNER_APP_URL/) });
    expect(await sendInviteEmail(db, input, { config: { ...config, serviceSecret: null }, fetch: vi.fn(), ownerAppUrl: "https://o.example.test" })).toMatchObject({ emailSent: false });
  });
});
