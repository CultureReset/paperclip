import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { routineRuns, routineTriggers, routines, storeInstallResources, storeInstalls, storeItemVersions, storeItems } from "@paperclipai/db";
import { validateAutomationDefinition, type AutomationDefinition, type RoutineVariable } from "@paperclipai/shared";
import { badRequest, conflict, notFound } from "../../errors.js";
import { logActivity } from "../activity-log.js";
import { readNextgentConfig, type NextgentConfig } from "../nextgent-config.js";
import { routineService } from "../routines.js";
import { AUTOMATION_ROUTINE_KEY } from "../store-content.js";
import { automationDefinitions, automationOf } from "./definition.js";
import { automationService, configOf, definitionOf, type AutomationService, type RoutineRow } from "./index.js";
import { scheduleTimezone, scheduleToCron, type ScheduleTrigger } from "./scheduler.js";

/**
 * Automations in the store (SPEC §7, DECISIONS #82, #89): an automation item's
 * release carries `payload.automation` = { trigger, steps, config_schema }.
 * Installing it creates one "steps" routine per company — the definition
 * pinned to the installed version, the business's settings as the routine's
 * variables — plus its trigger rows; an update moves the pinned definition;
 * uninstall switches the routine off and keeps its settings and run history
 * (the binding stays, so a reinstall finds them). Owner-built drafts are
 * company routines too: saved with their problems, openable, publishable.
 */
export type ItemRow = typeof storeItems.$inferSelect;
export type VersionRow = typeof storeItemVersions.$inferSelect;

/** Who built the routine: the store (platform-only steps allowed), an owner's draft, or an owner's published automation. */
export const AUTOMATION_ORIGINS = { store: "store", draft: "automation_draft", owner: "automation_owner" } as const;

const VARIABLE_TYPES = new Set(["text", "textarea", "number", "boolean", "select", "tel", "email"]);

interface ConfigField {
  key?: string;
  label?: string;
  type?: string;
  default?: unknown;
  options?: Array<string | { value: string; label?: string }>;
}

/** The routine's variables from a definition's config_schema, keeping the values the business already chose. */
export function variablesFor(configSchema: unknown, existing: RoutineVariable[] | null | undefined = []): RoutineVariable[] {
  const have = new Map((existing ?? []).map((v) => [v.name, v]));
  const out: RoutineVariable[] = [];
  for (const raw of Array.isArray(configSchema) ? (configSchema as ConfigField[]) : []) {
    if (!raw?.key || !/^[a-z0-9_]{1,40}$/.test(raw.key)) continue;
    const type = VARIABLE_TYPES.has(String(raw.type ?? "text")) ? (String(raw.type ?? "text") as RoutineVariable["type"]) : "text";
    const options = type === "select" ? (raw.options ?? []).map((o) => (typeof o === "string" ? o : o?.value)).filter((o): o is string => typeof o === "string" && o.length > 0) : [];
    const chosen = have.get(raw.key)?.defaultValue;
    let defaultValue: RoutineVariable["defaultValue"] = chosen !== undefined && chosen !== null ? chosen : (raw.default as RoutineVariable["defaultValue"]) ?? (type === "boolean" ? false : null);
    if (type === "number" && typeof defaultValue === "string") defaultValue = defaultValue.trim() === "" ? null : Number(defaultValue);
    if (type === "number" && typeof defaultValue === "number" && !Number.isFinite(defaultValue)) defaultValue = null;
    if (type === "boolean" && typeof defaultValue !== "boolean") defaultValue = defaultValue === "true";
    if (type === "select" && (typeof defaultValue !== "string" || !options.includes(defaultValue))) defaultValue = null;
    if (type === "select" && options.length === 0) continue;
    out.push({ name: raw.key, label: raw.label ?? null, type, defaultValue, required: false, options });
  }
  return out;
}

/** Only keys the definition declares are kept (gcr PATCH /:id config). */
export function applyConfig(definition: Record<string, unknown> | null, variables: RoutineVariable[], config: Record<string, unknown>): RoutineVariable[] {
  const allowed = new Set((Array.isArray(definition?.config_schema) ? (definition!.config_schema as ConfigField[]) : []).map((f) => f?.key).filter(Boolean));
  const next = variablesFor(definition?.config_schema, variables);
  return next.map((v) => {
    if (!allowed.has(v.name) || !(v.name in config)) return v;
    const raw = config[v.name];
    let value: RoutineVariable["defaultValue"] = raw === undefined ? null : (raw as RoutineVariable["defaultValue"]);
    if (v.type === "number" && typeof value === "string") value = value.trim() === "" ? null : Number(value);
    if (v.type === "boolean" && typeof value !== "boolean") value = value === "true" || value === 1 || value === "1";
    if (v.type === "select" && (typeof value !== "string" || !v.options.includes(value))) value = null;
    if (typeof value === "number" && !Number.isFinite(value)) value = null;
    return { ...v, defaultValue: value };
  });
}

export function newHookId(): string {
  return randomBytes(12).toString("hex");
}

export interface AutomationInstallOptions {
  config?: NextgentConfig;
  automations?: AutomationService;
  /** A business's timezone through the bridge (a business fact); null when unknown. */
  businessTimezone?: (companyId: string) => Promise<string | null>;
  env?: Record<string, string | undefined>;
}

export function automationInstalls(db: Db, options: AutomationInstallOptions = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readNextgentConfig(env);
  const automations = options.automations ?? automationService(db, { config, env });
  const routinesSvc = routineService(db);
  const definitions = automationDefinitions(db);

  function hookUrl(publicId: string | null | undefined): string | null {
    if (!publicId) return null;
    const base = (config.publicUrl ?? env.PAPERCLIP_API_URL?.trim() ?? "").replace(/\/+$/, "");
    return base ? `${base}/api/automations/hook/${publicId}` : null;
  }

  async function bindingFor(companyId: string, itemId: string) {
    return db
      .select()
      .from(storeInstallResources)
      .where(and(eq(storeInstallResources.companyId, companyId), eq(storeInstallResources.itemId, itemId), eq(storeInstallResources.resourceKind, "routine"), eq(storeInstallResources.resourceKey, AUTOMATION_ROUTINE_KEY)))
      .then((rows) => rows[0] ?? null);
  }

  async function getRoutine(id: string): Promise<RoutineRow | null> {
    return db.select().from(routines).where(eq(routines.id, id)).then((rows) => rows[0] ?? null);
  }

  async function bind(companyId: string, itemId: string, routineId: string) {
    await db
      .insert(storeInstallResources)
      .values({ companyId, itemId, resourceKind: "routine", resourceKey: AUTOMATION_ROUTINE_KEY, resourceId: routineId })
      .onConflictDoUpdate({
        target: [storeInstallResources.companyId, storeInstallResources.itemId, storeInstallResources.resourceKind, storeInstallResources.resourceKey],
        set: { resourceId: routineId, updatedAt: new Date() },
      });
  }

  /** The routine's triggers follow the definition's trigger: existing ones are archived, the new one created. */
  async function syncTriggers(routine: RoutineRow, definition: AutomationDefinition | Record<string, unknown>, userId: string | null) {
    const trigger = ((definition as { trigger?: ScheduleTrigger & { event?: string } }).trigger ?? { type: "manual" }) as ScheduleTrigger & { event?: string };
    const existing = await db.select().from(routineTriggers).where(and(eq(routineTriggers.routineId, routine.id), eq(routineTriggers.archived, false)));
    const keep = existing.find((t) => {
      if (trigger.type === "schedule") return t.kind === "schedule" && t.cronExpression === scheduleToCron(trigger);
      if (trigger.type === "event") return t.kind === "event" && t.eventName === trigger.event;
      if (trigger.type === "webhook") return t.kind === "webhook";
      return false;
    });
    for (const t of existing) {
      if (keep && t.id === keep.id) continue;
      await db.update(routineTriggers).set({ archived: true, enabled: false, updatedAt: new Date() }).where(eq(routineTriggers.id, t.id));
    }
    if (keep || trigger.type === "manual" || !trigger.type) return;
    const actor = { userId };
    if (trigger.type === "schedule") {
      const businessTz = options.businessTimezone ? await options.businessTimezone(routine.companyId).catch(() => null) : null;
      await routinesSvc.createTrigger(routine.id, { kind: "schedule", cronExpression: scheduleToCron(trigger), timezone: scheduleTimezone(trigger, businessTz, env), enabled: true }, actor);
    } else if (trigger.type === "event" && trigger.event) {
      await routinesSvc.createTrigger(routine.id, { kind: "event", eventName: trigger.event, enabled: true }, actor);
    } else if (trigger.type === "webhook") {
      // The public id is the credential (gcr's hook token); nothing is signed.
      await routinesSvc.createTrigger(routine.id, { kind: "webhook", signingMode: "none", replayWindowSec: 300, enabled: true }, actor);
    }
  }

  async function cancelWaits(routineId: string) {
    await automations.waits.cancelForRoutine(routineId);
  }

  return {
    hookUrl,
    bindingFor,

    /** The routine an item's install created in a company, or null. */
    async routineFor(companyId: string, itemId: string): Promise<RoutineRow | null> {
      const binding = await bindingFor(companyId, itemId);
      return binding ? getRoutine(binding.resourceId) : null;
    },

    /**
     * Install, or move to `version`: the company's routine for the item,
     * created on first install (mode steps, definition pinned, settings from
     * config_schema), updated in place after. Returns null when the release
     * carries no automation (nothing to create).
     */
    async install(input: { companyId: string; item: ItemRow; version: VersionRow; userId: string | null; enabled?: boolean; installId?: string | null }): Promise<RoutineRow | null> {
      const definition = automationOf(input.version.payload);
      if (!definition) return null;
      const enabled = input.enabled !== false;
      const title = String(definition.name || input.item.name);
      const binding = await bindingFor(input.companyId, input.item.id);
      const existing = binding ? await getRoutine(binding.resourceId) : null;
      let routine: RoutineRow;
      let fresh = false;
      if (existing && existing.status !== "archived") {
        await routinesSvc.update(existing.id, {
          title,
          description: definition.description ?? null,
          definition: definition as never,
          variables: variablesFor(definition.config_schema, existing.variables) as never,
          status: enabled ? "active" : "paused",
        } as never, { userId: input.userId });
        routine = (await getRoutine(existing.id)) as RoutineRow;
      } else {
        fresh = true;
        const created = await routinesSvc.create(input.companyId, {
          title,
          description: definition.description ?? null,
          priority: "medium",
          status: enabled ? "active" : "paused",
          concurrencyPolicy: "always_enqueue",
          catchUpPolicy: "skip_missed",
          variables: variablesFor(definition.config_schema) as never,
          mode: "steps",
          definition: definition as never,
        } as never, { userId: input.userId });
        await db.update(routines).set({ originKind: AUTOMATION_ORIGINS.store, originId: input.item.id, updatedAt: new Date() }).where(eq(routines.id, created.id));
        routine = (await getRoutine(created.id)) as RoutineRow;
        await bind(input.companyId, input.item.id, routine.id);
      }
      await syncTriggers(routine, definition, input.userId);
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.userId ? "user" : "system",
        actorId: input.userId ?? "store",
        action: fresh ? "automation.installed" : "automation.updated",
        entityType: "routine",
        entityId: routine.id,
        details: { itemKey: input.item.key, version: input.version.version, enabled },
      });
      // Tell the freshly installed one, if it listens for it (gcr installFromStore).
      if (fresh && enabled && definition.trigger?.type === "event" && definition.trigger.event === "automation.installed") {
        const current = (await getRoutine(routine.id)) as RoutineRow;
        await automations.run({
          routine: current,
          trigger: { type: "event", payload: { event: "automation.installed", ref: { version: input.version.version } } },
          source: "event",
          idempotencyKey: `installed:${input.installId ?? input.item.id}:${input.version.version}`,
        }).catch(() => undefined);
      }
      return (await getRoutine(routine.id)) as RoutineRow;
    },

    /** The owner's switch, or a push's: active runs; paused runs nothing and its pending waits are cancelled. */
    async setEnabled(companyId: string, item: ItemRow, enabled: boolean, userId: string | null): Promise<RoutineRow | null> {
      const routine = await this.routineFor(companyId, item.id);
      if (!routine || routine.status === "archived") return null;
      await routinesSvc.update(routine.id, { status: enabled ? "active" : "paused" } as never, { userId });
      if (!enabled) await cancelWaits(routine.id);
      return getRoutine(routine.id);
    },

    /** Store uninstall: switched off, settings and run history kept, the binding kept for a reinstall. */
    async disable(companyId: string, item: ItemRow, userId: string | null) {
      const routine = await this.setEnabled(companyId, item, false, userId);
      if (routine) {
        await logActivity(db, { companyId, actorType: userId ? "user" : "system", actorId: userId ?? "store", action: "automation.disabled", entityType: "routine", entityId: routine.id, details: { itemKey: item.key } });
      }
      return routine;
    },

    /** Switch on/off, or change settings. Only keys the version declares are kept. */
    async patch(routine: RoutineRow, patch: { enabled?: boolean; config?: Record<string, unknown> }, userId: string | null) {
      if (routine.mode !== "steps") throw conflict("This routine is not an automation");
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.status = patch.enabled ? "active" : "paused";
      if (patch.config && typeof patch.config === "object") update.variables = applyConfig(definitionOf(routine), routine.variables ?? [], patch.config);
      if (Object.keys(update).length) await routinesSvc.update(routine.id, update as never, { userId });
      if (patch.enabled === false) await cancelWaits(routine.id);
      const after = (await getRoutine(routine.id)) as RoutineRow;
      return { enabled: after.status === "active", config: configOf(after.variables), version: after.latestRevisionNumber };
    },

    /** A fresh webhook URL; the old one stops working. */
    async rotateHook(routine: RoutineRow) {
      const trigger = await db.select().from(routineTriggers).where(and(eq(routineTriggers.routineId, routine.id), eq(routineTriggers.kind, "webhook"), eq(routineTriggers.archived, false))).then((rows) => rows[0] ?? null);
      if (!trigger) throw conflict("This automation is not triggered by a URL.");
      const publicId = newHookId();
      await db.update(routineTriggers).set({ publicId, lastRotatedAt: new Date(), lastWebhookDelivery: null, updatedAt: new Date() }).where(eq(routineTriggers.id, trigger.id));
      return { hook_url: hookUrl(publicId) };
    },

    /** Everything on this company's dashboard: installed automations and the owner's own, at the version each has. */
    async listForCompany(companyId: string) {
      const rows = await db
        .select()
        .from(routines)
        .where(and(eq(routines.companyId, companyId), eq(routines.mode, "steps")))
        .orderBy(desc(routines.createdAt));
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const bindings = await db
        .select({ resourceId: storeInstallResources.resourceId, itemId: storeInstallResources.itemId, itemKey: storeItems.key, itemStatus: storeItems.status, latestVersionId: storeItems.latestVersionId, iconUrl: storeItems.iconUrl, summary: storeItems.summary })
        .from(storeInstallResources)
        .innerJoin(storeItems, eq(storeItems.id, storeInstallResources.itemId))
        .where(and(eq(storeInstallResources.companyId, companyId), eq(storeInstallResources.resourceKind, "routine"), eq(storeInstallResources.resourceKey, AUTOMATION_ROUTINE_KEY), inArray(storeInstallResources.resourceId, ids)));
      const byRoutine = new Map(bindings.map((b) => [b.resourceId, b]));
      const installs = bindings.length
        ? await db.select().from(storeInstalls).where(and(eq(storeInstalls.companyId, companyId), inArray(storeInstalls.itemId, bindings.map((b) => b.itemId))))
        : [];
      const versionIds = [...new Set([...installs.map((i) => i.versionId), ...bindings.map((b) => b.latestVersionId)].filter((v): v is string => Boolean(v)))];
      const versions = versionIds.length ? await db.select({ id: storeItemVersions.id, version: storeItemVersions.version, itemId: storeItemVersions.itemId }).from(storeItemVersions).where(inArray(storeItemVersions.id, versionIds)) : [];
      const versionOf = (id: string | null | undefined) => versions.find((v) => v.id === id)?.version ?? null;
      const triggers = await db.select().from(routineTriggers).where(and(inArray(routineTriggers.routineId, ids), eq(routineTriggers.archived, false)));
      const lastRuns = await db.select().from(routineRuns).where(and(inArray(routineRuns.routineId, ids), eq(routineRuns.dryRun, false))).orderBy(desc(routineRuns.createdAt)).limit(200);
      return rows.map((routine) => {
        const binding = byRoutine.get(routine.id) ?? null;
        const install = binding ? installs.find((i) => i.itemId === binding.itemId) ?? null : null;
        const definition = definitionOf(routine) ?? {};
        const webhook = triggers.find((t) => t.routineId === routine.id && t.kind === "webhook") ?? null;
        const lastRun = lastRuns.find((r) => r.routineId === routine.id) ?? null;
        const installedVersion = versionOf(install?.versionId);
        const latestVersion = versionOf(binding?.latestVersionId);
        const steps = Array.isArray(definition.steps) ? (definition.steps as Array<{ id?: string; type?: string; name?: string }>) : [];
        return {
          id: routine.id,
          item_key: binding?.itemKey ?? null,
          origin: routine.originKind,
          draft: routine.originKind === AUTOMATION_ORIGINS.draft,
          problems: Array.isArray(definition.problems) ? definition.problems : [],
          name: (definition.name as string | undefined) || routine.title,
          description: (definition.description as string | undefined) ?? routine.description ?? binding?.summary ?? null,
          icon: (definition.icon as string | undefined) ?? binding?.iconUrl ?? null,
          category: (definition.category as string | undefined) ?? null,
          kind: (definition.kind as string | undefined) ?? "automation",
          trigger: definition.trigger ?? { type: "manual" },
          config_schema: Array.isArray(definition.config_schema) ? definition.config_schema : [],
          steps_summary: steps.map((s) => ({ id: s.id, type: s.type, name: s.name })),
          version: installedVersion,
          latest_version: latestVersion,
          update_available: Boolean(install && binding?.itemStatus === "published" && binding.latestVersionId && install.versionId !== binding.latestVersionId),
          installed: install !== null,
          enabled: routine.status === "active",
          config: configOf(routine.variables),
          installed_at: install?.createdAt ?? routine.createdAt,
          updated_at: routine.updatedAt,
          last_run_at: routine.lastRunAt,
          last_run_status: routine.lastRunStatus,
          last_run: lastRun ? { status: lastRun.status, started_at: lastRun.triggeredAt, error: lastRun.failureReason, trigger: lastRun.source } : null,
          hook_url: (definition.trigger as { type?: string } | undefined)?.type === "webhook" ? hookUrl(webhook?.publicId) : null,
        };
      });
    },

    /* ── owner drafts (DECISIONS #89) ──────────────────────────────────── */

    /** Save a draft (new, or an existing one by id): checked with the platform-only steps refused; problems come back with it. A draft never runs by itself. */
    async saveDraft(companyId: string, body: Record<string, unknown>, userId: string | null, routineId: string | null = null) {
      const def = {
        name: String(body.name ?? "").trim().slice(0, 120),
        description: typeof body.description === "string" ? body.description : null,
        trigger: body.trigger && typeof body.trigger === "object" ? (body.trigger as Record<string, unknown>) : { type: "manual" },
        steps: Array.isArray(body.steps) ? body.steps : [],
        config_schema: Array.isArray(body.config_schema) ? body.config_schema : [],
      };
      const problems = validateAutomationDefinition(def, { forOwner: true, events: await definitions.knownEvents(companyId) });
      if (!def.name) throw badRequest("A name is required.", { problems });
      const definition = { ...def, problems };
      let routine: RoutineRow;
      if (routineId) {
        const existing = await getRoutine(routineId);
        if (!existing || existing.companyId !== companyId || existing.originKind !== AUTOMATION_ORIGINS.draft) throw notFound("No such draft.");
        await routinesSvc.update(existing.id, { title: def.name, description: def.description, definition: definition as never, variables: variablesFor(def.config_schema, existing.variables) as never } as never, { userId });
        routine = (await getRoutine(existing.id)) as RoutineRow;
      } else {
        const created = await routinesSvc.create(companyId, {
          title: def.name,
          description: def.description,
          priority: "medium",
          status: "paused",
          concurrencyPolicy: "always_enqueue",
          catchUpPolicy: "skip_missed",
          variables: variablesFor(def.config_schema) as never,
          mode: "steps",
          definition: definition as never,
        } as never, { userId });
        await db.update(routines).set({ originKind: AUTOMATION_ORIGINS.draft, updatedAt: new Date() }).where(eq(routines.id, created.id));
        routine = (await getRoutine(created.id)) as RoutineRow;
      }
      return { draft: { id: routine.id, ...definition, status: "draft", updated_at: routine.updatedAt }, problems };
    },

    async listDrafts(companyId: string) {
      const rows = await db.select().from(routines).where(and(eq(routines.companyId, companyId), eq(routines.mode, "steps"), eq(routines.originKind, AUTOMATION_ORIGINS.draft))).orderBy(desc(routines.updatedAt));
      return rows.map((routine) => ({ id: routine.id, ...(definitionOf(routine) ?? {}), status: "draft", updated_at: routine.updatedAt }));
    },

    /** Make a draft a live company automation: no problems, at least one step; its triggers are created and it runs from now on. */
    async publishDraft(companyId: string, routineId: string, userId: string | null) {
      const existing = await getRoutine(routineId);
      if (!existing || existing.companyId !== companyId || existing.originKind !== AUTOMATION_ORIGINS.draft) throw notFound("No such draft.");
      const { problems: _old, ...definition } = (definitionOf(existing) ?? {}) as Record<string, unknown>;
      const problems = validateAutomationDefinition(definition, { forOwner: true, events: await definitions.knownEvents(companyId) });
      if (problems.length) throw badRequest("Fix these before publishing.", { problems });
      if (!Array.isArray(definition.steps) || !definition.steps.length) throw badRequest("Add at least one step before publishing.");
      await routinesSvc.update(existing.id, { definition: definition as never, status: "active" } as never, { userId });
      await db.update(routines).set({ originKind: AUTOMATION_ORIGINS.owner, updatedAt: new Date() }).where(eq(routines.id, existing.id));
      const routine = (await getRoutine(existing.id)) as RoutineRow;
      await syncTriggers(routine, definition, userId);
      await logActivity(db, { companyId, actorType: userId ? "user" : "system", actorId: userId ?? "owner", action: "automation.published", entityType: "routine", entityId: routine.id, details: { name: definition.name } });
      return (await getRoutine(routine.id)) as RoutineRow;
    },
  };
}

export type AutomationInstalls = ReturnType<typeof automationInstalls>;
