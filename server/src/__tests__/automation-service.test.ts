import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  nextgentBusinessLinks,
  notificationLog,
  notificationSettings,
  routineRunSteps,
  routineRuns,
  routineTriggers,
  routineWaits,
  routines,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { nextgentEventRoutes } from "../routes/nextgent-events.js";
import { notificationRoutes } from "../routes/notifications.js";
import { automationService } from "../services/automation/index.js";
import type { NextgentConfig } from "../services/nextgent-config.js";
import { signNextgentRequest } from "../services/nextgent-service-signing.js";
import { notifyService } from "../services/notify/index.js";
import { routineService } from "../services/routines.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

const SECRET = "shared";
const config: NextgentConfig = {
  gcrApiUrl: "https://gcr.example.test",
  serviceSecret: SECRET,
  publicUrl: "https://paperclip.example.test",
  litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null },
  assistant: { name: null, instructionsFile: null, adapterType: null },
  platformCompanyId: null,
  businessTokenTtlSeconds: 300,
  acceptLegacySignatures: false,
  storePricing: { models: [], intervals: [], defaultCurrency: null },
};

const REVIEW_DEFINITION = {
  name: "Ask for a review",
  trigger: { type: "event", event: "booking.completed" },
  config_schema: [{ key: "delay_minutes", label: "Wait", type: "number", default: 1440 }],
  steps: [
    { id: "pause", type: "wait", config: { minutes: "{{ config.delay_minutes }}" } },
    { id: "note", type: "log", config: { message: "Review asked for {{ trigger.ref.booking_id }}" } },
  ],
};

describeEmbeddedPostgres("automation service (events, waits, hooks, notifications)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.PAPERCLIP_API_URL = "https://paperclip.example.test";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-automation-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE companies CASCADE`);
  });

  afterAll(async () => {
    process.env = savedEnv;
    await tempDb?.cleanup();
  });

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: prefix, issuePrefix: prefix });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: `owner-${prefix}`, status: "active", membershipRole: "owner" });
    return companyId;
  }

  async function seedStepsRoutine(companyId: string, definition: Record<string, unknown>, variables: Array<Record<string, unknown>> = []) {
    const svc = routineService(db);
    const routine = await svc.create(companyId, {
      title: String(definition.name),
      description: null,
      priority: "medium",
      status: "active",
      concurrencyPolicy: "always_enqueue",
      catchUpPolicy: "skip_missed",
      variables: variables as never,
      mode: "steps",
      definition: definition as never,
    } as never, { userId: `owner-${companyId}` });
    await db.update(routines).set({ originKind: "store", originId: "review-request" }).where(eq(routines.id, routine.id));
    return (await db.select().from(routines).where(eq(routines.id, routine.id)))[0];
  }

  const signed = (path: string, body: string, secret = SECRET) => signNextgentRequest(secret, { method: "POST", pathname: path, query: "", rawBody: body });

  function publicApp(clock?: () => Date) {
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
    app.use(nextgentEventRoutes(db, { config, clock }));
    app.use(errorHandler);
    return app;
  }

  const envelope = (companyId: string, eventId = "evt-1") => ({ companyId, event: "booking.completed", eventId, occurredAt: "2026-10-01T18:30:00.000Z", ref: { booking_id: "b-1", date: "2026-10-01", party: 2 } });

  it("a signed event fans out to the company's event trigger, idempotent on eventId, and a wait is saved", async () => {
    const companyId = await seedCompany("EVT");
    const seeded = await seedStepsRoutine(companyId, REVIEW_DEFINITION);
    const svc = routineService(db);
    await svc.createTrigger(seeded.id, { kind: "event", eventName: "booking.completed", enabled: true } as never, { userId: "owner" });
    const [routine] = await db.select().from(routines).where(eq(routines.id, seeded.id));
    const app = publicApp(() => new Date("2026-10-01T18:30:00.000Z"));
    const body = JSON.stringify(envelope(companyId));

    const unsigned = await request(app).post("/api/nextgent/events").set("content-type", "application/json").send(body);
    expect(unsigned.status).toBe(401);

    const first = await request(app).post("/api/nextgent/events").set("content-type", "application/json").set(signed("/api/nextgent/events", body)).send(body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ accepted: true, ran: 1, skipped: 0 });
    expect(first.body.runs[0].status).toBe("waiting");

    const runs = await db.select().from(routineRuns).where(eq(routineRuns.routineId, routine.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ source: "event", status: "waiting", idempotencyKey: "evt-1", dryRun: false });
    expect(JSON.stringify(runs[0].triggerPayload)).not.toMatch(/@/);
    const waits = await db.select().from(routineWaits).where(eq(routineWaits.runId, runs[0].id));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ state: "waiting", stepIndex: 1, routineRevisionId: routine.latestRevisionId });
    expect(waits[0].dueAt.toISOString()).toBe("2026-10-02T18:30:00.000Z");

    const again = await request(app).post("/api/nextgent/events").set("content-type", "application/json").set(signed("/api/nextgent/events", body)).send(body);
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ accepted: true, ran: 0, skipped: 1 });
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId, routine.id))).toHaveLength(1);
  });

  it("a malformed envelope or an unknown company still answers 202, accepted: false", async () => {
    const app = publicApp();
    const bad = JSON.stringify({ companyId: randomUUID(), event: "notdotted", eventId: "x", occurredAt: "now" });
    const res = await request(app).post("/api/nextgent/events").set("content-type", "application/json").set(signed("/api/nextgent/events", bad)).send(bad);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: false, reason: "invalid" });
    const unknown = JSON.stringify(envelope(randomUUID()));
    const res2 = await request(app).post("/api/nextgent/events").set("content-type", "application/json").set(signed("/api/nextgent/events", unknown)).send(unknown);
    expect(res2.status).toBe(202);
    expect(res2.body).toMatchObject({ accepted: false, reason: "unknown_company" });
  });

  it("a due wait is claimed and resumed on the revision it started on; a paused routine's wait is cancelled", async () => {
    const companyId = await seedCompany("WAI");
    const routine = await seedStepsRoutine(companyId, REVIEW_DEFINITION, [{ name: "delay_minutes", type: "number", defaultValue: 60 }]);
    await routineService(db).createTrigger(routine.id, { kind: "event", eventName: "booking.completed", enabled: true } as never, { userId: "owner" });
    const started = new Date("2026-10-01T18:30:00.000Z");
    const automations = automationService(db, { config, clock: () => started });
    await automations.fanOutEvent(envelope(companyId, "evt-w"));
    const [run] = await db.select().from(routineRuns).where(eq(routineRuns.routineId, routine.id));
    expect(run.status).toBe("waiting");
    const [wait] = await db.select().from(routineWaits).where(eq(routineWaits.runId, run.id));
    expect(wait.dueAt.toISOString()).toBe("2026-10-01T19:30:00.000Z");

    // Not before it is due.
    expect(await automations.resumeDueWaits(new Date("2026-10-01T19:00:00.000Z"))).toMatchObject({ due: 0 });
    // The definition on the routine moves on; the run resumes on the pinned revision.
    await db.update(routines).set({ definition: { ...REVIEW_DEFINITION, steps: [REVIEW_DEFINITION.steps[0], { id: "changed", type: "log", config: { message: "new version" } }] } }).where(eq(routines.id, routine.id));
    const later = new Date("2026-10-01T19:35:00.000Z");
    const summary = await automations.resumeDueWaits(later);
    expect(summary).toMatchObject({ due: 1, resumed: 1, cancelled: 0, failed: 0 });
    const [finished] = await db.select().from(routineRuns).where(eq(routineRuns.id, run.id));
    expect(finished.status).toBe("completed");
    expect(finished.completedAt).not.toBeNull();
    const steps = await db.select().from(routineRunSteps).where(eq(routineRunSteps.runId, run.id)).orderBy(routineRunSteps.position);
    expect(steps.map((s) => `${s.stepId}:${s.status}`)).toEqual(["pause:waiting", "note:ok"]);
    expect((steps[1].output as { message: string }).message).toBe("Review asked for b-1");
    expect((await db.select().from(routineWaits).where(eq(routineWaits.id, wait.id)))[0].state).toBe("done");
    expect(await automations.resumeDueWaits(later)).toMatchObject({ due: 0 });
    const [touched] = await db.select().from(routines).where(eq(routines.id, routine.id));
    expect(touched.lastRunStatus).toBe("completed");

    // A second wait, then the routine is switched off: the wait is cancelled, the run skipped.
    await automations.fanOutEvent(envelope(companyId, "evt-w2"));
    await db.update(routines).set({ status: "paused" }).where(eq(routines.id, routine.id));
    const cancelled = await automations.resumeDueWaits(new Date("2026-10-03T00:00:00.000Z"));
    expect(cancelled).toMatchObject({ due: 1, cancelled: 1, resumed: 0 });
    const skipped = await db.select().from(routineRuns).where(and(eq(routineRuns.routineId, routine.id), eq(routineRuns.idempotencyKey, "evt-w2")));
    expect(skipped[0]).toMatchObject({ status: "skipped", failureReason: "Switched off while waiting" });
  });

  it("the routine service dispatches a steps routine through the runner: manual run and the scheduler tick", async () => {
    const companyId = await seedCompany("DSP");
    const definition = { name: "Hourly note", trigger: { type: "schedule", every: "hour" }, config_schema: [], steps: [{ id: "l", type: "log", config: { message: "tick {{ trigger.type }}" } }] };
    const routine = await seedStepsRoutine(companyId, definition);
    const svc = routineService(db);
    const manual = await svc.runRoutine(routine.id, { source: "manual" } as never, { userId: "owner" });
    expect(manual).toMatchObject({ source: "manual", status: "completed" });
    const steps = await db.select().from(routineRunSteps).where(eq(routineRunSteps.runId, manual.id));
    expect(steps[0].output).toEqual({ message: "tick manual" });

    const { trigger } = await svc.createTrigger(routine.id, { kind: "schedule", cronExpression: "0 * * * *", timezone: "UTC", enabled: true }, { userId: "owner" });
    await db.update(routineTriggers).set({ nextRunAt: new Date("2026-10-01T00:00:00.000Z") }).where(eq(routineTriggers.id, trigger.id));
    const tick = await svc.tickScheduledTriggers(new Date("2026-10-01T00:00:05.000Z"));
    expect(tick).toEqual({ triggered: 1 });
    const scheduled = await db.select().from(routineRuns).where(and(eq(routineRuns.routineId, routine.id), eq(routineRuns.source, "schedule")));
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].status).toBe("completed");
    const [after] = await db.select().from(routineTriggers).where(eq(routineTriggers.id, trigger.id));
    expect(after.nextRunAt?.toISOString()).toBe("2026-10-01T01:00:00.000Z");
  });

  it("the per-install hook: unknown 404, switched off 202, not a webhook 400, else the run", async () => {
    const companyId = await seedCompany("HOK");
    const definition = { name: "On call", trigger: { type: "webhook" }, config_schema: [], steps: [{ id: "l", type: "log", config: { message: "got {{ trigger.payload.x }}" } }] };
    const routine = await seedStepsRoutine(companyId, definition);
    const svc = routineService(db);
    const { trigger } = await svc.createTrigger(routine.id, { kind: "webhook", signingMode: "none", replayWindowSec: 300, enabled: true }, { userId: "owner" });
    const app = publicApp();
    expect((await request(app).post("/api/automations/hook/deadbeefdeadbeefdeadbeef").send({ x: 1 })).status).toBe(404);
    expect((await request(app).post("/api/automations/hook/short").send({ x: 1 })).status).toBe(404);
    const ok = await request(app).post(`/api/automations/hook/${trigger.publicId}`).send({ x: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ accepted: true, status: "ok" });
    const steps = await db.select().from(routineRunSteps).where(eq(routineRunSteps.runId, ok.body.run_id));
    expect(steps[0].output).toEqual({ message: "got 1" });
    await db.update(routines).set({ status: "paused" }).where(eq(routines.id, routine.id));
    const off = await request(app).post(`/api/automations/hook/${trigger.publicId}`).send({ x: 2 });
    expect(off.status).toBe(202);
    expect(off.body).toEqual({ accepted: false, reason: "switched off" });
    await db.update(routines).set({ status: "active", definition: { ...definition, trigger: { type: "manual" } } }).where(eq(routines.id, routine.id));
    expect((await request(app).post(`/api/automations/hook/${trigger.publicId}`).send({ x: 3 })).status).toBe(400);
  });

  it("notifyOwner: only a linked company, dedupe by ref, mute per kind, every attempt logged; settings routes", async () => {
    const companyId = await seedCompany("NTF");
    const emails: Array<{ to: string; subject: string }> = [];
    const texts: Array<{ to: string; body: string }> = [];
    const notify = notifyService(db, {
      config,
      env: { OWNER_APP_URL: "https://owner.example.test/" },
      mail: { name: "fake", send: async (m) => { emails.push({ to: m.to, subject: m.subject }); return { success: true, id: "em" }; } },
      text: { send: async (t) => { texts.push({ to: t.to, body: t.body }); return { success: true, id: "sm" }; } },
    });
    const notice = { kind: "failed_action", title: "An automation did not finish: x", body: "boom", ref: "run:1", link: "automations" };
    expect(await notify.notifyOwner(companyId, notice)).toEqual({ sent: false, skipped: "not_claimed" });
    await db.insert(nextgentBusinessLinks).values({ companyId, entitySlug: "shop" });
    expect(await notify.notifyOwner(companyId, notice)).toMatchObject({ sent: false, channels: { skipped: "no_contact" } });
    await notify.updateSettings(companyId, { email: "owner@shop.test", phone: "(251) 555-0100" }, "owner");
    expect(await notify.notifyOwner(companyId, { ...notice, ref: "run:2" })).toEqual({ sent: true, channels: { email: "sent", sms: "sent" } });
    expect(emails).toEqual([{ to: "owner@shop.test", subject: notice.title }]);
    expect(texts).toEqual([{ to: "+12515550100", body: `${notice.title} https://owner.example.test/automations` }]);
    expect(await notify.notifyOwner(companyId, { ...notice, ref: "run:2" })).toEqual({ sent: false, skipped: "duplicate" });
    await notify.updateSettings(companyId, { muted_kinds: ["failed_action"] }, "owner");
    expect(await notify.notifyOwner(companyId, { ...notice, ref: "run:3" })).toEqual({ sent: false, skipped: "muted" });
    expect(await notify.notifyOwner(companyId, { ...notice, kind: "nope" })).toEqual({ sent: false, skipped: "unknown_kind" });
    const log = await db.select().from(notificationLog).where(eq(notificationLog.companyId, companyId));
    expect(log.map((row) => row.channels)).toEqual([{ skipped: "no_contact" }, { email: "sent", sms: "sent" }, { skipped: "muted" }]);
    await expect(notify.updateSettings(companyId, { email: "nope" }, "owner")).rejects.toMatchObject({ status: 400 });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { actor: unknown }).actor = { type: "board", source: "session", userId: "owner", companyIds: [companyId], isInstanceAdmin: false, memberships: [{ companyId, membershipRole: "owner", status: "active" }] }; next(); });
    app.use("/api", notificationRoutes(db, { config, mail: { name: "fake", send: async () => ({ success: true }) }, text: { send: async () => ({ success: true }) } }));
    app.use(errorHandler);
    const got = await request(app).get(`/api/companies/${companyId}/notifications/settings`);
    expect(got.status).toBe(200);
    expect(got.body.settings).toMatchObject({ email: "owner@shop.test", phone: "+12515550100", muted_kinds: ["failed_action"] });
    expect(got.body.kinds).toEqual(["review", "unknown_sender", "approval", "failed_action"]);
    expect(got.body.recent).toHaveLength(3);
    const put = await request(app).put(`/api/companies/${companyId}/notifications/settings`).send({ sms_on: false, muted_kinds: [] });
    expect(put.status).toBe(200);
    expect(put.body.settings).toMatchObject({ sms_on: false, muted_kinds: [] });
    expect((await request(app).put(`/api/companies/${companyId}/notifications/settings`).send({ muted_kinds: ["bogus"] })).status).toBe(400);
    const other = await request(app).get(`/api/companies/${randomUUID()}/notifications/settings`);
    expect(other.status).toBe(403);
    const settings = await db.select().from(notificationSettings).where(eq(notificationSettings.companyId, companyId));
    expect(settings[0].smsOn).toBe(false);
    vi.restoreAllMocks();
  });
});
