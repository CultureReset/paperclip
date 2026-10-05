import { describe, expect, it, vi } from "vitest";
import { compare, render, renderDeep, resolveConfig, truncate } from "../services/automation/template.js";
import { runScript } from "../services/automation/steps/script.js";
import { runDefinition } from "../services/automation/runner.js";
import type { RunRecorder, RunnerDeps, StepLogEntry } from "../services/automation/types.js";

/**
 * Port of gcr-api-clean scripts/test-automations.js (templating, conditions,
 * script sandbox, runner) and the step cases of test-automation-steps.js,
 * against the Paperclip runner with fake deps. No database: the recorder is
 * in memory (DECISIONS #91: the dry-run step logs must match gcr's).
 */

/** gcr's DEFINITION, verbatim; `table` here carries the contract name. */
const DEFINITION = {
  name: "Nightly special",
  trigger: { type: "schedule", every: "day", at: "09:00" },
  config_schema: [{ key: "reminder_phone", label: "Phone", type: "tel", default: "" }],
  steps: [
    { id: "pick", type: "data.query", config: { table: "menu_items", filter: '{"is_active": true}', limit: 5 } },
    { id: "gate", type: "condition", config: { left: "{{ steps.pick.count }}", op: "gt", right: "0" } },
    { id: "post", type: "data.insert", config: { table: "entity_specials", values: '{"title": "Tonight: {{ steps.pick.rows.0.item_name }}"}' } },
    { id: "text", type: "sms.send", config: { to: "{{ config.reminder_phone }}", body: "Posted {{ steps.post.row.title }} for {{ business.name }}" } },
  ],
};

const CONFIG = { reminder_phone: "251-555-0100" };
const BUSINESS = { slug: "flora-bama", name: "Flora-Bama", phone: "(251) 555-0100", email: "fb@example.com" };

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

function fakeDeps(overrides: Partial<RunnerDeps> = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const texts: Array<{ to: string; body: string }> = [];
  const emails: Array<{ to: string; subject: string; html: string }> = [];
  const handoffs: unknown[] = [];
  const deps: RunnerDeps = {
    mcp: {
      async callTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
        calls.push({ tool, args });
        if (tool === "read_section" && args.section === "menu_items") {
          return { section: "menu_items", rows: [{ id: 1, item_name: "Bushwacker", is_active: true }, { id: 2, item_name: "Old", is_active: false }] } as T;
        }
        if (tool === "read_section") return { section: args.section, rows: [] } as T;
        if (tool === "create_row") return { row: { id: 77, ...(args.values as Record<string, unknown>) } } as T;
        if (tool === "update_row") return { row: { id: args.id, ...(args.values as Record<string, unknown>) } } as T;
        if (tool === "send_message") {
          if (args.channel === "sms" && !args.to_ref) return { id: null, status: "blocked", status_reason: "no_registered_number" } as T;
          return { id: "msg-1", status: "sent" } as T;
        }
        throw new Error(`unexpected tool ${tool}`);
      },
    },
    agent: async (handoff) => {
      handoffs.push(handoff);
      if (handoff.agentId === "foreign") throw new Error("That agent belongs to another business");
      return { accepted: true, agent_id: handoff.agentId ?? "agent-1", run: "run-pc", issue: "iss-1", routine_status: "issue_created" };
    },
    ai: async () => ({ text: "A fine special." }),
    notify: {
      ownNumbers: async () => new Set(["+12515550100"]),
      normalizePhone,
      text: async (request) => { texts.push({ to: request.to, body: request.body }); return { success: true, id: "SM1" }; },
      email: async (request) => { emails.push(request); return { success: true, id: "em" }; },
    },
    fetch: vi.fn() as unknown as RunnerDeps["fetch"],
    clock: () => new Date("2026-10-01T18:30:00.000Z"),
    env: {},
    ...overrides,
  };
  return { deps, calls, texts, emails, handoffs };
}

function memoryRecorder() {
  const runs = new Map<string, Record<string, unknown>>();
  const steps: Array<{ runId: string; position: number; entry: StepLogEntry }> = [];
  const waits: unknown[] = [];
  const touches: unknown[] = [];
  const failures: unknown[] = [];
  let n = 0;
  const recorder: RunRecorder = {
    async createRun(input) { const id = `run-${++n}`; runs.set(id, { status: "running", dryRun: input.dryRun, source: input.record.source }); return id; },
    async appendStep(input) { steps.push({ runId: input.runId, position: input.position, entry: input.entry }); },
    async finishRun(input) { runs.set(input.runId, { ...runs.get(input.runId), status: input.status, error: input.error, output: input.output, finishedAt: input.finishedAt }); },
    async saveWait(input) { waits.push(input); },
    async touchRoutine(input) { touches.push(input); },
    async notifyFailure(input) { failures.push(input); },
  };
  return { recorder, runs, steps, waits, touches, failures };
}

const RECORD = { routineId: "routine-1", routineRevisionId: "rev-1", source: "manual", automationKey: "nightly-special", version: 2 };

describe("templating (port)", () => {
  const ctx = { business: { name: "Flora-Bama" }, steps: { q: { rows: [{ id: 9 }], count: 1 } }, config: { n: 3 } };
  it("renders inline paths, whole-value templates and missing paths like gcr", () => {
    expect(render("Hi {{ business.name }}!", ctx)).toBe("Hi Flora-Bama!");
    expect(Array.isArray(render("{{ steps.q.rows }}", ctx))).toBe(true);
    expect(render("{{steps.q.rows.0.id}}", ctx)).toBe(9);
    expect(render("#{{steps.q.rows.0.id}}", ctx)).toBe("#9");
    expect(render("[{{ nope.x }}]", ctx)).toBe("[]");
    expect(render("row: {{ steps.q.rows.0 }}", ctx)).toBe('row: {"id":9}');
    expect((renderDeep({ a: ["{{ config.n }}"], b: { c: "{{ business.name }}" } }, ctx) as { b: { c: string } }).b.c).toBe("Flora-Bama");
  });
  it("compares like gcr", () => {
    expect(compare("3", "gt", "2")).toBe(true);
    expect(compare(3, "eq", "3")).toBe(true);
    expect(compare("Bushwacker", "contains", "wack")).toBe(true);
    expect(compare([], "empty")).toBe(true);
    expect(compare("false", "truthy")).toBe(false);
    expect(() => compare(1, "between", 2)).toThrow(/Unknown check/);
  });
  it("truncates at the budget and resolves config defaults", () => {
    const big = truncate({ rows: "x".repeat(9000) }, 8000) as { truncated: boolean; preview: string };
    expect(big.truncated).toBe(true);
    expect(big.preview.length).toBe(8000);
    expect(resolveConfig([{ key: "a", default: "1" }, { key: "b", type: "boolean" }], { b: true, zzz: 1 })).toEqual({ a: "1", b: true });
  });
});

describe("script sandbox (port)", () => {
  const ctx = { business: { name: "Flora-Bama" }, steps: { q: { rows: [{ id: 9 }], count: 1 } }, config: { n: 3 }, trigger: { type: "manual", payload: null }, now: "x" };
  it("sees the run and returns plain data", () => {
    const out = runScript("return { n: steps.q.count * 2, name: business.name.toUpperCase() }", ctx) as { n: number; name: string };
    expect(out).toEqual({ n: 2, name: "FLORA-BAMA" });
  });
  it("keeps process and require out of scope and cuts off an infinite loop", () => {
    expect(() => runScript("return process.env", ctx)).toThrow(/process is not defined/);
    expect(() => runScript('return require("fs")', ctx)).toThrow(/require is not defined/);
    expect(() => runScript("while (true) {}", ctx, undefined, 200)).toThrow(/timed out|Script execution/i);
  });
});

describe("runner — a real run is scoped to the business's token and records itself", () => {
  it("runs the four steps, through the MCP, and records the run first", async () => {
    const { deps, calls, texts } = fakeDeps();
    const mem = memoryRecorder();
    const run = await runDefinition({ definition: DEFINITION, companyId: "co-1", business: BUSINESS, trigger: { type: "manual", payload: null }, config: CONFIG, record: RECORD, deps, recorder: mem.recorder, allowAdminSteps: true });
    expect(run.status).toBe("ok");
    expect(run.steps_log.map((s) => s.id)).toEqual(["pick", "gate", "post", "text"]);
    expect(calls[0]).toMatchObject({ tool: "read_section", args: { section: "menu_items" } });
    expect((run.steps_log[0].output as { count: number }).count).toBe(1);
    const ins = calls.find((c) => c.tool === "create_row");
    expect(ins?.args).toEqual({ section: "entity_specials", values: { title: "Tonight: Bushwacker" } });
    expect(texts).toEqual([{ to: "251-555-0100", body: "Posted Tonight: Bushwacker for Flora-Bama" }]);
    expect(run.run_id).toBe("run-1");
    expect(mem.runs.get("run-1")).toMatchObject({ status: "ok", source: "manual" });
    expect(mem.steps.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(mem.touches[0]).toMatchObject({ routineId: "routine-1", lastRunStatus: "ok" });
  });

  it("refuses a text to a number that is not the business's own", async () => {
    const { deps, texts } = fakeDeps();
    const run = await runDefinition({ definition: DEFINITION, companyId: "co-1", business: BUSINESS, trigger: { type: "manual", payload: null }, config: { reminder_phone: "251-555-0999" }, deps, recorder: null });
    expect(run.status).toBe("failed");
    expect(texts).toEqual([]);
    expect(run.error).toMatch(/only goes to the business's own numbers/);
  });

  it("a dry run reads but never writes or sends, and shows the would-insert", async () => {
    const { deps, calls, texts } = fakeDeps();
    const dry = await runDefinition({ definition: DEFINITION, companyId: "co-1", business: BUSINESS, trigger: { type: "test", payload: null }, config: CONFIG, dryRun: true, deps, recorder: null });
    expect(dry.status).toBe("ok");
    expect(calls.some((c) => c.tool === "create_row")).toBe(false);
    expect(texts).toEqual([]);
    expect(dry.steps_log.filter((s) => s.status === "dry_run")).toHaveLength(2);
    expect((dry.steps_log[2].output as { would_insert: { values: { title: string } } }).would_insert.values.title).toBe("Tonight: Bushwacker");
    expect((dry.steps_log[3].output as { would_text: { to: string } }).would_text.to).toBe("251-555-0100");
  });

  it("a failed condition stops the run as skipped", async () => {
    const { deps } = fakeDeps();
    const gated = await runDefinition({
      definition: { ...DEFINITION, steps: [{ id: "gate", type: "condition", config: { left: "0", op: "gt", right: "1" } }, DEFINITION.steps[3]] },
      companyId: "co-1", business: BUSINESS, trigger: { type: "manual", payload: null }, config: CONFIG, dryRun: true, deps, recorder: null,
    });
    expect(gated.status).toBe("skipped");
    expect(gated.steps_log).toHaveLength(1);
    expect(gated.steps_log[0].status).toBe("stopped");
  });

  it("an unknown step type fails the run; continue_on_error carries on", async () => {
    const { deps } = fakeDeps();
    const bad = await runDefinition({ definition: { ...DEFINITION, steps: [{ id: "q", type: "nope", config: {} }] }, companyId: "co-1", trigger: { type: "manual", payload: null }, dryRun: true, deps, recorder: null });
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/Unknown step type/);
    const tolerant = await runDefinition({
      definition: { ...DEFINITION, steps: [{ id: "q", type: "nope", continue_on_error: true, config: {} }, { id: "l", type: "log", config: { message: "still here" } }] },
      companyId: "co-1", trigger: { type: "manual", payload: null }, dryRun: true, deps, recorder: null,
    });
    expect(tolerant.status).toBe("ok");
    expect(tolerant.steps_log.map((s) => s.status)).toEqual(["failed", "ok"]);
  });

  it("without a business-data token the data steps fail with the reason", async () => {
    const { deps } = fakeDeps({ mcp: null });
    const run = await runDefinition({ definition: DEFINITION, companyId: "co-1", trigger: { type: "manual", payload: null }, config: CONFIG, deps, recorder: null });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/no business-data token/);
  });

  it("admin-only steps are refused unless the definition is the platform's", async () => {
    const { deps } = fakeDeps();
    const def = { name: "s", steps: [{ id: "s", type: "script", config: { code: "return { ok: true }" } }] };
    const owner = await runDefinition({ definition: def, companyId: "co-1", trigger: { type: "manual", payload: null }, deps, recorder: null });
    expect(owner.status).toBe("failed");
    expect(owner.error).toMatch(/only available to the platform/);
    const platform = await runDefinition({ definition: def, companyId: "co-1", trigger: { type: "manual", payload: null }, deps, recorder: null, allowAdminSteps: true });
    expect(platform.status).toBe("ok");
    expect(platform.steps_log[0].output).toEqual({ ok: true });
  });

  it("truncates a large step output at 8 KB in the log but keeps it whole for later steps", async () => {
    const { deps } = fakeDeps();
    const run = await runDefinition({
      definition: { name: "big", steps: [{ id: "t", type: "transform", config: { assign: JSON.stringify({ big: "x".repeat(9000) }) } }, { id: "l", type: "log", config: { message: "{{ steps.t.big }}" } }] },
      companyId: "co-1", trigger: { type: "manual", payload: null }, deps, recorder: null,
    });
    expect((run.steps_log[0].output as { truncated: boolean }).truncated).toBe(true);
    expect(((run.steps_log[1].output as { truncated?: boolean; preview?: string }).preview ?? "").length).toBe(8000);
  });
});

describe("wait, agent, message (port of test-automation-steps)", () => {
  const DEF = {
    name: "Ask for a review",
    trigger: { type: "event", event: "booking.completed" },
    config_schema: [],
    steps: [
      { id: "pause", type: "wait", config: { minutes: 1440 } },
      { id: "hand", type: "agent", config: { item_key: "{{ automation.key }}", instructions: "Ask the customer of booking {{ trigger.payload.ref.booking_id }} for a review", payload: { booking: "{{ trigger.payload.ref }}" } } },
      { id: "mail", type: "message", config: { channel: "email", to_ref: { contract: "booking.records", id: "{{ trigger.payload.ref.booking_id }}" }, subject: "How was it?", body: "Thanks for visiting {{ business.name }}!" } },
    ],
  };
  const TRIGGER = { type: "event", payload: { event: "booking.completed", ref: { booking_id: "b-1", date: "2026-10-01", party: 2 } } };

  it("a recorded run saves the wait 24 h out with the step to resume at, and nothing else happens yet", async () => {
    const { deps, handoffs, calls } = fakeDeps();
    const mem = memoryRecorder();
    const run = await runDefinition({ definition: DEF, companyId: "co-1", business: { slug: "shop", name: "The Shop" }, trigger: TRIGGER, record: { ...RECORD, source: "event", automationKey: "review-request" }, deps, recorder: mem.recorder });
    expect(run.status).toBe("waiting");
    expect(run.steps_log).toHaveLength(1);
    expect(run.steps_log[0].status).toBe("waiting");
    expect(mem.waits).toHaveLength(1);
    const wait = mem.waits[0] as { stepIndex: number; dueAt: string; context: { steps: Record<string, unknown> } };
    expect(wait.stepIndex).toBe(1);
    expect(new Date(wait.dueAt).getTime() - deps.clock().getTime()).toBe(24 * 3600e3);
    expect(mem.runs.get("run-1")).toMatchObject({ status: "waiting", finishedAt: null });
    expect(handoffs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("resumed: the agent is handed references only and the message goes by to_ref; the log is one piece", async () => {
    const { deps, handoffs, calls } = fakeDeps();
    const mem = memoryRecorder();
    const first = await runDefinition({ definition: DEF, companyId: "co-1", business: { slug: "shop", name: "The Shop" }, trigger: TRIGGER, record: { ...RECORD, source: "event", automationKey: "review-request" }, deps, recorder: mem.recorder });
    const resumed = await runDefinition({
      definition: DEF, companyId: "co-1", business: { slug: "shop", name: "The Shop" }, trigger: TRIGGER, record: { ...RECORD, source: "event", automationKey: "review-request" }, deps, recorder: mem.recorder,
      resume: { runId: first.run_id as string, stepIndex: 1, steps: {}, stepsLog: first.steps_log },
    });
    expect(resumed.status).toBe("ok");
    expect(resumed.steps_log.map((s) => s.id)).toEqual(["pause", "hand", "mail"]);
    const handoff = handoffs[0] as { itemKey: string; body: Record<string, unknown> };
    expect(handoff.itemKey).toBe("review-request");
    expect(handoff.body.instructions).toBe("Ask the customer of booking b-1 for a review");
    expect(handoff.body.payload).toEqual({ booking: { booking_id: "b-1", date: "2026-10-01", party: 2 } });
    expect(handoff.body.run).toMatchObject({ id: "run-1", step: "hand" });
    expect(JSON.stringify(handoff.body)).not.toMatch(/@|customer_name|customer_email/);
    const send = calls.find((c) => c.tool === "send_message");
    expect(send?.args).toEqual({ channel: "email", body: "Thanks for visiting The Shop!", require_approval: false, to_ref: { contract: "booking.records", id: "b-1" }, subject: "How was it?" });
    expect(mem.runs.get("run-1")).toMatchObject({ status: "ok" });
    expect(mem.steps.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("a wait beyond AUTOMATION_WAIT_MAX_MINUTES is refused", async () => {
    const { deps } = fakeDeps({ env: { AUTOMATION_WAIT_MAX_MINUTES: "60" } });
    const run = await runDefinition({ definition: DEF, companyId: "co-1", trigger: TRIGGER, deps, recorder: null });
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/at most 60 minutes/);
  });

  it("an agent step cannot use another business's agent, and a failed recorded run tells the owner", async () => {
    const { deps } = fakeDeps();
    const mem = memoryRecorder();
    const foreign = await runDefinition({ definition: { name: "x", steps: [{ id: "a", type: "agent", config: { agent_id: "foreign" } }] }, companyId: "co-1", trigger: { type: "manual", payload: null }, record: RECORD, deps, recorder: mem.recorder });
    expect(foreign.status).toBe("failed");
    expect(foreign.error).toMatch(/another business/);
    expect(mem.failures).toHaveLength(1);
    expect(mem.failures[0]).toMatchObject({ companyId: "co-1", runId: "run-1" });
  });

  it("a dry run neither waits nor sends; a text with no registered number fails the step with the reason", async () => {
    const { deps, calls } = fakeDeps();
    const mem = memoryRecorder();
    const dry = await runDefinition({
      definition: { name: "z", steps: [{ id: "w", type: "wait", config: { minutes: 5 } }, { id: "m", type: "message", config: { channel: "sms", to: "+15550001111", body: "x" } }] },
      companyId: "co-1", trigger: { type: "test", payload: null }, dryRun: true, record: RECORD, deps, recorder: mem.recorder,
    });
    expect(dry.status).toBe("ok");
    expect(dry.steps_log).toHaveLength(2);
    expect(mem.waits).toHaveLength(0);
    expect(calls).toHaveLength(0);
    const blocked = await runDefinition({
      definition: { name: "b", steps: [{ id: "m", type: "message", config: { channel: "sms", to: "+15550001111", body: "x" } }] },
      companyId: "co-1", trigger: { type: "manual", payload: null }, deps, recorder: null,
    });
    expect(blocked.status).toBe("failed");
    expect(blocked.error).toMatch(/no_registered_number/);
  });

  it("an unrecorded run that reaches a wait reports it instead of waiting", async () => {
    const { deps } = fakeDeps();
    const run = await runDefinition({ definition: DEF, companyId: "co-1", trigger: TRIGGER, deps, recorder: null });
    expect(run.status).toBe("ok");
    expect(run.waited).toEqual({ stepIndex: 1, dueAt: "2026-10-02T18:30:00.000Z" });
  });
});
