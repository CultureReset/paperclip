import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  companySecrets,
  createDb,
  issueComments,
  issues,
  nextgentBusinessLinks,
  pluginConfig,
  plugins,
  routines,
  routineTriggers,
  storeInstalls,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import type { NextgentConfig } from "../services/nextgent-config.js";
import { NEXTGENT_SECRET_NAMES } from "../services/nextgent-config.js";
import { nextgentBusinessLinkService } from "../services/nextgent-business-link.js";
import { BUSINESS_PLUGIN_KEY, nextgentBusinessPlugin } from "../services/nextgent-business-plugin.js";
import { nextgentCompanySetup } from "../services/nextgent-company-setup.js";
import { agentService } from "../services/agents.js";
import { companyModelGatewayEnv } from "../services/nextgent-model-gateway.js";
import { nextgentInboundService } from "../services/nextgent-inbound.js";
import { nextgentStoreBridge } from "../services/nextgent-store.js";
import { storeService } from "../services/store.js";
import express from "express";
import request from "supertest";
import { nextgentRoutes } from "../routes/nextgent.js";
import { errorHandler } from "../middleware/index.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;
if (!support.supported) {
  console.warn(`Skipping embedded Postgres NEXT GENT tests on this host: ${support.reason ?? "unsupported environment"}`);
}

const GCR = "https://gcr.example.test";
const LLM = "https://llm.example.test";

function configWith(overrides: Partial<NextgentConfig> = {}): NextgentConfig {
  return {
    gcrApiUrl: GCR,
    serviceSecret: "shared",
    publicUrl: "https://paperclip.example.test",
    litellm: { url: LLM, masterKey: "master", companyBudget: 25, budgetDuration: "30d" },
    assistant: { name: "Assistant", instructionsFile: null, adapterType: "process" },
    platformCompanyId: null,
    businessTokenTtlSeconds: 300,
    acceptLegacySignatures: false,
    storePricing: { models: [], intervals: [], defaultCurrency: null },
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** Stand-in for gcr-api-clean and LiteLLM: answers by "METHOD path". */
function fakeUpstream(answers: Record<string, (body: Record<string, unknown> | null) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    const key = `${method} ${parsed.pathname.replace(/\/api\/nextgent\/installs\/[^/]+(\/session)?$/, "/api/nextgent/installs/:id$1")}`;
    const answer = answers[key];
    if (!answer) return new Response(JSON.stringify({ error: `unexpected ${key}` }), { status: 500 });
    const result = answer(body);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
  });
  return { calls, fetch };
}

describeEmbeddedPostgres("NEXT GENT wiring", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-nextgent-");
    db = createDb(tempDb.connectionString);
    const home = mkdtempSync(path.join(os.tmpdir(), "paperclip-nextgent-home-"));
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(home, "master.key");
    process.env.PAPERCLIP_API_URL = "https://paperclip.example.test";
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE companies, store_items, store_settings, plugins CASCADE`);
  });

  afterAll(async () => {
    process.env = savedEnv;
    await tempDb?.cleanup();
  });

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: prefix, issuePrefix: prefix });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: `owner-${prefix}`,
      status: "active",
      membershipRole: "owner",
    });
    return companyId;
  }

  async function installBusinessPlugin() {
    const [row] = await db
      .insert(plugins)
      .values({ pluginKey: BUSINESS_PLUGIN_KEY, packageName: "plugin", version: "1.0.0", manifestJson: {} as never, status: "ready" })
      .returning();
    return row;
  }

  async function secretByName(companyId: string, name: string) {
    return db
      .select()
      .from(companySecrets)
      .where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.name, name)))
      .then((rows) => rows[0] ?? null);
  }

  it("links a business, keeps the token server-side and writes the plugin config", async () => {
    const companyId = await seedCompany("LNK");
    const plugin = await installBusinessPlugin();
    const { calls, fetch } = fakeUpstream({
      "POST /api/nextgent/link": () => ({ body: { entitySlug: "biz-one", forwardingAddress: "biz-one@in.example.test", kind: "restaurant", businessToken: "gcr_mcp_secret" } }),
      "POST /api/nextgent/unlink": () => ({ body: { exportUrl: "https://export.example.test/biz-one" } }),
    });
    const links = nextgentBusinessLinkService(db, { config: configWith(), fetch });

    const result = await links.link(companyId, { entitySlug: "biz-one" }, "owner-LNK");
    expect(result).toEqual({ entitySlug: "biz-one", forwardingAddress: "biz-one@in.example.test" });
    expect(JSON.stringify(result)).not.toContain("gcr_mcp_secret");
    expect(calls[0].body).toEqual({ companyId, entitySlug: "biz-one" });

    const secret = await secretByName(companyId, NEXTGENT_SECRET_NAMES.businessToken);
    expect(secret?.status).toBe("active");
    const [link] = await db.select().from(nextgentBusinessLinks).where(eq(nextgentBusinessLinks.companyId, companyId));
    // The row is a reference (slug + token secret). The forwarding address and the
    // kind gcr-api-clean answered with are passed through, never stored (DECISIONS #32, #33, #40).
    expect(link).toMatchObject({ entitySlug: "biz-one", businessTokenSecretId: secret?.id });
    expect(Object.keys(link)).not.toContain("forwardingAddress");
    expect(Object.keys(link)).not.toContain("businessKind");
    expect(JSON.stringify(link)).not.toMatch(/restaurant|in\.example\.test/);
    const [config] = await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id));
    expect(config.configJson).toEqual({ apiBaseUrl: GCR, businessToken: { type: "secret_ref", secretId: secret?.id, version: "latest" } });

    // Linking again is idempotent: same secret, rotated value.
    await links.link(companyId, { entitySlug: "biz-one" }, "owner-LNK");
    expect((await secretByName(companyId, NEXTGENT_SECRET_NAMES.businessToken))?.id).toBe(secret?.id);

    const unlinked = await links.unlink(companyId, true, "owner-LNK");
    expect(unlinked).toMatchObject({ unlinked: true, exportUrl: "https://export.example.test/biz-one" });
    expect(calls.at(-1)?.body).toEqual({ companyId, export: true });
    expect(await db.select().from(nextgentBusinessLinks)).toHaveLength(0);
    expect(await secretByName(companyId, NEXTGENT_SECRET_NAMES.businessToken)).toBeNull();
    const [afterConfig] = await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id));
    expect(afterConfig.configJson).toEqual({ apiBaseUrl: GCR });
  });

  it("handles gcr-api-clean returning the business token only once", async () => {
    const companyId = await seedCompany("ONCE");
    let calls = 0;
    const { calls: seen, fetch } = fakeUpstream({
      "POST /api/nextgent/link": (body) => {
        calls += 1;
        // First call: already linked by the claim flow, token issued earlier and lost.
        if (body?.rotateToken === true) return { body: { entitySlug: "once", forwardingAddress: "f", businessToken: "fresh" } };
        return { body: { entitySlug: "once", forwardingAddress: "f", businessToken: null, businessTokenIssued: true } };
      },
    });
    const links = nextgentBusinessLinkService(db, { config: configWith(), fetch });
    await links.link(companyId, { entitySlug: "once" }, null);
    expect(calls).toBe(2);
    expect(seen[1].body).toEqual({ companyId, entitySlug: "once", rotateToken: true });
    const secret = await secretByName(companyId, NEXTGENT_SECRET_NAMES.businessToken);
    expect(secret).toBeTruthy();
    // Linking again keeps the token this server already holds.
    await links.link(companyId, { entitySlug: "once" }, null);
    expect(calls).toBe(3);
    expect((await secretByName(companyId, NEXTGENT_SECRET_NAMES.businessToken))?.id).toBe(secret?.id);
  });

  it("refuses to link a business another company already has", async () => {
    const a = await seedCompany("LKA");
    const b = await seedCompany("LKB");
    const { calls, fetch } = fakeUpstream({
      "POST /api/nextgent/link": () => ({ body: { entitySlug: "shared", forwardingAddress: null, businessToken: "t" } }),
    });
    const links = nextgentBusinessLinkService(db, { config: configWith(), fetch });
    await links.link(a, { entitySlug: "shared" }, null);
    expect(calls).toHaveLength(1);
    await expect(links.link(b, { entitySlug: "shared" }, null)).rejects.toMatchObject({ status: 409 });
    // Refused before gcr-api-clean is asked, so no link or token is left behind there.
    expect(calls).toHaveLength(1);
    expect(await db.select().from(nextgentBusinessLinks).where(eq(nextgentBusinessLinks.companyId, b))).toHaveLength(0);
  });

  it("runs the sign-up setup: LiteLLM key for the company and its assistant, once", async () => {
    const companyId = await seedCompany("SET");
    const { calls, fetch } = fakeUpstream({ "POST /key/generate": () => ({ body: { key: "sk-company-key" } }) });
    const setup = nextgentCompanySetup(db, { config: configWith(), fetch });
    expect(await setup.runAccountSetup(companyId, "owner-SET")).toEqual({ litellmKey: "created", assistant: "created" });
    expect(calls[0].body).toEqual({ metadata: { company_id: companyId }, key_alias: `company-${companyId}`, max_budget: 25, budget_duration: "30d" });
    expect(await setup.runAccountSetup(companyId, "owner-SET")).toEqual({ litellmKey: "exists", assistant: "exists" });
    const created = await db.select().from(agents).where(eq(agents.companyId, companyId));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Assistant", role: "ceo", adapterType: "process" });

    // Agent runs of this company now use the company key through LiteLLM.
    expect(await companyModelGatewayEnv(db, companyId, configWith())).toMatchObject({ ANTHROPIC_BASE_URL: LLM, ANTHROPIC_API_KEY: "sk-company-key" });
    // Without LiteLLM settings the server-wide key stays in charge.
    expect(await companyModelGatewayEnv(db, companyId, configWith({ litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null } }))).toBeNull();
  });

  it("adopts an assistant the owner already created under the configured name instead of making a second one", async () => {
    const companyId = await seedCompany("DUP");
    // The onboarding wizard creates the assistant by name, without the server's marker.
    await agentService(db).create(companyId, {
      name: "assistant",
      role: "ceo",
      title: null,
      capabilities: null,
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      budgetMonthlyCents: 0,
      status: "idle",
      metadata: {},
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });
    const setup = nextgentCompanySetup(db, {
      config: configWith({ litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null } }),
    });
    expect((await setup.runAccountSetup(companyId, "owner-DUP")).assistant).toBe("exists");
    const all = await db.select().from(agents).where(eq(agents.companyId, companyId));
    expect(all).toHaveLength(1);
  });

  it("skips setup steps whose settings are missing", async () => {
    const companyId = await seedCompany("SKP");
    const fetch = vi.fn();
    const setup = nextgentCompanySetup(db, {
      config: configWith({ litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null }, assistant: { name: null, instructionsFile: null, adapterType: null } }),
      fetch,
    });
    expect(await setup.runAccountSetup(companyId, null)).toEqual({ litellmKey: "skipped", assistant: "skipped" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes the assistant's instructions file when one is configured", async () => {
    const companyId = await seedCompany("INS");
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "assistant-")), "AGENTS.md");
    writeFileSync(file, "# Assistant\n\nHelp the owner.");
    const setup = nextgentCompanySetup(db, {
      config: configWith({ litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null }, assistant: { name: "Assistant", instructionsFile: file, adapterType: "process" } }),
    });
    expect((await setup.runAccountSetup(companyId, null)).assistant).toBe("created");
  });

  describe("store installs", () => {
    async function publish(store: ReturnType<typeof storeService>, key: string, kind: "pack" | "automation", payload: Record<string, unknown>) {
      const item = await store.create({ key, kind, name: key }, null);
      await store.addVersion(item.id, { version: "1.0.0", payload }, null);
      await store.publish(item.id);
      return item;
    }

    const agentRelease = {
      agents: [{ key: "booker", name: "Booker", adapterType: "process" }],
      nextgent: { kind: "agent", permissions: [{ permission: "availability:read", reason: "See what is open" }] },
    };

    it("checks entitlement, returns the charge, issues a scoped token and revokes it on uninstall", async () => {
      const companyId = await seedCompany("INS1");
      const plugin = await installBusinessPlugin();
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true, priceCents: 1500, interval: "month" } }),
        "POST /api/nextgent/installs": () => ({ body: { token: "gcr_install_token" } }),
        "DELETE /api/nextgent/installs/:id": () => ({ body: {} }),
      });
      const bridge = nextgentStoreBridge(db, { config: configWith(), fetch });
      const store = storeService(db, { bridge });
      const item = await publish(store, "booker", "pack", agentRelease);

      const consent = await store.consent(companyId, item.id);
      expect(consent).toMatchObject({ kind: "agent", allowed: true, charge: { priceCents: 1500, interval: "month" } });
      expect(consent.needsAccessTo).toEqual([
        { permission: "availability:read", resource: "availability", action: "read", reason: "See what is open", optional: false, changesThings: false },
      ]);

      const install = await store.install(companyId, item.id, "owner-INS1");
      expect(install.charge).toEqual({ priceCents: 1500, interval: "month" });
      expect(install.approvedPermissions).toEqual(["availability:read"]);
      expect(install.tokenSecretId).toBeTruthy();
      const register = calls.find((call) => call.method === "POST")!;
      expect(register.body).toEqual({
        companyId,
        installId: install.id,
        itemKey: "booker",
        kind: "agent",
        version: "1.0.0",
        permissions: ["availability:read"],
        optionalPermissions: [],
        enabled: true,
      });

      const [booker] = await db.select().from(agents).where(eq(agents.companyId, companyId));
      expect(booker.metadata).toMatchObject({ storeItemKey: "booker", installId: install.id });
      const [config] = await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id));
      expect((config.configJson as Record<string, Record<string, unknown>>).agentTokens[booker.id]).toEqual({
        type: "secret_ref",
        secretId: install.tokenSecretId,
        version: "latest",
      });

      await store.uninstall(companyId, item.id, "owner-INS1");
      expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `${GCR}/api/nextgent/installs/${install.id}` });
      expect(await secretByName(companyId, NEXTGENT_SECRET_NAMES.installToken(install.id))).toBeNull();
      const [after] = await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id));
      expect(after.configJson).toEqual({ apiBaseUrl: GCR });
    });

    it("hands an installed app a short-lived session token, never the stored install token, and only to members of its company", async () => {
      const companyId = await seedCompany("TOK");
      const otherCompany = await seedCompany("TOX");
      const expiresAt = new Date(Date.now() + 120_000).toISOString();
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: { token: "install-scoped-token" } }),
        "POST /api/nextgent/installs/:id/session": () => ({ status: 201, body: { token: "gcr_mcp_ist.session", expiresAt } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await publish(store, "booker", "pack", agentRelease);
      const install = await store.install(companyId, item.id, null);
      const app = (actor: Record<string, unknown>) => {
        const server = express();
        server.use(express.json());
        server.use((req, _res, next) => { (req as unknown as { actor: unknown }).actor = actor; next(); });
        server.use("/api", nextgentRoutes(db, { config: configWith(), fetch }));
        server.use(errorHandler);
        return server;
      };
      const owner = { type: "board", source: "session", userId: "owner-TOK", companyIds: [companyId], isInstanceAdmin: false };
      const res = await request(app(owner)).post(`/api/companies/${companyId}/installs/${install.id}/token`);
      expect(res.status).toBe(200);
      // The browser gets gcr-api-clean's short-lived install session, scoped to this install.
      expect(res.body).toEqual({ token: "gcr_mcp_ist.session", expiresAt });
      expect(JSON.stringify(res.body)).not.toContain("install-scoped-token");
      expect(calls.at(-1)).toMatchObject({ method: "POST", url: `${GCR}/api/nextgent/installs/${install.id}/session`, body: { companyId } });
      // A stored install token alone is never enough: without gcr-api-clean, no token goes out.
      const offline = express();
      offline.use(express.json());
      offline.use((req, _res, next) => { (req as unknown as { actor: unknown }).actor = owner; next(); });
      offline.use("/api", nextgentRoutes(db, { config: configWith({ gcrApiUrl: null }) }));
      offline.use(errorHandler);
      const noGcr = await request(offline).post(`/api/companies/${companyId}/installs/${install.id}/token`);
      expect(noGcr.status).toBe(503);
      expect(JSON.stringify(noGcr.body)).not.toContain("install-scoped-token");
      const outsider = { type: "board", source: "session", userId: "owner-TOX", companyIds: [otherCompany], isInstanceAdmin: false };
      expect((await request(app(outsider)).post(`/api/companies/${companyId}/installs/${install.id}/token`)).status).toBe(403);
      expect((await request(app({ ...owner, userId: "owner-TOX" })).post(`/api/companies/${companyId}/installs/${randomUUID()}/token`)).status).toBe(403);
      const missing = await request(app(owner)).post(`/api/companies/${companyId}/installs/${randomUUID()}/token`);
      expect(missing.status).toBe(404);
    });

    it("lists an installed agent without its own token as null, so the plugin fails closed instead of using the company token", async () => {
      const companyId = await seedCompany("FC");
      const plugin = await installBusinessPlugin();
      let issueToken = true;
      const { fetch } = fakeUpstream({
        "POST /api/nextgent/link": () => ({ body: { entitySlug: "fc-biz", forwardingAddress: null, businessToken: "company-token" } }),
        "POST /api/nextgent/unlink": () => ({ body: {} }),
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: issueToken ? { token: "agent-token" } : {} }),
        "DELETE /api/nextgent/installs/:id": () => ({ body: {} }),
      });
      const links = nextgentBusinessLinkService(db, { config: configWith(), fetch });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      await links.link(companyId, { entitySlug: "fc-biz" }, null);
      const item = await publish(store, "booker", "pack", agentRelease);
      const install = await store.install(companyId, item.id, null);
      const [booker] = await db.select().from(agents).where(eq(agents.companyId, companyId));
      const configOf = async () => (await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id)))[0].configJson as Record<string, Record<string, unknown>>;
      expect(await configOf()).toMatchObject({ agentTokens: { [booker.id]: { type: "secret_ref", secretId: install.tokenSecretId } } });

      // Unlink drops the install token; relink brings the company token back but not the install's.
      await links.unlink(companyId, false, null);
      await links.link(companyId, { entitySlug: "fc-biz" }, null);
      const relinked = await configOf();
      expect(relinked.businessToken).toMatchObject({ type: "secret_ref" });
      expect(relinked.agentTokens).toEqual({ [booker.id]: null });

      // An install gcr-api-clean registered without a token is listed the same way.
      await store.uninstall(companyId, item.id, null);
      expect((await configOf()).agentTokens).toBeUndefined();
      issueToken = false;
      const other = await publish(store, "greeter", "pack", { ...agentRelease, agents: [{ key: "greeter", name: "Greeter", adapterType: "process" }] });
      await store.install(companyId, other.id, null);
      const [greeter] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.name, "Greeter")));
      expect((await configOf()).agentTokens).toEqual({ [greeter.id]: null });
    });

    it("installs nothing when the plan does not allow the item", async () => {
      const companyId = await seedCompany("DENY");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: false, reason: "Upgrade to install this", priceCents: 900, interval: "month" } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await publish(store, "pricey", "pack", agentRelease);
      await expect(store.install(companyId, item.id, null)).rejects.toMatchObject({ status: 402, message: "Upgrade to install this" });
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
      expect(await db.select().from(agents).where(eq(agents.companyId, companyId))).toHaveLength(0);
      expect(await db.select().from(storeInstalls)).toHaveLength(0);
    });

    it("rolls the install back when gcr-api-clean refuses it", async () => {
      const companyId = await seedCompany("ROLL");
      const { fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ status: 409, body: { error: "Business not linked" } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await publish(store, "booker", "pack", agentRelease);
      await expect(store.install(companyId, item.id, null)).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(storeInstalls)).toHaveLength(0);
      const left = await db.select().from(agents).where(eq(agents.companyId, companyId));
      expect(left.every((agent) => agent.status === "terminated")).toBe(true);
    });

    it("holds updates that ask for more data until the owner approves them", async () => {
      const companyId = await seedCompany("UPD");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: { token: `token-${calls.length}` } }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await publish(store, "booker", "pack", agentRelease);
      const installed = await store.install(companyId, item.id, null);

      // Same permissions: applies automatically, no new token needed; gcr-api-clean is told the new version.
      const same = await store.addVersion(item.id, { version: "1.1.0", payload: agentRelease }, null);
      expect(same).toMatchObject({ appliedTo: 1, needsApprovalFor: [] });
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(calls.at(-1)).toMatchObject({ method: "PATCH", url: `${GCR}/api/nextgent/installs/${installed.id}`, body: { version: "1.1.0" } });

      const wider = {
        ...agentRelease,
        nextgent: { kind: "agent", permissions: [...agentRelease.nextgent.permissions, { permission: "bookings:write", reason: "Book tables" }] },
      };
      const held = await store.addVersion(item.id, { version: "2.0.0", payload: wider }, null);
      expect(held).toMatchObject({ appliedTo: 0, needsApprovalFor: [companyId] });
      const [listed] = await store.listForCompany(companyId);
      expect(listed).toMatchObject({ installedVersion: "1.1.0", updateAvailable: true, needsApproval: true, updateNewPermissions: ["bookings:write"] });

      // A required security release with new permissions waits too.
      const security = await store.addVersion(item.id, { version: "2.0.1", advisoryType: "security", required: true, payload: wider }, null);
      expect(security).toMatchObject({ appliedTo: 0, needsApprovalFor: [companyId] });

      await expect(store.updateInstall(companyId, item.id, null)).rejects.toMatchObject({ status: 409 });
      await store.updateInstall(companyId, item.id, "owner-UPD", { approvePermissions: true });
      const reauthorized = calls.filter((call) => call.method === "POST").at(-1)!;
      expect(reauthorized.body).toMatchObject({ version: "2.0.1", permissions: ["availability:read", "bookings:write"] });
      const [install] = await db.select().from(storeInstalls).where(eq(storeInstalls.companyId, companyId));
      expect(install.approvedPermissions).toEqual(["availability:read", "bookings:write"]);
    });

    it("rolls an update back when gcr-api-clean refuses the new permissions, and applies it on an explicit retry", async () => {
      const companyId = await seedCompany("RB");
      let refuse = false;
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => (refuse ? { status: 409, body: { error: "Business not linked" } } : { body: { token: `token-${calls.length}` } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await publish(store, "booker", "pack", agentRelease);
      const installed = await store.install(companyId, item.id, null);
      const wider = {
        agents: [{ key: "booker", name: "Booker v2", adapterType: "process" }],
        nextgent: { kind: "agent", permissions: [...agentRelease.nextgent.permissions, { permission: "bookings:write", reason: "Book tables" }] },
      };
      const { version: v2 } = await store.addVersion(item.id, { version: "2.0.0", payload: wider }, null);

      refuse = true;
      await expect(store.updateInstall(companyId, item.id, "owner-RB", { approvePermissions: true })).rejects.toMatchObject({ status: 409 });
      const [after] = await db.select().from(storeInstalls).where(eq(storeInstalls.id, installed.id));
      // Nothing moved on this side: same version, same grants, same content.
      expect(after.versionId).toBe(installed.versionId);
      expect(after.approvedPermissions).toEqual(["availability:read"]);
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated")));
      expect(agent.name).toBe("Booker");
      const [listed] = await store.listForCompany(companyId);
      expect(listed).toMatchObject({ installedVersion: "1.0.0", updateAvailable: true, needsApproval: true });

      // The owner retries once gcr-api-clean is happy again; both sides move together.
      refuse = false;
      await store.updateInstall(companyId, item.id, "owner-RB", { approvePermissions: true });
      const [moved] = await db.select().from(storeInstalls).where(eq(storeInstalls.id, installed.id));
      expect(moved.versionId).toBe(v2.id);
      expect(moved.approvedPermissions).toEqual(["availability:read", "bookings:write"]);
      expect(calls.filter((call) => call.method === "POST").at(-1)?.body).toMatchObject({ version: "2.0.0", permissions: ["availability:read", "bookings:write"] });
    });

    it("gives an automation's hand-off its agent's routine with an HMAC webhook", async () => {
      const companyId = await seedCompany("AUTO");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": (body) => ({ body: body?.kind === "automation" ? {} : { token: "agent-token" } }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true } }),
        "DELETE /api/nextgent/installs/:id": () => ({ body: {} }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const reviewer = await publish(store, "reviewer", "pack", {
        agents: [{ key: "review", name: "Reviewer", adapterType: "process" }],
        nextgent: { kind: "agent", permissions: [{ permission: "reviews:read", reason: "Read reviews" }] },
      });
      const automation = await publish(store, "ask-for-review", "automation", {
        nextgent: { kind: "automation", permissions: [], handoff: { itemKey: "reviewer", agentKey: "review", title: "Send a review request" } },
      });

      await expect(store.install(companyId, automation.id, null)).rejects.toMatchObject({ status: 409 });
      await store.install(companyId, reviewer.id, null);
      const install = await store.install(companyId, automation.id, null);

      const registered = calls.filter((call) => call.method === "POST").at(-1)!;
      expect(registered.body).toMatchObject({ kind: "automation", installId: install.id, permissions: [] });
      const routine = registered.body?.routine as { webhookUrl: string; webhookSecret: string };
      expect(routine.webhookUrl).toMatch(/^https:\/\/paperclip\.example\.test\/api\/routine-triggers\/public\/[0-9a-f]+\/fire$/);
      expect(routine.webhookSecret).toBeTruthy();
      expect(install.tokenSecretId).toBeNull();

      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.name, "Reviewer")));
      const [created] = await db.select().from(routines).where(eq(routines.companyId, companyId));
      expect(created).toMatchObject({ title: "Send a review request", assigneeAgentId: agent.id, status: "active" });
      const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, created.id));
      expect(trigger).toMatchObject({ kind: "webhook", signingMode: "hmac_sha256" });

      // A later release of the automation keeps the hand-off routine.
      await store.addVersion(automation.id, { version: "1.1.0", payload: { nextgent: { kind: "automation", permissions: [], handoff: { itemKey: "reviewer", agentKey: "review" } } } }, null);
      const [still] = await db.select().from(routines).where(eq(routines.id, created.id));
      expect(still.status).toBe("active");

      await store.uninstall(companyId, automation.id, null);
      const [archived] = await db.select().from(routines).where(eq(routines.id, created.id));
      expect(archived.status).toBe("archived");
    });
  });

  describe("store admin (contract §12)", () => {
    const plainRelease = { agents: [{ key: "helper", name: "Helper", adapterType: "process" }] };

    it("previews and pushes a release to an audience, recording the push", async () => {
      const auto = await seedCompany("PA1");
      const manual = await seedCompany("PA2");
      const outsider = await seedCompany("PA3");
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      const item = await store.create({ key: "helper", kind: "agent", name: "Helper" }, null);
      await store.addVersion(item.id, { version: "1.0.0", payload: plainRelease }, null);
      await store.publish(item.id);
      await store.install(auto, item.id, null);
      await store.install(manual, item.id, null, { approvalMode: "manual" });
      // An older-style release the auto company is moved off of, so both are behind.
      await store.addVersion(item.id, { version: "1.1.0", channel: "fast", payload: plainRelease }, null);

      const all = { version: "1.1.0", action: "apply" as const, audience: { mode: "all" as const } };
      const preview = await store.previewDeploy(item.id, all);
      expect(preview).toMatchObject({ targeted: 2, apply: 0, skip: 2, reasons: { other_channel: 1, manual_updates: 1 } });

      const forced = await store.previewDeploy(item.id, { ...all, action: "force" });
      expect(forced).toMatchObject({ targeted: 2, apply: 2 });

      const chosen = await store.deploy(item.id, { ...all, action: "force", audience: { mode: "companies", companyIds: [manual, outsider] } }, "admin");
      expect(chosen).toMatchObject({ applied: 1, skipped: 1, reasons: { not_installed: 1 } });
      const installs = await store.listItemInstalls(item.id);
      expect(installs.find((row) => row.companyId === manual)).toMatchObject({ version: "1.1.0", status: "current" });
      expect(installs.find((row) => row.companyId === auto)).toMatchObject({ version: "1.0.0", channel: "stable" });

      const history = await store.listDeployments();
      expect(history[0]).toMatchObject({ itemName: "Helper", version: "1.1.0", action: "force", applied: 1, skipped: 1, status: "completed" });
    });

    it("pushes new installs switched off, by business kind, and lets the owner turn them on", async () => {
      const shopA = await seedCompany("KA1");
      const shopB = await seedCompany("KA2");
      const other = await seedCompany("KB1");
      await db.insert(nextgentBusinessLinks).values([
        { companyId: shopA, entitySlug: "ka1" },
        { companyId: shopB, entitySlug: "ka2" },
        { companyId: other, entitySlug: "kb1" },
      ]);
      // Business kinds are business state: they come from gcr-api-clean over the
      // bridge (DECISIONS #32). Paperclip holds no copy, so without gcr-api-clean
      // the kind audience is empty.
      const offline = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      expect(await offline.businessKinds()).toEqual([]);
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/business-kinds": () => ({
          body: [
            { key: "kind-b", count: 1, companyIds: [other] },
            { key: "kind-a", count: 2, companyIds: [shopA, shopB] },
          ],
        }),
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: { token: "agent-token" } }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      expect(await store.businessKinds()).toEqual([{ key: "kind-a", count: 2 }, { key: "kind-b", count: 1 }]);
      expect(calls.filter((call) => call.url.endsWith("/api/nextgent/business-kinds"))).toHaveLength(1);
      const item = await store.create({ key: "helper", kind: "agent", name: "Helper" }, null);
      const release = { ...plainRelease, nextgent: { kind: "agent", permissions: [{ permission: "menu:read", reason: "Read the menu" }] } };
      await store.addVersion(item.id, { version: "1.0.0", payload: release }, null);
      await store.publish(item.id);

      const push = { version: "1.0.0", action: "apply" as const, audience: { mode: "kind" as const, values: ["kind-a"] }, installMissing: true, enabled: true };
      // A release that needs data never starts switched on, even when asked.
      expect(await store.previewDeploy(item.id, push)).toMatchObject({ targeted: 2, install: 2, installSwitchedOff: 2 });
      expect(await offline.previewDeploy(item.id, push)).toMatchObject({ targeted: 0 });
      expect(await store.deploy(item.id, push, "admin")).toMatchObject({ applied: 2 });
      expect(await db.select().from(agents).where(eq(agents.companyId, shopA))).toHaveLength(0);
      const [listed] = await store.listForCompany(shopA);
      expect(listed).toMatchObject({ installed: true, enabled: false });
      expect((await store.listItemInstalls(item.id))[0]).toMatchObject({ status: "switched_off" });
      expect(await store.listForCompany(other).then((rows) => rows[0].installed)).toBe(false);

      const on = await store.enable(shopA, item.id, "owner-KA1");
      expect(on.enabled).toBe(true);
      expect(on.approvedPermissions).toEqual(["menu:read"]);
      const created = await db.select().from(agents).where(eq(agents.companyId, shopA));
      expect(created).toHaveLength(1);
    });

    it("starts a pushed install switched on only when it needs no data", async () => {
      const companyId = await seedCompany("ON1");
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      const item = await store.create({ key: "plain", kind: "agent", name: "Plain" }, null);
      await store.addVersion(item.id, { version: "1.0.0", payload: plainRelease }, null);
      await store.publish(item.id);
      const result = await store.deploy(item.id, { version: "1.0.0", action: "apply", audience: { mode: "companies", companyIds: [companyId] }, installMissing: true, enabled: true }, null);
      expect(result).toMatchObject({ install: 1, installSwitchedOff: 0 });
      const [install] = await db.select().from(storeInstalls).where(eq(storeInstalls.companyId, companyId));
      expect(install.enabled).toBe(true);
      expect(await db.select().from(agents).where(eq(agents.companyId, companyId))).toHaveLength(1);
    });

    /** An engine manifest the store's gate accepts (store-content.ts assertAppManifest). */
    const engineManifest = (id: string, version: string, extra: Record<string, unknown> = {}) => ({
      schema_version: 1,
      id,
      name: "Menu",
      version,
      publisher: "NEXT GENT",
      runtime: { type: "engine" },
      ui: { views: {} },
      permissions: [],
      ...extra,
    });

    it("keeps an app's manifest and lets the owner decline optional access", async () => {
      const companyId = await seedCompany("APP");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: { token: "app-token" } }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true, projected: true } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await store.create({ key: "menu-app", kind: "app", name: "Menu" }, null);
      const manifest = engineManifest("menu-app", "1.0.0");
      const { version } = await store.addVersion(item.id, {
        version: "1.0.0",
        payload: {
          app: manifest,
          nextgent: {
            kind: "app",
            permissions: [
              { permission: "menu:read", reason: "Show the menu" },
              { permission: "reviews:read", reason: "Show reviews next to dishes", optional: true },
            ],
          },
        },
      }, null);
      expect((version.payload as Record<string, unknown>).app).toEqual(manifest);
      await store.publish(item.id);
      const consent = await store.consent(companyId, item.id);
      expect(consent.needsAccessTo.map((entry) => [entry.permission, entry.optional])).toEqual([["menu:read", false], ["reviews:read", true]]);
      const install = await store.install(companyId, item.id, null, { declinedPermissions: ["reviews:read"] });
      expect(install.approvedPermissions).toEqual(["menu:read"]);
      // The projection gcr-api-clean keeps gets the manifest and the switch state with the install.
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        companyId,
        installId: install.id,
        itemKey: "menu-app",
        kind: "app",
        version: "1.0.0",
        permissions: ["menu:read"],
        optionalPermissions: [],
        app: manifest,
        enabled: true,
      });

      // The listing carries what the screen that draws the app needs.
      const [listed] = await store.listForCompany(companyId);
      expect(listed).toMatchObject({
        installId: install.id,
        installEnabled: true,
        versionId: version.id,
        app: manifest,
        price: null,
        approvedPermissions: ["menu:read"],
      });

      // A new optional permission never holds an update; a new required one does.
      const next = await store.addVersion(item.id, {
        version: "1.1.0",
        payload: { app: engineManifest("menu-app", "1.1.0"), nextgent: { kind: "app", permissions: [{ permission: "menu:read", reason: "Show the menu" }, { permission: "events:read", reason: "x", optional: true }] } },
      }, null);
      expect(next).toMatchObject({ appliedTo: 1, needsApprovalFor: [] });
      // Same permissions, so no re-registration: the version move goes to gcr-api-clean as a PATCH with the new manifest.
      expect(calls.at(-1)).toMatchObject({
        method: "PATCH",
        url: `${GCR}/api/nextgent/installs/${install.id}`,
        body: { version: "1.1.0", app: engineManifest("menu-app", "1.1.0") },
      });
      expect((await store.listForCompany(companyId))[0]).toMatchObject({ app: engineManifest("menu-app", "1.1.0"), versionId: next.version.id });
    });

    it("refuses an app release whose manifest fails the gate, naming the field", async () => {
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      const item = await store.create({ key: "menu-app", kind: "app", name: "Menu" }, null);
      const release = (app: unknown, nextgent: unknown = { kind: "app", permissions: [] }) =>
        store.addVersion(item.id, { version: "1.0.0", payload: { app, nextgent } }, null);
      await expect(release(undefined)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app") });
      await expect(release(engineManifest("other-key", "1.0.0"))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.id") });
      await expect(release(engineManifest("menu-app", "1.0.1"))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.version") });
      await expect(release(engineManifest("menu-app", "1.0.0", { runtime: { type: "node" } }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.runtime.type") });
      await expect(release(engineManifest("menu-app", "1.0.0", { ui: null }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.ui") });
      await expect(release(engineManifest("menu-app", "1.0.0", { permissions: {} }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.permissions") });
      await expect(release({ ...engineManifest("menu-app", "1.0.0"), schema_version: undefined })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.schema_version") });
      await expect(release(engineManifest("menu-app", "1.0.0"), null)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.nextgent.kind") });
      const notSemver = await store.create({ key: "loose", kind: "app", name: "Loose" }, null);
      await expect(store.addVersion(notSemver.id, { version: "v1", payload: { app: engineManifest("loose", "v1"), nextgent: { kind: "app" } } }, null))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.app.version") });
      await release(engineManifest("menu-app", "1.0.0"));
    });

    it("registers an app with gcr-api-clean even without a NEXT GENT section, and tells it when the owner turns a pushed install on", async () => {
      const companyId = await seedCompany("APN");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: { token: "app-token" } }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true, projected: true } }),
        "DELETE /api/nextgent/installs/:id": () => ({ body: { removed: true } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await store.create({ key: "hours", kind: "app", name: "Hours" }, null);
      const manifest = engineManifest("hours", "1.0.0");
      await store.addVersion(item.id, { version: "1.0.0", payload: { app: manifest, nextgent: { kind: "app" } } }, null);
      await store.publish(item.id);

      // Pushed switched off: nothing is registered yet.
      await store.deploy(item.id, { version: "1.0.0", action: "apply", audience: { mode: "companies", companyIds: [companyId] }, installMissing: true }, "admin");
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
      const [listedOff] = await store.listForCompany(companyId);
      expect(listedOff).toMatchObject({ installed: true, installEnabled: false, app: manifest });

      // The owner turns it on: registered (no permissions to grant), then switched on in the projection.
      const on = await store.enable(companyId, item.id, "owner-APN");
      expect(on.approvedPermissions).toEqual([]);
      const registered = calls.find((call) => call.method === "POST")!;
      expect(registered.body).toMatchObject({ installId: on.id, kind: "app", version: "1.0.0", permissions: [], app: manifest });
      expect(calls.at(-1)).toMatchObject({ method: "PATCH", url: `${GCR}/api/nextgent/installs/${on.id}`, body: { enabled: true } });
      expect((await store.listForCompany(companyId))[0]).toMatchObject({ installEnabled: true, approvedPermissions: [] });

      // Uninstall still tells gcr-api-clean with DELETE (it switches the projection off and keeps the app's data).
      await store.uninstall(companyId, item.id, null);
      expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `${GCR}/api/nextgent/installs/${on.id}` });
    });

    it("installs a layout the same way and never shows it as an app", async () => {
      const companyId = await seedCompany("LAY");
      const { calls, fetch } = fakeUpstream({
        "GET /api/nextgent/entitlement": () => ({ body: { allowed: true } }),
        "POST /api/nextgent/installs": () => ({ body: {} }),
        "PATCH /api/nextgent/installs/:id": () => ({ body: { updated: true, projected: true } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }) });
      const item = await store.create({ key: "front-page", kind: "layout", name: "Front page" }, null);
      await expect(store.addVersion(item.id, { version: "1.0.0", payload: {} }, null)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("payload.layout") });
      await expect(store.addVersion(item.id, { version: "1.0.0", payload: { layout: { id: "front-page" } } }, null)).rejects.toMatchObject({ status: 400 });
      const layout = { id: "front-page", version: "1.0.0", slots: ["hero"] };
      const { version } = await store.addVersion(item.id, { version: "1.0.0", payload: { layout } }, null);
      expect((version.payload as Record<string, unknown>).layout).toEqual(layout);
      await store.publish(item.id);
      const install = await store.install(companyId, item.id, null);
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        companyId,
        installId: install.id,
        itemKey: "front-page",
        kind: "layout",
        version: "1.0.0",
        permissions: [],
        optionalPermissions: [],
        // The layout manifest travels as `layout`, never as `app` (gcr-api-clean layoutFrom, DECISIONS #31).
        layout,
        enabled: true,
      });
      const [listed] = await store.listForCompany(companyId);
      expect(listed).toMatchObject({ kind: "layout", installId: install.id, app: null, approvedPermissions: [] });

      // A version move re-sends the layout the new release carries.
      const next = { id: "front-page", version: "1.1.0", slots: ["hero", "menu"] };
      expect(await store.addVersion(item.id, { version: "1.1.0", payload: { layout: next } }, null)).toMatchObject({ appliedTo: 1 });
      expect(calls.at(-1)).toMatchObject({ method: "PATCH", url: `${GCR}/api/nextgent/installs/${install.id}` });
      expect(calls.at(-1)?.body).toEqual({ version: "1.1.0", layout: next });
    });

    it("shows an item's price and the install's version id in the company listing", async () => {
      const companyId = await seedCompany("PRC");
      const { fetch } = fakeUpstream({
        "PUT /api/nextgent/items/paid/price": (body) => ({ body: { itemKey: "paid", ...body } }),
      });
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith(), fetch }), defaultCurrency: "usd" });
      const item = await store.create({ key: "paid", kind: "pack", name: "Paid" }, null);
      const { version } = await store.addVersion(item.id, { version: "1.0.0", payload: plainRelease }, null);
      await store.setPrice(item.id, { amountCents: 1200, interval: "month", model: "flat" });
      await store.publish(item.id);
      const [before] = await store.listForCompany(companyId);
      expect(before).toMatchObject({ installId: null, installEnabled: null, versionId: version.id, app: null, approvedPermissions: [], price: { amountCents: 1200, currency: "usd", interval: "month", model: "flat" } });
    });

    it("never pushes new data access, even forced", async () => {
      const companyId = await seedCompany("PNC");
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      const item = await store.create({ key: "helper", kind: "agent", name: "Helper" }, null);
      await store.addVersion(item.id, { version: "1.0.0", payload: { ...plainRelease, nextgent: { kind: "agent", permissions: [] } } }, null);
      await store.publish(item.id);
      await store.install(companyId, item.id, null);
      await store.addVersion(item.id, {
        version: "2.0.0",
        payload: { ...plainRelease, nextgent: { kind: "agent", permissions: [{ permission: "menu:write", reason: "x" }] } },
      }, null);
      const result = await store.deploy(item.id, { version: "2.0.0", action: "force", audience: { mode: "all" } }, null);
      expect(result).toMatchObject({ applied: 0, needsConsent: 1, reasons: { needs_consent: 1 } });
    });

    it("rejects a release whose nextgent kind does not match the item", async () => {
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      const item = await store.create({ key: "an-app", kind: "app", name: "App" }, null);
      await expect(store.addVersion(item.id, { version: "1", payload: { nextgent: { kind: "automation" } } }, null)).rejects.toMatchObject({ status: 400 });
    });

    it("refuses the retired box-release kind and accepts layout", async () => {
      const store = storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith({ gcrApiUrl: null }) }) });
      // The database constraint no longer lists it.
      await expect(store.create({ key: "box", kind: "box-release" as never, name: "Box" }, null)).rejects.toBeTruthy();
      expect(await store.listAll()).toEqual([]);
      const layout = await store.create({ key: "front-page", kind: "layout", name: "Front page" }, null);
      expect(layout.kind).toBe("layout");
    });

    it("forwards a price to gcr-api-clean billing before showing it", async () => {
      const { calls, fetch } = fakeUpstream({
        "PUT /api/nextgent/items/priced/price": (body) => ({ body: { itemKey: "priced", ...body, stripePriceId: null } }),
      });
      const store = storeService(db, {
        bridge: nextgentStoreBridge(db, { config: configWith(), fetch }),
        defaultCurrency: "usd",
      });
      const item = await store.create({ key: "priced", kind: "app", name: "Priced" }, null);
      const saved = await store.setPrice(item.id, { amountCents: 1200, interval: "month", model: "flat" });
      expect(calls[0]).toMatchObject({ method: "PUT", body: { amountCents: 1200, currency: "usd", interval: "month", model: "flat" } });
      expect(saved.price).toEqual({ amountCents: 1200, currency: "usd", interval: "month", model: "flat" });
      expect((await store.listAll())[0].price).toEqual(saved.price);

      const failing = storeService(db, {
        bridge: nextgentStoreBridge(db, { config: configWith(), fetch: fakeUpstream({}).fetch }),
        defaultCurrency: "usd",
      });
      await expect(failing.setPrice(item.id, { amountCents: 99 })).rejects.toBeTruthy();
      expect((await store.listAll())[0].price?.amountCents).toBe(1200);
      await expect(storeService(db, { bridge: nextgentStoreBridge(db, { config: configWith() }) }).setPrice(item.id, { amountCents: 1 })).rejects.toMatchObject({ status: 422 });
    });
  });

  it("attaches a receipt to its task and records it in Activity", async () => {
    const companyId = await seedCompany("RCP");
    const [issue] = await db.insert(issues).values({ companyId, title: "Confirm entertainer", identifier: "RCP-1" } as never).returning();
    const inbound = nextgentInboundService(db, { config: configWith() });
    const result = await inbound.recordReceipt({
      companyId,
      taskId: "RCP-1",
      action: "sms.send",
      target: "entertainer",
      oldValue: null,
      newValue: "Confirm 7 PM",
      device: "phone-1",
      verified: true,
      at: "2026-10-04T12:00:00Z",
    });
    expect(result.taskId).toBe(issue.id);
    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, issue.id));
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("Verified");
    const activity = await db.select().from(activityLog).where(eq(activityLog.action, "nextgent.receipt"));
    expect(activity[0]).toMatchObject({ companyId, entityType: "issue", entityId: issue.id });

    await inbound.recordReceipt({ companyId, action: "hours.update", target: "hours", verified: false, at: "2026-10-04T13:00:00Z" });
    const listed = await inbound.listReceipts(companyId, { limit: 10, offset: 0 });
    expect(listed.total).toBe(2);
    expect(listed.receipts[0]).toMatchObject({ action: "hours.update", verified: false, task: null });
    expect(listed.receipts[1]).toMatchObject({ id: result.id, action: "sms.send", taskId: issue.id, task: { identifier: "RCP-1" }, newValue: "Confirm 7 PM" });
    expect((await inbound.listReceipts(companyId, { limit: 1, offset: 1 })).receipts).toHaveLength(1);

    await expect(inbound.recordReceipt({ companyId, taskId: "RCP-404", action: "a", target: "t", verified: false, at: "now" })).rejects.toMatchObject({ status: 404 });
    await expect(inbound.recordReceipt({ companyId: randomUUID(), action: "a", target: "t", verified: false, at: "now" })).rejects.toMatchObject({ status: 404 });
  });

  it("records conversations, sending \"nextgent\" to the platform company", async () => {
    const platform = await seedCompany("PLT");
    const inbound = nextgentInboundService(db, { config: configWith({ platformCompanyId: platform }) });
    const conversation = {
      conversationId: "lc-1",
      channel: "voice" as const,
      mode: "concierge",
      startedAt: "2026-10-04T12:00:00Z",
      endedAt: "2026-10-04T12:03:00Z",
      turns: 4,
      outcome: "booked",
      // The old shape is still tolerated but never stored (DECISIONS #34).
      from: "+10000000001",
      to: "+10000000002",
      transcript: [{ role: "caller", text: "hello", at: "t" }],
      summary: "said hello",
    };
    await inbound.recordConversation({ companyId: "nextgent", ...conversation });
    const activity = await db.select().from(activityLog).where(eq(activityLog.action, "nextgent.conversation"));
    expect(activity[0]).toMatchObject({ companyId: platform, entityType: "nextgent_conversation" });
    expect(activity[0].details).toEqual({
      conversationId: "lc-1",
      channel: "voice",
      mode: "concierge",
      threadId: null,
      startedAt: "2026-10-04T12:00:00Z",
      endedAt: "2026-10-04T12:03:00Z",
      turns: 4,
      outcome: "booked",
    });
    // An old-shape post carries no reference fields: turns comes from the transcript length, nothing else is kept.
    const other = await seedCompany("CNV");
    await inbound.recordConversation({ companyId: other, channel: "sms", from: "a", to: "b", transcript: [{ role: "caller", text: "x", at: "t" }, { role: "agent", text: "y", at: "t" }] });
    const old = await db.select().from(activityLog).where(and(eq(activityLog.action, "nextgent.conversation"), eq(activityLog.companyId, other)));
    expect(old[0].details).toEqual({ conversationId: null, channel: "sms", mode: null, threadId: null, startedAt: null, endedAt: null, turns: 2, outcome: null });
    await expect(
      nextgentInboundService(db, { config: configWith() }).recordConversation({ companyId: "nextgent", ...conversation }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("boot sync writes config for companies linked before the plugin was installed", async () => {
    const companyId = await seedCompany("BOOT");
    const { fetch } = fakeUpstream({
      "POST /api/nextgent/link": () => ({ body: { entitySlug: "boot-biz", forwardingAddress: null, businessToken: "t" } }),
    });
    await nextgentBusinessLinkService(db, { config: configWith(), fetch }).link(companyId, { entitySlug: "boot-biz" }, null);
    const plugin = await installBusinessPlugin();
    expect(await nextgentBusinessPlugin(db, { config: configWith() }).syncAll()).toBe(1);
    const [config] = await db.select().from(pluginConfig).where(eq(pluginConfig.pluginId, plugin.id));
    expect((config.configJson as Record<string, unknown>).businessToken).toBeTruthy();
  });
});
