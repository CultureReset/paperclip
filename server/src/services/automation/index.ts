import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  nextgentBusinessLinks,
  routineRunSteps,
  routineRuns,
  routineTriggers,
  routineWaits,
  routines,
  storeInstallResources,
  storeInstalls,
  storeItems,
} from "@paperclipai/db";
import type { NextgentEvent, RoutineVariable } from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { gcrConfigured, readNextgentConfig, type NextgentConfig } from "../nextgent-config.js";
import { companyModelGatewayEnv } from "../nextgent-model-gateway.js";
import { nextgentSecrets } from "../nextgent-secrets.js";
import { notifyService, type NotifyService } from "../notify/index.js";
import { routineService } from "../routines.js";
import { secretService } from "../secrets.js";
import { automationDefinitions } from "./definition.js";
import { automationEvents } from "./events.js";
import { businessMcpClient } from "./mcp.js";
import { runDefinition } from "./runner.js";
import type {
  AgentHandoff,
  AgentHandoffResult,
  AiPromptRequest,
  BusinessMcp,
  FetchLike,
  RunBusiness,
  RunRecord,
  RunRecorder,
  RunResult,
  RunResume,
  RunStatus,
  RunTrigger,
  RunnerDeps,
} from "./types.js";
import { automationWaits } from "./waits.js";

/**
 * The automation subsystem's entry point (DECISIONS #81, #82): runs a "steps"
 * routine with the runner, records runs, steps and waits in the database,
 * resumes due waits, fans inbound business events out, and builds the
 * runner's deps from what the platform holds — the install's business-data
 * token (store_installs.tokenSecretId), the company's model gateway, the
 * platform notifier and the routine service for agent hand-offs.
 */
export type RoutineRow = typeof routines.$inferSelect;
export type TriggerRow = typeof routineTriggers.$inferSelect;
export type RunRow = typeof routineRuns.$inferSelect;

export interface AutomationServiceOptions {
  config?: NextgentConfig;
  fetch?: FetchLike;
  notify?: NotifyService;
  env?: Record<string, string | undefined>;
  clock?: () => Date;
  /** Resolves a business's timezone through the bridge (a business fact); null when unknown. */
  businessTimezone?: (companyId: string) => Promise<string | null>;
}

/** The run statuses routine_runs holds for a step run. */
export function runRowStatus(status: RunStatus): string {
  return status === "ok" ? "completed" : status;
}

/** A routine's config: its variables' values by name (RoutineVariable.defaultValue holds the chosen value). */
export function configOf(variables: RoutineVariable[] | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of variables ?? []) if (v?.name) out[v.name] = v.defaultValue ?? undefined;
  return out;
}

/** The routine's pinned definition, parsed loosely; null when it has none. */
export function definitionOf(routine: RoutineRow): Record<string, unknown> | null {
  const def = routine.definition;
  return def && typeof def === "object" ? (def as Record<string, unknown>) : null;
}

/** Platform definitions (store items) may use the admin-only steps; an owner's may not. */
export function allowsAdminSteps(routine: RoutineRow): boolean {
  return routine.originKind === "store";
}

/** AUTOMATION_AI_MODEL (or AUTOMATION_AI_MODEL_<TASK>) names the model an ai.prompt step asks the company gateway for. */
export function aiModelFor(task: string, env: Record<string, string | undefined>): string | null {
  const key = `AUTOMATION_AI_MODEL_${task.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
  return env[key]?.trim() || env.AUTOMATION_AI_MODEL?.trim() || null;
}

export interface RunInput {
  routine: RoutineRow;
  trigger: RunTrigger;
  source: string;
  triggerId?: string | null;
  idempotencyKey?: string | null;
  dryRun?: boolean;
  /** Run the definition given instead of the routine's (a builder's test). */
  definition?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  resume?: RunResume | null;
  revisionId?: string | null;
}

export function automationService(db: Db, options: AutomationServiceOptions = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readNextgentConfig(env);
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const clock = options.clock ?? (() => new Date());
  const notify = options.notify ?? notifyService(db, { config, fetch: options.fetch, env });
  const secrets = secretService(db);
  const definitions = automationDefinitions(db);
  const waits = automationWaits(db);
  const events = automationEvents(db);

  /* ── the install behind a routine ───────────────────────────────────── */

  async function installOf(routine: RoutineRow) {
    const binding = await db
      .select({ itemId: storeInstallResources.itemId })
      .from(storeInstallResources)
      .where(and(eq(storeInstallResources.companyId, routine.companyId), eq(storeInstallResources.resourceKind, "routine"), eq(storeInstallResources.resourceId, routine.id)))
      .then((rows) => rows[0] ?? null);
    if (!binding) return null;
    const row = await db
      .select({ install: storeInstalls, itemKey: storeItems.key })
      .from(storeInstalls)
      .innerJoin(storeItems, eq(storeItems.id, storeInstalls.itemId))
      .where(and(eq(storeInstalls.companyId, routine.companyId), eq(storeInstalls.itemId, binding.itemId)))
      .then((rows) => rows[0] ?? null);
    return row;
  }

  /** The business MCP with the install's token; null when the install has none (data steps then say so). */
  async function mcpFor(routine: RoutineRow, install: Awaited<ReturnType<typeof installOf>>): Promise<BusinessMcp | null> {
    if (!gcrConfigured(config)) return null;
    let secretId = install?.install.tokenSecretId ?? null;
    if (!secretId && routine.originKind !== "store") {
      // An owner-built routine acts with the company's own business token.
      secretId = await db.select({ id: nextgentBusinessLinks.businessTokenSecretId }).from(nextgentBusinessLinks).where(eq(nextgentBusinessLinks.companyId, routine.companyId)).then((rows) => rows[0]?.id ?? null);
    }
    if (!secretId) return null;
    const token = await secrets.resolveSecretValue(routine.companyId, secretId, "latest").catch(() => null);
    if (!token) return null;
    return businessMcpClient({ baseUrl: config.gcrApiUrl as string, token, fetch: doFetch });
  }

  /** The business's facts a template may use, read through the MCP (never stored). */
  async function businessFor(mcp: BusinessMcp | null): Promise<RunBusiness> {
    if (!mcp) return {};
    try {
      const who = await mcp.callTool<{ slug?: string; name?: string | null }>("whoami", {});
      return { slug: who?.slug ?? null, name: who?.name ?? null };
    } catch {
      return {};
    }
  }

  /* ── agent hand-off, model gateway ──────────────────────────────────── */

  async function resolveAgentId(companyId: string, handoff: AgentHandoff): Promise<string> {
    if (handoff.agentId) {
      const agent = await db.select({ id: agents.id, companyId: agents.companyId }).from(agents).where(eq(agents.id, handoff.agentId)).then((rows) => rows[0] ?? null);
      if (!agent) throw new Error("No such agent");
      if (agent.companyId !== companyId) throw new Error("That agent belongs to another business");
      return agent.id;
    }
    let itemId: string | null = null;
    if (handoff.installId) {
      const install = await db.select({ itemId: storeInstalls.itemId, companyId: storeInstalls.companyId, enabled: storeInstalls.enabled }).from(storeInstalls).where(eq(storeInstalls.id, handoff.installId)).then((rows) => rows[0] ?? null);
      if (!install) throw new Error("That install has no agent (or was removed)");
      if (install.companyId !== companyId) throw new Error("That install belongs to another business");
      if (!install.enabled) throw new Error("That install is switched off");
      itemId = install.itemId;
    } else if (handoff.itemKey) {
      const item = await db.select({ id: storeItems.id }).from(storeItems).where(eq(storeItems.key, handoff.itemKey)).then((rows) => rows[0] ?? null);
      if (!item) throw new Error(`No active install of ${handoff.itemKey} with an agent for this business`);
      itemId = item.id;
    }
    if (!itemId) throw new Error("Name the agent install (item key or install id)");
    const bindings = await db
      .select({ resourceId: storeInstallResources.resourceId, resourceKey: storeInstallResources.resourceKey })
      .from(storeInstallResources)
      .where(and(eq(storeInstallResources.companyId, companyId), eq(storeInstallResources.itemId, itemId), eq(storeInstallResources.resourceKind, "agent")));
    const chosen = handoff.agentKey ? bindings.find((b) => b.resourceKey === handoff.agentKey) : bindings[0];
    if (!chosen) throw new Error(`No active install of ${handoff.itemKey ?? handoff.installId} with an agent for this business`);
    return chosen.resourceId;
  }

  async function handOff(routine: RoutineRow, handoff: AgentHandoff): Promise<AgentHandoffResult> {
    const agentId = await resolveAgentId(routine.companyId, handoff);
    const run = await routineService(db).runPipelineStageEntryRoutine(routine.id, {
      source: "api",
      assigneeAgentId: agentId,
      payload: handoff.body,
      descriptionAppendix: typeof handoff.body.instructions === "string" ? handoff.body.instructions : null,
    });
    return { accepted: true, agent_id: agentId, run: run.id, issue: run.linkedIssueId ?? null, routine_status: run.status };
  }

  async function askModel(companyId: string, request: AiPromptRequest): Promise<{ text: string }> {
    const gateway = await companyModelGatewayEnv(db, companyId, config);
    if (!gateway) throw new Error("The company's model gateway is not configured (LITELLM_URL / company key)");
    const model = aiModelFor(request.task, env);
    if (!model) throw new Error(`No model for AI task "${request.task}": set AUTOMATION_AI_MODEL (or AUTOMATION_AI_MODEL_${request.task.toUpperCase()})`);
    const messages = [...(request.system ? [{ role: "system", content: request.system }] : []), { role: "user", content: request.prompt }];
    const response = await doFetch(`${gateway.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gateway.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages, max_tokens: request.maxTokens }),
    });
    const body = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(body?.error?.message ?? `The model gateway answered ${response.status}`);
    return { text: body?.choices?.[0]?.message?.content ?? "" };
  }

  async function depsFor(routine: RoutineRow): Promise<{ deps: RunnerDeps; business: RunBusiness; install: Awaited<ReturnType<typeof installOf>> }> {
    const install = await installOf(routine);
    const mcp = await mcpFor(routine, install);
    const business = await businessFor(mcp);
    const deps: RunnerDeps = {
      mcp,
      agent: (handoff) => handOff(routine, handoff),
      ai: (request) => askModel(routine.companyId, request),
      notify: {
        ownNumbers: () => notify.ownNumbers(routine.companyId, [business.phone]),
        normalizePhone: (value) => notify.normalizePhone(value),
        text: (request) => notify.sendText(routine.companyId, request),
        email: (request) => notify.sendEmail(request),
      },
      fetch: doFetch,
      clock,
      env,
    };
    return { deps, business, install };
  }

  /* ── the recorder: runs, steps, waits ───────────────────────────────── */

  const recorder: RunRecorder = {
    async createRun({ record, companyId, trigger, dryRun, startedAt }) {
      const [row] = await db
        .insert(routineRuns)
        .values({
          companyId,
          routineId: record.routineId,
          triggerId: record.triggerId ?? null,
          source: record.source,
          status: "running",
          triggeredAt: startedAt,
          routineRevisionId: record.routineRevisionId,
          idempotencyKey: record.idempotencyKey ?? null,
          triggerPayload: (trigger.payload && typeof trigger.payload === "object" ? trigger.payload : { value: trigger.payload ?? null }) as Record<string, unknown>,
          dryRun,
        })
        .returning({ id: routineRuns.id });
      return row.id;
    },
    async appendStep({ runId, companyId, position, entry }) {
      await db.insert(routineRunSteps).values({
        companyId, runId, position, stepId: entry.id, stepType: entry.type, name: entry.name, status: entry.status, ms: entry.ms,
        output: entry.output ?? null, error: entry.error ?? null,
      });
    },
    async finishRun({ runId, status, error, output, durationMs, finishedAt }) {
      await db.update(routineRuns).set({
        status: runRowStatus(status), failureReason: error, output: output as unknown as Record<string, unknown>, durationMs, completedAt: finishedAt, updatedAt: clock(),
      }).where(eq(routineRuns.id, runId));
    },
    async saveWait({ runId, companyId, record, stepIndex, dueAt, context }) {
      await db.insert(routineWaits).values({
        companyId, routineId: record.routineId, runId, routineRevisionId: record.routineRevisionId, stepIndex, dueAt: new Date(dueAt), state: "waiting",
        context: context as unknown as Record<string, unknown>,
      });
    },
    async touchRoutine({ routineId, lastRunAt, lastRunStatus }) {
      await db.update(routines).set({ lastRunAt, lastRunStatus: runRowStatus(lastRunStatus), lastTriggeredAt: lastRunAt, updatedAt: clock() }).where(eq(routines.id, routineId));
    },
    async notifyFailure({ companyId, runId, automationName, error }) {
      await notify.notifyOwner(companyId, {
        kind: "failed_action",
        title: `An automation did not finish: ${automationName || "automation"}`,
        body: error,
        ref: runId ? `run:${runId}` : null,
        link: env.OWNER_AUTOMATIONS_PATH ?? null,
      });
    },
  };

  /* ── running ────────────────────────────────────────────────────────── */

  async function getRun(runId: string): Promise<RunRow> {
    const row = await db.select().from(routineRuns).where(eq(routineRuns.id, runId)).then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Routine run not found");
    return row;
  }

  async function run(input: RunInput): Promise<RunResult> {
    const definition = input.definition ?? definitionOf(input.routine);
    if (!definition) throw conflict("This routine has no automation definition");
    const { deps, business, install } = await depsFor(input.routine);
    const record: RunRecord = {
      routineId: input.routine.id,
      routineRevisionId: input.revisionId ?? input.routine.latestRevisionId,
      triggerId: input.triggerId ?? null,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      automationKey: install?.itemKey ?? null,
      automationName: (definition.name as string | undefined) ?? input.routine.title,
      version: install?.install.versionId ?? null,
    };
    return runDefinition({
      definition,
      companyId: input.routine.companyId,
      business,
      trigger: input.trigger,
      config: input.config ?? configOf(input.routine.variables),
      dryRun: input.dryRun === true,
      allowAdminSteps: allowsAdminSteps(input.routine),
      record,
      resume: input.resume ?? null,
      deps,
      recorder,
    });
  }

  return {
    definitions,
    waits,
    events,
    notify,
    recorder,
    run,
    configOf,
    definitionOf,

    /**
     * The routine service's hook (routines.ts dispatchRoutineRun) for a
     * "steps" routine: run it and answer with the run row, idempotent on the
     * key when one is given, refusing a trigger that is not live.
     */
    async dispatch(input: { routine: RoutineRow; trigger: TriggerRow | null; source: string; payload?: Record<string, unknown> | null; idempotencyKey?: string | null }): Promise<RunRow> {
      if (input.routine.status !== "active" && input.source !== "manual") throw conflict("Routine trigger is not active");
      if (input.trigger && (input.trigger.archived || !input.trigger.enabled)) throw conflict("Routine trigger is not active");
      if (input.idempotencyKey) {
        const existing = await db
          .select()
          .from(routineRuns)
          .where(and(eq(routineRuns.routineId, input.routine.id), eq(routineRuns.source, input.source), eq(routineRuns.idempotencyKey, input.idempotencyKey)))
          .orderBy(desc(routineRuns.createdAt))
          .limit(1);
        if (existing[0]) return existing[0];
      }
      const trigger: RunTrigger = input.source === "schedule"
        ? { type: "schedule", payload: { at: clock().toISOString(), ...(input.payload ?? {}) } }
        : { type: input.source, payload: input.payload ?? null };
      const result = await run({ routine: input.routine, trigger, source: input.source, triggerId: input.trigger?.id ?? null, idempotencyKey: input.idempotencyKey ?? null });
      if (!result.run_id) throw conflict("The run was not recorded");
      return getRun(result.run_id);
    },

    /** Owner "run now" / a builder's test: the result itself, with the step log. */
    async runNow(routine: RoutineRow, input: { payload?: unknown; dryRun?: boolean; definition?: Record<string, unknown> | null; config?: Record<string, unknown> | null } = {}): Promise<RunResult> {
      if (routine.status === "archived") throw conflict("Routine is archived");
      return run({ routine, trigger: { type: input.dryRun ? "test" : "manual", payload: input.payload ?? null }, source: "manual", dryRun: input.dryRun, definition: input.definition ?? null, config: input.config ?? null });
    },

    /** Carry on every wait that is due, on the revision each run started on. */
    async resumeDueWaits(now = clock(), limit?: number) {
      return waits.resumeDue({
        now,
        limit,
        run: ({ wait, routine, definition, trigger, resume }) => run({
          routine, definition, trigger, resume,
          source: trigger.type === "resume" ? "manual" : trigger.type,
          revisionId: wait.routineRevisionId,
        }),
      });
    },

    /** Fan one business event out to the company's listening routines (DECISIONS #87). */
    async fanOutEvent(event: NextgentEvent) {
      return events.fanOut(event, ({ routine, trigger }) => run({
        routine,
        trigger: { type: "event", payload: { event: event.event, eventId: event.eventId, occurredAt: event.occurredAt, ref: event.ref ?? {} } },
        source: "event",
        triggerId: trigger.id,
        idempotencyKey: event.eventId,
      }));
    },

    /**
     * gcr's per-install webhook (`POST /api/automations/hook/:token`): the
     * public id is the credential. 404 unknown; 202 switched off; 400 when the
     * definition's trigger is not a webhook; else the run.
     */
    async fireHook(publicId: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
      if (!/^[a-f0-9]{16,64}$/.test(publicId)) return { status: 404, body: { error: "Unknown hook" } };
      const found = await db
        .select({ trigger: routineTriggers, routine: routines })
        .from(routineTriggers)
        .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
        .where(and(eq(routineTriggers.publicId, publicId), eq(routineTriggers.kind, "webhook"), eq(routines.mode, "steps")))
        .then((rows) => rows[0] ?? null);
      if (!found || found.trigger.archived) return { status: 404, body: { error: "Unknown hook" } };
      if (found.routine.status !== "active" || !found.trigger.enabled) return { status: 202, body: { accepted: false, reason: "switched off" } };
      const definition = definitionOf(found.routine);
      const triggerType = (definition?.trigger as { type?: string } | undefined)?.type;
      if (triggerType !== "webhook") return { status: 400, body: { error: "This automation is not triggered by a URL." } };
      const result = await run({ routine: found.routine, trigger: { type: "webhook", payload: payload ?? null }, source: "webhook", triggerId: found.trigger.id });
      return { status: 200, body: { accepted: true, status: result.status, run_id: result.run_id ?? null } };
    },

    /** The runs of one routine, newest first, each with its step log. */
    async listRuns(routineId: string, limit = 30) {
      const runs = await db.select().from(routineRuns).where(eq(routineRuns.routineId, routineId)).orderBy(desc(routineRuns.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
      const out = [];
      for (const row of runs) out.push({ ...row, steps: await waits.stepLogFor(row.id) });
      return out;
    },

    /** Admin: recent step runs across the platform, filterable (gcr /runs/recent). */
    async recentRuns(filter: { companyId?: string | null; routineId?: string | null; status?: string | null; limit?: number } = {}) {
      const conditions = [eq(routines.mode, "steps")];
      if (filter.companyId) conditions.push(eq(routineRuns.companyId, filter.companyId));
      if (filter.routineId) conditions.push(eq(routineRuns.routineId, filter.routineId));
      if (filter.status) conditions.push(eq(routineRuns.status, filter.status));
      const rows = await db
        .select({ run: routineRuns, routineTitle: routines.title })
        .from(routineRuns)
        .innerJoin(routines, eq(routines.id, routineRuns.routineId))
        .where(and(...conditions))
        .orderBy(desc(routineRuns.createdAt))
        .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.run.status] = (counts[row.run.status] ?? 0) + 1;
      return { runs: rows.map((row) => ({ ...row.run, automation_name: row.routineTitle })), counts };
    },
  };
}

export type AutomationService = ReturnType<typeof automationService>;

/** Log and swallow: a tick or an event must never fail on a routine's error. */
export function swallow<T>(promise: Promise<T>, context: Record<string, unknown>, message: string): Promise<T | null> {
  return promise.catch((error) => {
    logger.error({ err: error, ...context }, message);
    return null;
  });
}
