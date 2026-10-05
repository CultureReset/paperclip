import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { agents, companies, routines as routinesTable, storeInstallResources, storeItems } from "@paperclipai/db";
import { AGENT_ROLES } from "@paperclipai/shared";
import type { Agent } from "@paperclipai/shared";
import { badRequest, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { agentService } from "./agents.js";
import { approvalService } from "./approvals.js";
import { companySkillService } from "./company-skills.js";
import { routineService } from "./routines.js";
import { MENU_KEYS } from "./store-menu.js";

const resourceKey = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and dashes");

/**
 * What a store release puts inside a company. Every entry has a stable key so
 * a later release can change it in place or drop it.
 */
/**
 * NEXT GENT section of a release: which kind of install this is for
 * gcr-api-clean, the business data it needs (resource:action, each with the
 * reason shown on the consent screen) and, for an automation that hands work
 * to an agent, which agent. `itemKey` names another store item when the agent
 * comes from a separate install; leave it out for an agent in this release.
 */
export const NEXTGENT_PERMISSION_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;
export const storeNextgentSectionSchema = z.object({
  kind: z.enum(["agent", "app", "automation"]),
  permissions: z
    .array(
      z.object({
        permission: z.string().trim().regex(NEXTGENT_PERMISSION_PATTERN, "Permissions are resource:action, e.g. availability:read"),
        reason: z.string().trim().min(1).max(500),
        /** Optional data access: the owner may decline it at install; it never blocks an update. */
        optional: z.boolean().default(false),
      }),
    )
    .default([]),
  handoff: z
    .object({
      agentKey: resourceKey,
      itemKey: resourceKey.nullish(),
      title: z.string().trim().min(1).max(200).nullish(),
    })
    .nullish(),
});
export type StoreNextgentSection = z.infer<typeof storeNextgentSectionSchema>;

export const storePayloadSchema = z
  .object({
    nextgent: storeNextgentSectionSchema.nullish(),
    /** An app's manifest (App-build- engine), kept whole for the screens that draw it; gated by assertAppManifest. */
    app: z.record(z.string(), z.unknown()).nullish(),
    /** A layout: which screens a business's page is built from. Kept whole; only its identity is checked here. */
    layout: z
      .object({ id: z.string().trim().min(1), version: z.string().trim().min(1) })
      .passthrough()
      .nullish(),
    /** Menu entries this item turns on, beyond the ones its agents, routines and skills need. */
    menu: z.array(z.enum(MENU_KEYS)).default([]),
    skills: z
      .array(
        z.object({
          key: resourceKey,
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).nullish(),
          markdown: z.string().min(1),
        }),
      )
      .default([]),
    agents: z
      .array(
        z.object({
          key: resourceKey,
          name: z.string().trim().min(1).max(120),
          role: z.enum(AGENT_ROLES).default("general"),
          title: z.string().trim().max(120).nullish(),
          capabilities: z.string().trim().max(2_000).nullish(),
          /** Leave out to use whatever adapter the company already uses most. */
          adapterType: z.string().trim().min(1).nullish(),
          instructions: z.string().nullish(),
        }),
      )
      .default([]),
    routines: z
      .array(
        z.object({
          key: resourceKey,
          title: z.string().trim().min(1).max(200),
          description: z.string().nullish(),
          /** Key of an agent in the same release that the routine is assigned to. */
          agentKey: resourceKey.nullish(),
          cron: z.string().trim().min(1).nullish(),
          timezone: z.string().trim().min(1).default("UTC"),
        }),
      )
      .default([]),
  })
  .superRefine((payload, ctx) => {
    for (const kind of ["skills", "agents", "routines"] as const) {
      const keys = payload[kind].map((entry) => entry.key);
      const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
      if (duplicate) ctx.addIssue({ code: "custom", path: [kind], message: `Duplicate ${kind} key "${duplicate}"` });
    }
    const agentKeys = new Set(payload.agents.map((agent) => agent.key));
    const nextgent = payload.nextgent;
    if (nextgent) {
      const permissions = nextgent.permissions.map((entry) => entry.permission);
      const duplicate = permissions.find((permission, index) => permissions.indexOf(permission) !== index);
      if (duplicate) ctx.addIssue({ code: "custom", path: ["nextgent", "permissions"], message: `Duplicate permission "${duplicate}"` });
      if (nextgent.kind === "agent" && payload.agents.length === 0) {
        ctx.addIssue({ code: "custom", path: ["nextgent", "kind"], message: "An agent item must declare at least one agent" });
      }
      if (nextgent.handoff && nextgent.kind !== "automation") {
        ctx.addIssue({ code: "custom", path: ["nextgent", "handoff"], message: "Only automations hand work to an agent" });
      }
      if (nextgent.handoff && !nextgent.handoff.itemKey && !agentKeys.has(nextgent.handoff.agentKey)) {
        ctx.addIssue({ code: "custom", path: ["nextgent", "handoff"], message: `Hand-off names unknown agent "${nextgent.handoff.agentKey}"` });
      }
    }
    for (const routine of payload.routines) {
      if (routine.agentKey && !agentKeys.has(routine.agentKey)) {
        ctx.addIssue({ code: "custom", path: ["routines"], message: `Routine "${routine.key}" names unknown agent "${routine.agentKey}"` });
      }
    }
  });

export type StorePayload = z.infer<typeof storePayloadSchema>;

export function parseStorePayload(payload: unknown): StorePayload {
  const parsed = storePayloadSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw badRequest(`Release content is not valid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}

/** The engine's semver shape (the same one plugin-loader.ts uses for plugin versions). */
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The gate an app release passes before it is stored: the manifest is there,
 * belongs to this item, is the version being released, runs on the engine,
 * draws something and says what it needs. Every refusal names the field path.
 *
 * This is a minimal gate; the full rule set is @nextgent/app-engine
 * validateManifest (DECISIONS #23). It moves here once that package installs
 * into Paperclip.
 */
export function assertAppManifest(payload: Record<string, unknown>, item: { key: string }, version: string): void {
  const fail = (field: string, problem: string): never => {
    throw badRequest(`App release is not valid: ${field} ${problem}`);
  };
  if (!isRecord(payload.nextgent) || payload.nextgent.kind !== "app") fail("payload.nextgent.kind", 'must be "app"');
  const app = payload.app;
  if (!isRecord(app)) return fail("payload.app", "must be the app manifest object");
  if (app.schema_version === undefined || app.schema_version === null) fail("payload.app.schema_version", "is required");
  if (app.id !== item.key) fail("payload.app.id", `must equal the item key "${item.key}"`);
  if (!SEMVER_PATTERN.test(version)) fail("payload.app.version", "must be a semver version (an app's release version is its manifest version)");
  if (app.version !== version) fail("payload.app.version", `must equal the release version "${version}"`);
  if (!isRecord(app.runtime) || app.runtime.type !== "engine") fail("payload.app.runtime.type", 'must be "engine"');
  if (!isRecord(app.ui)) fail("payload.app.ui", "must be an object");
  if (!Array.isArray(app.permissions)) fail("payload.app.permissions", "must be an array");
}

/**
 * Resource keys the platform itself binds to an install (e.g. the routine an
 * automation hands work to). Release payload keys cannot start with "_", so
 * these never collide with them and a release sync leaves them alone.
 */
export const PLATFORM_RESOURCE_KEY_PREFIX = "_";
export function isPlatformResourceKey(key: string) {
  return key.startsWith(PLATFORM_RESOURCE_KEY_PREFIX);
}

/** Kinds whose releases carry no company content: a plugin turns a plugin on. */
export function itemHasContent(kind: string) {
  return kind !== "plugin";
}

type ItemRow = typeof storeItems.$inferSelect;
type Binding = typeof storeInstallResources.$inferSelect;
type ResourceKind = "skill" | "agent" | "routine";

/** Same configurable default the teams catalog uses for server-created agents. */
function defaultAdapterType() {
  return process.env.PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE?.trim() || "claude_local";
}

function skillKeyFor(item: ItemRow, key: string) {
  return `store/${item.key}/${key}`;
}

function skillFiles(item: ItemRow, skill: StorePayload["skills"][number]) {
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description ?? `${skill.name} skill.`)}`,
    `key: ${JSON.stringify(skillKeyFor(item, skill.key))}`,
    "---",
    "",
  ].join("\n");
  const body = skill.markdown.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "");
  return { [`${skill.key}/SKILL.md`]: frontmatter + body };
}

/**
 * Creates, updates and removes the skills, agents and routines a store item
 * puts inside a company. Whatever a release no longer declares is removed:
 * skills are deleted, agents terminated (their history stays) and routines
 * archived.
 */
export function storeContentService(db: Db) {
  const skills = companySkillService(db);
  const agentSvc = agentService(db);
  const approvals = approvalService(db);
  const instructions = agentInstructionsService();
  const routines = routineService(db);

  async function bindingsFor(companyId: string, itemId: string) {
    return db
      .select()
      .from(storeInstallResources)
      .where(and(eq(storeInstallResources.companyId, companyId), eq(storeInstallResources.itemId, itemId)));
  }

  async function bind(companyId: string, itemId: string, kind: ResourceKind, key: string, resourceId: string) {
    await db
      .insert(storeInstallResources)
      .values({ companyId, itemId, resourceKind: kind, resourceKey: key, resourceId })
      .onConflictDoUpdate({
        target: [
          storeInstallResources.companyId,
          storeInstallResources.itemId,
          storeInstallResources.resourceKind,
          storeInstallResources.resourceKey,
        ],
        set: { resourceId, updatedAt: new Date() },
      });
  }

  async function unbind(binding: Binding) {
    await db.delete(storeInstallResources).where(eq(storeInstallResources.id, binding.id));
  }

  async function removeResource(companyId: string, binding: Binding, userId: string | null) {
    if (binding.resourceKind === "skill") {
      await skills.deleteSkill(companyId, binding.resourceId).catch((err: unknown) => {
        if ((err as { status?: number }).status !== 404) throw err;
      });
    } else if (binding.resourceKind === "agent") {
      await agentSvc.terminate(binding.resourceId);
    } else if (binding.resourceKind === "routine") {
      const existing = await getRoutine(binding.resourceId);
      if (existing && existing.status !== "archived") {
        await routines.update(binding.resourceId, { status: "archived" }, { userId });
      }
    }
    await unbind(binding);
  }

  async function getRoutine(id: string) {
    return db.select().from(routinesTable).where(eq(routinesTable.id, id)).then((rows) => rows[0] ?? null);
  }

  async function mostUsedAdapter(companyId: string) {
    const rows = await db.select({ adapterType: agents.adapterType, status: agents.status }).from(agents).where(eq(agents.companyId, companyId));
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.status === "terminated" || !row.adapterType) continue;
      counts.set(row.adapterType, (counts.get(row.adapterType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  }

  async function writeInstructions(agent: Agent, content: string | null | undefined) {
    if (!content) return;
    const materialized = await instructions.materializeManagedBundle(agent, { "AGENTS.md": content }, {
      entryFile: "AGENTS.md",
      replaceExisting: true,
      clearLegacyPromptTemplate: true,
    });
    await agentSvc.update(agent.id, { adapterConfig: materialized.adapterConfig }, {
      recordRevision: { source: "store:instructions" },
      allowPendingApprovalConfigUpdate: true,
    });
  }

  async function syncAgent(
    companyId: string,
    item: ItemRow,
    declaration: StorePayload["agents"][number],
    binding: Binding | undefined,
    userId: string | null,
    installId: string | null,
  ) {
    // Lets the apps tie an agent to its store item and install without guessing by name.
    const storeMetadata = {
      storeItem: { itemId: item.id, itemKey: item.key, resourceKey: declaration.key },
      storeItemKey: item.key,
      ...(installId ? { installId } : {}),
    };
    const fields = {
      name: declaration.name,
      role: declaration.role,
      title: declaration.title ?? null,
      capabilities: declaration.capabilities ?? null,
    };
    const existing = binding ? ((await agentSvc.getById(binding.resourceId)) as Agent | null) : null;
    if (existing && existing.status !== "terminated") {
      const metadata = { ...((existing.metadata as Record<string, unknown> | null) ?? {}), ...storeMetadata };
      const updated = (await agentSvc.update(existing.id, { ...fields, metadata }, { recordRevision: { source: `store:${item.key}` }, allowPendingApprovalConfigUpdate: true })) as Agent | null;
      await writeInstructions(updated ?? existing, declaration.instructions);
      return existing.id;
    }

    const company = await db.select().from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    const requiresApproval = company.requireBoardApprovalForNewAgents;
    const adapterType = declaration.adapterType ?? (await mostUsedAdapter(companyId)) ?? defaultAdapterType();
    const created = (await agentSvc.create(companyId, {
      ...fields,
      adapterType,
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      budgetMonthlyCents: 0,
      status: requiresApproval ? "pending_approval" : "idle",
      metadata: storeMetadata,
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    })) as Agent;
    await writeInstructions(created, declaration.instructions);

    if (requiresApproval) {
      const approval = await approvals.create(companyId, {
        type: "hire_agent",
        requestedByAgentId: null,
        requestedByUserId: userId,
        status: "pending",
        payload: {
          name: created.name,
          role: created.role,
          title: created.title,
          capabilities: created.capabilities,
          adapterType: created.adapterType,
          agentId: created.id,
          sourceStoreItemKey: item.key,
        },
        decisionNote: null,
        decidedByUserId: null,
        decidedAt: null,
        updatedAt: new Date(),
      });
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "store",
        action: "approval.created",
        entityType: "approval",
        entityId: approval.id,
        details: { type: "hire_agent", linkedAgentId: created.id, sourceStoreItemKey: item.key },
      });
    }
    return created.id;
  }

  async function syncRoutine(
    companyId: string,
    declaration: StorePayload["routines"][number],
    binding: Binding | undefined,
    agentIds: Map<string, string>,
    userId: string | null,
  ) {
    const assigneeAgentId = declaration.agentKey ? agentIds.get(declaration.agentKey) ?? null : null;
    const existing = binding ? await getRoutine(binding.resourceId) : null;
    if (existing && existing.status !== "archived") {
      await routines.update(existing.id, {
        title: declaration.title,
        description: declaration.description ?? null,
        assigneeAgentId,
      }, { userId });
      return existing.id;
    }
    const created = await routines.create(companyId, {
      title: declaration.title,
      description: declaration.description ?? null,
      assigneeAgentId,
      priority: "medium",
      status: assigneeAgentId ? "active" : "paused",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      variables: [],
    }, { userId });
    if (declaration.cron) {
      await routines.createTrigger(created.id, {
        kind: "schedule",
        cronExpression: declaration.cron,
        timezone: declaration.timezone,
        enabled: true,
      }, { userId });
    }
    return created.id;
  }

  return {
    /** Make the company's copy of an item match `payload`. */
    async sync(companyId: string, item: ItemRow, payload: unknown, userId: string | null, installId: string | null = null) {
      if (!itemHasContent(item.kind)) return;
      const content = parseStorePayload(payload);
      const existing = await bindingsFor(companyId, item.id);
      const bindingFor = (kind: ResourceKind, key: string) =>
        existing.find((binding) => binding.resourceKind === kind && binding.resourceKey === key);

      for (const skill of content.skills) {
        const results = await skills.importPackageFiles(companyId, skillFiles(item, skill), { onConflict: "replace" });
        const imported = results.find((result) => result.skill.key === skillKeyFor(item, skill.key))?.skill ?? results[0]?.skill;
        if (!imported) throw notFound(`Skill ${skill.key} was not imported`);
        await bind(companyId, item.id, "skill", skill.key, imported.id);
      }

      const agentIds = new Map<string, string>();
      for (const agent of content.agents) {
        const id = await syncAgent(companyId, item, agent, bindingFor("agent", agent.key), userId, installId);
        agentIds.set(agent.key, id);
        await bind(companyId, item.id, "agent", agent.key, id);
      }

      for (const routine of content.routines) {
        const id = await syncRoutine(companyId, routine, bindingFor("routine", routine.key), agentIds, userId);
        await bind(companyId, item.id, "routine", routine.key, id);
      }

      const declared = {
        skill: new Set(content.skills.map((entry) => entry.key)),
        agent: new Set(content.agents.map((entry) => entry.key)),
        routine: new Set(content.routines.map((entry) => entry.key)),
      };
      // Routines first so nothing is left assigned to an agent that is going away.
      const dropped = existing
        .filter((binding) => !isPlatformResourceKey(binding.resourceKey))
        .filter((binding) => !declared[binding.resourceKind as ResourceKind]?.has(binding.resourceKey))
        .sort((a, b) => (a.resourceKind === "routine" ? -1 : 0) - (b.resourceKind === "routine" ? -1 : 0));
      for (const binding of dropped) await removeResource(companyId, binding, userId);

      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "store",
        action: "store.content_synced",
        entityType: "store_item",
        entityId: item.id,
        details: {
          itemKey: item.key,
          skills: content.skills.length,
          agents: content.agents.length,
          routines: content.routines.length,
          removed: dropped.length,
        },
      });
    },

    /** Take everything an item put inside the company back out. */
    async remove(companyId: string, item: ItemRow, userId: string | null) {
      const existing = await bindingsFor(companyId, item.id);
      const ordered = [...existing].sort((a, b) => (a.resourceKind === "routine" ? -1 : 0) - (b.resourceKind === "routine" ? -1 : 0));
      for (const binding of ordered) await removeResource(companyId, binding, userId);
    },

    listResources: bindingsFor,
    bind,
  };
}
