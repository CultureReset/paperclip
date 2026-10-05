import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  routineRuns,
  routineTriggers,
  routineWaits,
  routines,
  storeGrants,
  storeInstallResources,
  storeInstalls,
  storeItemVersions,
  storeItems,
  storePlanItems,
  storePlans,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { automationRoutes } from "../routes/automations.js";
import { entitlementRoutes } from "../routes/entitlement.js";
import { storeRoutes } from "../routes/store.js";
import { AUTOMATION_ORIGINS, applyConfig, variablesFor } from "../services/automation/install.js";
import { decide } from "../services/entitlement/decide.js";
import { entitlementService } from "../services/entitlement/index.js";
import { storeService } from "../services/store.js";
import { AUTOMATION_ROUTINE_KEY } from "../services/store-content.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

type Actor = Record<string, unknown>;

const DEFINITION = {
  name: "Ask for a review",
  trigger: { type: "event", event: "booking.completed" },
  config_schema: [
    { key: "delay_minutes", label: "Wait (minutes)", type: "number", default: 1440 },
    { key: "reminder_phone", label: "Phone", type: "tel", default: "" },
  ],
  steps: [
    { id: "pause", type: "wait", config: { minutes: "{{ config.delay_minutes }}" } },
    { id: "note", type: "log", config: { message: "Review asked for {{ trigger.ref.booking_id }}" } },
  ],
};

describeEmbeddedPostgres("store automations and entitlement", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.example.test";
    process.env.ENTITLEMENT_SOURCE = "paperclip";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-automation-store-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE companies, store_items, store_plans, store_settings, plugins CASCADE`);
  });

  afterAll(async () => {
    process.env = savedEnv;
    await tempDb?.cleanup();
  });

  const admin: Actor = { type: "board", source: "session", userId: "admin-user", companyIds: [], isInstanceAdmin: true };
  const member = (userId: string, companyId: string): Actor => ({ type: "board", source: "session", userId, companyIds: [companyId], isInstanceAdmin: false, memberships: [{ companyId, membershipRole: "owner", status: "active" }] });

  function appAs(actor: Actor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { actor: Actor }).actor = actor; next(); });
    app.use("/api", storeRoutes(db));
    app.use("/api", automationRoutes(db));
    app.use("/api", entitlementRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany(prefix: string, userId = "owner") {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: prefix, issuePrefix: prefix });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    return companyId;
  }

  async function publishAutomation(key = "review-request", definition: Record<string, unknown> = DEFINITION) {
    const created = await request(appAs(admin)).post("/api/store/admin/items").send({ key, kind: "automation", name: "Review request" });
    expect(created.status).toBe(201);
    const itemId = created.body.id as string;
    const version = await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "1.0.0", payload: { nextgent: { kind: "automation", permissions: [] }, automation: definition } });
    expect(version.status).toBe(201);
    expect((await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/publish`)).status).toBe(200);
    return itemId;
  }

  it("variables follow the config schema and only declared keys are patched", () => {
    const vars = variablesFor(DEFINITION.config_schema);
    expect(vars.map((v) => [v.name, v.type, v.defaultValue, v.required])).toEqual([["delay_minutes", "number", 1440, false], ["reminder_phone", "tel", "", false]]);
    const patched = applyConfig(DEFINITION, vars, { delay_minutes: "60", reminder_phone: "251-555-0200", not_a_setting: "x" });
    expect(patched.map((v) => [v.name, v.defaultValue])).toEqual([["delay_minutes", 60], ["reminder_phone", "251-555-0200"]]);
    const kept = variablesFor(DEFINITION.config_schema, patched);
    expect(kept.find((v) => v.name === "reminder_phone")?.defaultValue).toBe("251-555-0200");
  });

  it("a release of an automation item must carry a valid definition", async () => {
    const created = await request(appAs(admin)).post("/api/store/admin/items").send({ key: "bad-automation", kind: "automation", name: "Bad" });
    const itemId = created.body.id as string;
    const missing = await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "1.0.0", payload: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/payload\.automation/);
    const invalid = await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "1.0.0", payload: { automation: { trigger: { type: "event" }, steps: [{ id: "x", type: "nope", config: {} }] } } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/Pick an event/);
    expect(invalid.body.error).toMatch(/unknown type "nope"/);
  });

  it("installing an automation creates its steps routine and trigger; config and switch are the owner's; uninstall disables and keeps history", async () => {
    const itemId = await publishAutomation();
    const companyId = await seedCompany("AUT");
    const owner = appAs(member("owner", companyId));

    const installed = await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({});
    expect(installed.status).toBe(201);

    const [binding] = await db.select().from(storeInstallResources).where(and(eq(storeInstallResources.companyId, companyId), eq(storeInstallResources.resourceKey, AUTOMATION_ROUTINE_KEY)));
    expect(binding).toBeTruthy();
    const [routine] = await db.select().from(routines).where(eq(routines.id, binding.resourceId));
    expect(routine).toMatchObject({ mode: "steps", status: "active", originKind: AUTOMATION_ORIGINS.store, title: "Ask for a review" });
    expect(routine.definition).toMatchObject({ trigger: { type: "event", event: "booking.completed" } });
    expect(routine.variables.map((v) => [v.name, v.defaultValue])).toEqual([["delay_minutes", 1440], ["reminder_phone", ""]]);
    const triggers = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine.id));
    expect(triggers.map((t) => [t.kind, t.eventName, t.enabled])).toEqual([["event", "booking.completed", true]]);

    const listed = await request(owner).get(`/api/companies/${companyId}/automations`);
    expect(listed.status).toBe(200);
    expect(listed.body.automations).toHaveLength(1);
    expect(listed.body.automations[0]).toMatchObject({ id: routine.id, item_key: "review-request", enabled: true, installed: true, version: "1.0.0", latest_version: "1.0.0", update_available: false, config: { delay_minutes: 1440, reminder_phone: "" } });
    expect(listed.body.automations[0].steps_summary.map((s: { id: string }) => s.id)).toEqual(["pause", "note"]);

    const patched = await request(owner).patch(`/api/companies/${companyId}/automations/${routine.id}`).send({ config: { delay_minutes: 60, not_a_setting: "x" }, enabled: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ enabled: false, config: { delay_minutes: 60, reminder_phone: "" } });
    expect("not_a_setting" in patched.body.config).toBe(false);
    expect((await db.select().from(routines).where(eq(routines.id, routine.id)))[0].status).toBe("paused");

    expect((await request(owner).patch(`/api/companies/${companyId}/automations/${routine.id}`).send({ enabled: true })).body.enabled).toBe(true);
    const ran = await request(owner).post(`/api/companies/${companyId}/automations/${routine.id}/run`).send({ dry_run: true, input: { ref: { booking_id: "b-9" } } });
    expect(ran.status).toBe(200);
    expect(ran.body.result.status).toBe("ok");
    expect(ran.body.result.steps_log.map((s: { id: string; status: string }) => s.status)).toEqual(["ok", "ok"]);
    expect(ran.body.result.steps_log[1].output).toEqual({ message: "Review asked for b-9" });
    expect(ran.body.result.steps_log[0].output.would_wait.minutes).toBe(60);
    const forReal = await request(owner).post(`/api/companies/${companyId}/automations/${routine.id}/run`).send({});
    expect(forReal.body.result.status).toBe("waiting");
    const runs = await request(owner).get(`/api/companies/${companyId}/automations/${routine.id}/runs`);
    expect(runs.body.runs).toHaveLength(2);
    expect(runs.body.runs[0].steps).toHaveLength(1);

    // Another company cannot see or touch it.
    const otherCompany = await seedCompany("OTH", "someone");
    const other = appAs(member("someone", otherCompany));
    expect((await request(other).patch(`/api/companies/${otherCompany}/automations/${routine.id}`).send({ enabled: false })).status).toBe(404);
    expect((await request(other).get(`/api/companies/${companyId}/automations`)).status).toBe(403);

    // Uninstall: the routine is switched off, the pending wait cancelled, settings and runs kept, the binding kept.
    expect((await request(owner).delete(`/api/companies/${companyId}/store/${itemId}`)).status).toBe(204);
    const [after] = await db.select().from(routines).where(eq(routines.id, routine.id));
    expect(after.status).toBe("paused");
    expect(after.variables.find((v) => v.name === "delay_minutes")?.defaultValue).toBe(60);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId, routine.id))).toHaveLength(2);
    expect((await db.select().from(routineWaits).where(eq(routineWaits.routineId, routine.id)))[0].state).toBe("cancelled");
    expect(await db.select().from(storeInstalls).where(eq(storeInstalls.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(storeInstallResources).where(eq(storeInstallResources.resourceId, routine.id))).toHaveLength(1);

    // Reinstall finds the same routine, switched back on with its settings.
    expect((await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({})).status).toBe(201);
    const [again] = await db.select().from(routines).where(eq(routines.id, routine.id));
    expect(again.status).toBe("active");
    expect(again.variables.find((v) => v.name === "delay_minutes")?.defaultValue).toBe(60);
    expect(await db.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.mode, "steps")))).toHaveLength(1);
  });

  it("a new version moves the pinned definition and its trigger; a webhook automation gets a per-install URL that rotates", async () => {
    const hookDefinition = { ...DEFINITION, name: "On call", trigger: { type: "webhook" }, steps: [{ id: "l", type: "log", config: { message: "{{ trigger.payload.x }}" } }] };
    const itemId = await publishAutomation("on-call", hookDefinition);
    const companyId = await seedCompany("HOK");
    const owner = appAs(member("owner", companyId));
    expect((await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({})).status).toBe(201);
    const listed = await request(owner).get(`/api/companies/${companyId}/automations`);
    const auto = listed.body.automations[0];
    expect(auto.hook_url).toMatch(/^https:\/\/paperclip\.example\.test\/api\/automations\/hook\/[a-f0-9]{24}$/);
    const rotated = await request(owner).post(`/api/companies/${companyId}/automations/${auto.id}/hook/rotate`).send({});
    expect(rotated.status).toBe(200);
    expect(rotated.body.hook_url).toMatch(/\/api\/automations\/hook\/[a-f0-9]{24}$/);
    expect(rotated.body.hook_url).not.toBe(auto.hook_url);

    const v2 = await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "2.0.0", payload: { automation: { ...hookDefinition, trigger: { type: "schedule", every: "day", at: "09:00", timezone: "America/Chicago" } } } });
    expect(v2.status).toBe(201);
    expect(v2.body.appliedTo).toBe(1);
    const [routine] = await db.select().from(routines).where(eq(routines.id, auto.id));
    expect((routine.definition as { trigger: { type: string } }).trigger.type).toBe("schedule");
    const triggers = await db.select().from(routineTriggers).where(and(eq(routineTriggers.routineId, auto.id), eq(routineTriggers.archived, false)));
    expect(triggers.map((t) => [t.kind, t.cronExpression, t.timezone])).toEqual([["schedule", "0 9 * * *", "America/Chicago"]]);
    const after = await request(owner).get(`/api/companies/${companyId}/automations`);
    expect(after.body.automations[0]).toMatchObject({ version: "2.0.0", update_available: false, hook_url: null });
  });

  it("owner drafts: saved with problems, listed, refused until fixed, then published as a live company automation", async () => {
    const companyId = await seedCompany("DRF");
    const owner = appAs(member("owner", companyId));
    const bad = await request(owner).post(`/api/companies/${companyId}/automations/drafts`).send({ name: "My reminder", trigger: { type: "event", event: "nope.nothing" }, steps: [{ id: "s", type: "script", config: { code: "return 1" } }] });
    expect(bad.status).toBe(201);
    expect(bad.body.problems.some((p: string) => /only available to the platform/.test(p))).toBe(true);
    expect(bad.body.problems.some((p: string) => /No installed app or platform event/.test(p))).toBe(true);
    const drafts = await request(owner).get(`/api/companies/${companyId}/automations/drafts`);
    expect(drafts.body.drafts).toHaveLength(1);
    expect(drafts.body.drafts[0].problems).toHaveLength(2);
    const refused = await request(owner).post(`/api/companies/${companyId}/automations/drafts/${bad.body.draft.id}/publish`);
    expect(refused.status).toBe(400);
    expect(refused.body.problems).toHaveLength(2);
    const fixed = await request(owner).post(`/api/companies/${companyId}/automations/drafts`).send({ id: bad.body.draft.id, name: "My reminder", trigger: { type: "event", event: "booking.completed" }, steps: [{ id: "l", type: "log", config: { message: "hi {{ trigger.ref.booking_id }}" } }] });
    expect(fixed.status).toBe(200);
    expect(fixed.body.problems).toEqual([]);
    const published = await request(owner).post(`/api/companies/${companyId}/automations/drafts/${bad.body.draft.id}/publish`);
    expect(published.status).toBe(200);
    const [routine] = await db.select().from(routines).where(eq(routines.id, bad.body.draft.id));
    expect(routine).toMatchObject({ status: "active", originKind: AUTOMATION_ORIGINS.owner, mode: "steps" });
    expect((await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine.id))).map((t) => [t.kind, t.eventName])).toEqual([["event", "booking.completed"]]);
    expect((await request(owner).get(`/api/companies/${companyId}/automations/drafts`)).body.drafts).toHaveLength(0);
    const listed = await request(owner).get(`/api/companies/${companyId}/automations`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.automations[0]).toMatchObject({ id: routine.id, item_key: null, installed: false, enabled: true, origin: AUTOMATION_ORIGINS.owner });
    // An owner-built routine may not run the platform-only steps even when forced in.
    await db.update(routines).set({ definition: { ...routine.definition as object, steps: [{ id: "s", type: "script", config: { code: "return 1" } }] } }).where(eq(routines.id, routine.id));
    const [forced] = await db.select().from(routines).where(eq(routines.id, routine.id));
    const ran = await request(owner).post(`/api/companies/${companyId}/automations/${forced.id}/run`).send({ dry_run: true });
    expect(ran.body.result.status).toBe("failed");
    expect(ran.body.result.error).toMatch(/only available to the platform/);
    const meta = await request(owner).get(`/api/companies/${companyId}/automations/meta`);
    expect(meta.body.steps.some((s: { type: string }) => s.type === "script")).toBe(false);
    expect(meta.body.triggers).toHaveLength(4);
    expect(meta.body.events.some((e: { name: string }) => e.name === "booking.completed")).toBe(true);
    const adminMeta = await request(appAs(admin)).get("/api/automations/admin/meta");
    expect(adminMeta.body.steps.some((s: { type: string }) => s.type === "script")).toBe(true);
    const recent = await request(appAs(admin)).get(`/api/automations/admin/runs/recent?companyId=${companyId}`);
    expect(recent.status).toBe(200);
    expect(recent.body.runs).toHaveLength(1);
  });

  describe("entitlement (port of gcr decide)", () => {
    const now = new Date("2026-10-05T00:00:00.000Z");
    it("free, grant and plan, in that order; unpublished and not entitled refused", () => {
      const item = { id: "i", status: "published", access: "plan" };
      expect(decide({ item: { ...item, access: "free" }, planItemIds: new Set(), grant: null, now })).toEqual({ ok: true, reason: "free" });
      expect(decide({ item, planItemIds: new Set(["i"]), grant: null, now })).toEqual({ ok: true, reason: "plan" });
      expect(decide({ item, planItemIds: new Set(), grant: { expiresAt: "2026-12-01T00:00:00Z" }, now })).toEqual({ ok: true, reason: "grant" });
      expect(decide({ item, planItemIds: new Set(), grant: { expiresAt: "2026-01-01T00:00:00Z" }, now })).toEqual({ ok: false, reason: "not_entitled" });
      expect(decide({ item, planItemIds: new Set(), grant: { revokedAt: now }, now })).toEqual({ ok: false, reason: "not_entitled" });
      expect(decide({ item: { ...item, access: "grant" }, planItemIds: new Set(["i"]), grant: null, now })).toEqual({ ok: false, reason: "not_entitled" });
      expect(decide({ item: { ...item, status: "draft", access: "free" }, planItemIds: new Set(), grant: null, now })).toEqual({ ok: false, reason: "unpublished" });
    });

    it("plans, grants and company plans through the admin routes; the store refuses what the plan excludes and a paused company's priced installs", async () => {
      const adminApp = appAs(admin);
      const companyId = await seedCompany("ENT");
      const owner = appAs(member("owner", companyId));
      const created = await request(adminApp).post("/api/store/admin/items").send({ key: "premium-skill", kind: "skill", name: "Premium", access: "plan" });
      const itemId = created.body.id as string;
      await request(adminApp).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "1.0.0", payload: {} });
      await request(adminApp).post(`/api/store/admin/items/${itemId}/publish`);

      const refused = await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({});
      expect(refused.status).toBe(402);
      expect(refused.body).toMatchObject({ code: "not_entitled", reason: "not_entitled" });
      expect((await request(owner).get(`/api/companies/${companyId}/entitlement?itemKey=premium-skill`)).body).toMatchObject({ allowed: false, reason: "not_entitled" });

      const plan = await request(adminApp).post("/api/entitlement/admin/plans").send({ key: "starter", name: "Starter", isDefault: true });
      expect(plan.status).toBe(201);
      expect((await request(adminApp).post(`/api/entitlement/admin/plans/${plan.body.plan.id}/items`).send({ itemId })).status).toBe(201);
      expect((await request(adminApp).get("/api/entitlement/admin/plans")).body.plans[0].items.map((i: { key: string }) => i.key)).toEqual(["premium-skill"]);
      expect((await request(owner).get(`/api/companies/${companyId}/entitlement?itemKey=premium-skill`)).body).toMatchObject({ allowed: true, reason: "plan", planKey: "starter" });
      expect((await request(adminApp).delete(`/api/entitlement/admin/plans/${plan.body.plan.id}/items/${itemId}`)).status).toBe(200);
      expect((await request(owner).get(`/api/companies/${companyId}/entitlement?itemKey=premium-skill`)).body.allowed).toBe(false);

      const grant = await request(adminApp).post("/api/entitlement/admin/grants").send({ companyId, itemId, note: "trial" });
      expect(grant.status).toBe(201);
      expect((await request(owner).get(`/api/companies/${companyId}/entitlement?itemKey=premium-skill`)).body).toMatchObject({ allowed: true, reason: "grant" });
      expect((await request(adminApp).get(`/api/entitlement/admin/grants?companyId=${companyId}`)).body.grants).toHaveLength(1);
      expect((await request(adminApp).post(`/api/entitlement/admin/grants/${grant.body.grant.id}/revoke`)).status).toBe(200);
      expect((await request(owner).get(`/api/companies/${companyId}/entitlement?itemKey=premium-skill`)).body.allowed).toBe(false);
      expect((await request(adminApp).get(`/api/entitlement/admin/grants?companyId=${companyId}`)).body.grants).toHaveLength(0);

      // Priced + paused: refused even when entitled; prices are authoritative here (nothing forwarded).
      const priced = await request(adminApp).put(`/api/store/admin/items/${itemId}/price`).send({ amountCents: 1500, currency: "usd", interval: "month" });
      expect(priced.status).toBe(200);
      expect(priced.body.billing).toEqual({ authoritative: "paperclip" });
      expect(priced.body.warning).toBeUndefined();
      await request(adminApp).post(`/api/entitlement/admin/plans/${plan.body.plan.id}/items`).send({ itemId });
      expect((await request(adminApp).put(`/api/entitlement/admin/companies/${companyId}/plan`).send({ planId: plan.body.plan.id, status: "paused", pauseReason: "unpaid" })).status).toBe(200);
      const paused = await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({});
      expect(paused.status).toBe(402);
      expect(paused.body).toMatchObject({ code: "not_entitled", paused: true, priceCents: 1500, interval: "month" });
      expect((await request(adminApp).put(`/api/entitlement/admin/companies/${companyId}/plan`).send({ planId: plan.body.plan.id, status: "active" })).status).toBe(200);
      const installed = await request(owner).post(`/api/companies/${companyId}/store/${itemId}/install`).send({});
      expect(installed.status).toBe(201);
      expect(installed.body.charge).toEqual({ priceCents: 1500, interval: "month" });
      expect((await request(adminApp).get(`/api/entitlement/admin/companies/${companyId}/plan`)).body).toMatchObject({ paused: false, usingDefault: false });
      expect((await request(owner).get("/api/entitlement/admin/plans")).status).toBe(403);

      const svc = entitlementService(db);
      expect((await svc.entitlementFor(companyId, "premium-skill")).reason).toBe("plan");
      expect(await db.select().from(storeGrants)).toHaveLength(1);
      expect(await db.select().from(storePlanItems)).toHaveLength(1);
      expect(await db.select().from(storePlans)).toHaveLength(1);
      expect(await db.select().from(storeItemVersions).where(eq(storeItemVersions.itemId, itemId))).toHaveLength(1);
      expect((await db.select().from(storeItems).where(eq(storeItems.id, itemId)))[0].access).toBe("plan");
      void storeService;
    });
  });
});
