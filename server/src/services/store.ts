import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, nextgentBusinessLinks, storeDeployments, storeInstalls, storeItems, storeItemVersions } from "@paperclipai/db";
import { badRequest, conflict, notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { readNextgentConfig } from "./nextgent-config.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { parseStorePayload, storeContentService, storeNextgentSectionSchema } from "./store-content.js";
import {
  describePermissions,
  newPermissions,
  permissionsOf,
  nextgentSectionOf,
  nextgentStoreBridge,
  samePermissions,
  carriedGrant,
  initialGrant,
  type NextgentStoreBridge,
} from "./nextgent-store.js";
import { MENU_CATALOG, menuFromPayload } from "./store-menu.js";

/** Mirrors the store_items_kind_check constraint (packages/db/src/schema/store.ts). */
export const STORE_ITEM_KINDS = ["plugin", "pack", "skill", "automation", "connector", "agent", "app", "box-release"] as const;
export type StoreItemKind = (typeof STORE_ITEM_KINDS)[number];
export const STORE_CHANNELS = ["stable", "fast"] as const;
export type StoreChannel = (typeof STORE_CHANNELS)[number];
export const STORE_ADVISORY_TYPES = ["security", "bugfix", "enhancement"] as const;
export type StoreAdvisoryType = (typeof STORE_ADVISORY_TYPES)[number];
export const STORE_APPROVAL_MODES = ["automatic", "manual"] as const;
export type StoreApprovalMode = (typeof STORE_APPROVAL_MODES)[number];

/** Plugin releases carry free-form payload; only their NEXT GENT section is checked. */
function parsePluginPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = payload ?? {};
  if (value.nextgent !== undefined && value.nextgent !== null) {
    const parsed = storeNextgentSectionSchema.safeParse(value.nextgent);
    if (!parsed.success) {
      throw badRequest(`Release NEXT GENT section is not valid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    if (parsed.data.kind !== "app") throw badRequest("A plugin item can only be a NEXT GENT app");
    return { ...value, nextgent: parsed.data };
  }
  return value;
}

/**
 * A box-release is a signed nextgent-ghost-image plan: `plan` (ghost.json)
 * and its detached `signature`. The computers verify the signature; the
 * store only refuses a release that has none.
 */
function parseBoxReleasePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = payload ?? {};
  const plan = value.plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw badRequest("A box-release needs its plan (ghost.json) as an object");
  if (typeof value.signature !== "string" || !value.signature.trim()) throw badRequest("A box-release needs its signature");
  return { plan, signature: value.signature.trim() };
}

function priceOf(item: StoreItemRow) {
  if (item.priceAmountCents === null && !item.priceModel) return null;
  return {
    amountCents: item.priceAmountCents ?? 0,
    currency: item.priceCurrency,
    interval: item.priceInterval,
    model: item.priceModel,
  };
}

/** A "fast" subscription also receives everything released to "stable". */
function channelsFor(channel: string): StoreChannel[] {
  return channel === "fast" ? ["stable", "fast"] : ["stable"];
}

type StoreItemRow = typeof storeItems.$inferSelect;
type StoreVersionRow = typeof storeItemVersions.$inferSelect;
type StoreInstallRow = typeof storeInstalls.$inferSelect;

export interface StoreItemInput {
  key: string;
  kind: StoreItemKind;
  name: string;
  summary?: string | null;
  description?: string | null;
  iconUrl?: string | null;
  pluginKey?: string | null;
}

export interface StoreVersionInput {
  version: string;
  channel?: StoreChannel;
  advisoryType?: StoreAdvisoryType;
  required?: boolean;
  changelog?: string | null;
  payload?: Record<string, unknown>;
}

/** How a push moves installs. `force` also moves installs on manual updates. */
export const STORE_DEPLOY_ACTIONS = ["apply", "force"] as const;
export type StoreDeployAction = (typeof STORE_DEPLOY_ACTIONS)[number];
/**
 * Who a push reaches: every company (or every install), chosen companies, the
 * installs on given channels, or the companies whose linked business is of
 * given kinds (kinds are data: the linked businesses' own kinds).
 */
export const STORE_AUDIENCE_MODES = ["all", "companies", "channel", "kind"] as const;
export type StoreAudienceMode = (typeof STORE_AUDIENCE_MODES)[number];

export interface StoreDeployInput {
  version: string;
  action: StoreDeployAction;
  audience: { mode: StoreAudienceMode; companyIds?: string[]; values?: string[] };
  notes?: string | null;
  /** Also install the release where it is not installed yet (replaces gcr-api-clean's automation rollout). */
  installMissing?: boolean;
  /**
   * New installs from this push start switched on. Only for a release that
   * needs no business data and costs nothing; otherwise they start switched
   * off and the owner turns them on (which is their consent).
   */
  enabled?: boolean;
}

export interface StorePriceInput {
  amountCents: number | null;
  currency?: string | null;
  interval?: string | null;
  model?: string | null;
}

export interface StoreSubscriptionInput {
  channel?: StoreChannel;
  approvalMode?: StoreApprovalMode;
  /** Optional permissions the owner declines at install. */
  declinedPermissions?: string[];
}

/**
 * The platform store. The instance admin publishes items; a company sees an
 * item inside its workspace only after installing it.
 */
export function storeService(db: Db, options: { bridge?: NextgentStoreBridge; defaultCurrency?: string | null } = {}) {
  const plugins = pluginRegistryService(db);
  const content = storeContentService(db);
  const bridge = options.bridge ?? nextgentStoreBridge(db);

  /**
   * A release that asks for business data the owner has not approved never
   * applies on its own: the install stays on its version, "needs approval".
   */
  function requiresApproval(install: StoreInstallRow, version: StoreVersionRow) {
    // A switched-off install has granted nothing yet; the owner consents when turning it on.
    if (!install.enabled) return false;
    return newPermissions(install.approvedPermissions, nextgentSectionOf(version.payload)).length > 0;
  }

  /**
   * Make an install live in its company: the item's plugin on, the release's
   * content created, and gcr-api-clean told (token, routine). Undone on failure.
   */
  async function bringUp(item: StoreItemRow, install: StoreInstallRow, version: StoreVersionRow, userId: string | null, declined: string[]) {
    await applyToCompany(item, install.companyId, true);
    try {
      await content.sync(install.companyId, item, version.payload, userId, install.id);
      return await bridge.activate({
        item,
        install,
        version,
        userId,
        firstActivation: true,
        permissions: initialGrant(nextgentSectionOf(version.payload), declined),
      });
    } catch (err) {
      const current = await db.select().from(storeInstalls).where(eq(storeInstalls.id, install.id)).then((rows) => rows[0] ?? null);
      if (current) await bridge.deactivate(current).then((finish) => finish()).catch(() => undefined);
      await content.remove(install.companyId, item, userId).catch(() => undefined);
      await applyToCompany(item, install.companyId, false).catch(() => undefined);
      throw err;
    }
  }

  async function getItem(itemId: string): Promise<StoreItemRow> {
    const item = await db.select().from(storeItems).where(eq(storeItems.id, itemId)).then((rows) => rows[0]);
    if (!item) throw notFound("Store item not found");
    return item;
  }

  /** Newest version an install on `channel` may receive. */
  async function newestFor(itemId: string, channel: string): Promise<StoreVersionRow | null> {
    return db
      .select()
      .from(storeItemVersions)
      .where(and(eq(storeItemVersions.itemId, itemId), inArray(storeItemVersions.channel, channelsFor(channel))))
      .orderBy(desc(storeItemVersions.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function getInstall(companyId: string, itemId: string): Promise<StoreInstallRow | null> {
    return db
      .select()
      .from(storeInstalls)
      .where(and(eq(storeInstalls.companyId, companyId), eq(storeInstalls.itemId, itemId)))
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Put a release's content inside the company, then record the install as on
   * that release. When the release's data permissions differ from what was
   * approved, gcr-api-clean re-issues the install's token for the new set;
   * callers only get here with new permissions after the owner approved them.
   */
  async function moveInstall(item: StoreItemRow, install: StoreInstallRow, version: StoreVersionRow, userId: string | null) {
    // A switched-off install only records the release; it is created when turned on.
    if (install.enabled) await content.sync(install.companyId, item, version.payload, userId, install.id);
    const [updated] = await db
      .update(storeInstalls)
      .set({ versionId: version.id, updatedAt: new Date() })
      .where(eq(storeInstalls.id, install.id))
      .returning();
    if (!install.enabled) return updated;
    const section = nextgentSectionOf(version.payload);
    const granted = carriedGrant(install.approvedPermissions, section);
    if (section ? !samePermissions(install.approvedPermissions, granted) : install.approvedPermissions !== null) {
      try {
        await bridge.activate({ item, install: updated, version, userId, firstActivation: false, permissions: granted });
      } catch (err) {
        // gcr-api-clean kept the old scope, so this side goes back to the old
        // release too: version, grants and content. The install then still
        // shows the update as available, and the owner retries it explicitly.
        await rollBackMove(item, install, userId);
        throw err;
      }
    }
    return updated;
  }

  /** Undo moveInstall's Paperclip-side changes after gcr-api-clean refused the new scope. */
  async function rollBackMove(item: StoreItemRow, install: StoreInstallRow, userId: string | null) {
    try {
      await db
        .update(storeInstalls)
        .set({ versionId: install.versionId, approvedPermissions: install.approvedPermissions, updatedAt: new Date() })
        .where(eq(storeInstalls.id, install.id));
      const previous = install.versionId
        ? await db.select().from(storeItemVersions).where(eq(storeItemVersions.id, install.versionId)).then((rows) => rows[0] ?? null)
        : null;
      if (previous) await content.sync(install.companyId, item, previous.payload, userId, install.id);
    } catch (rollbackError) {
      logger.error({ err: rollbackError, installId: install.id, itemKey: item.key }, "Could not roll a store update back after gcr-api-clean refused it");
    }
  }

  interface DeployPlanEntry {
    companyId: string;
    install: StoreInstallRow | null;
    outcome: "apply" | "install" | "skip";
    reason: string | null;
    needsConsent: boolean;
    /** For outcome "install": whether the new install starts switched on. */
    enabled?: boolean;
  }

  /** Decide, per company in the audience, whether a push moves its install and why not. */
  async function planDeploy(itemId: string, input: StoreDeployInput) {
    const item = await getItem(itemId);
    const version = await db
      .select()
      .from(storeItemVersions)
      .where(and(eq(storeItemVersions.itemId, itemId), eq(storeItemVersions.version, input.version)))
      .then((rows) => rows[0] ?? null);
    if (!version) throw notFound(`${item.name} has no version ${input.version}`);
    const installs = await db.select().from(storeInstalls).where(eq(storeInstalls.itemId, itemId));
    const installOf = (companyId: string) => installs.find((install) => install.companyId === companyId) ?? null;
    const mode = input.audience.mode;
    let companyIds: string[];
    if (mode === "companies") {
      companyIds = [...new Set(input.audience.companyIds ?? [])];
      if (companyIds.length === 0) throw badRequest("Choose at least one company");
    } else if (mode === "channel") {
      const channels = new Set(input.audience.values ?? []);
      if (channels.size === 0) throw badRequest("Choose at least one channel");
      companyIds = installs.filter((install) => channels.has(install.channel)).map((install) => install.companyId);
    } else if (mode === "kind") {
      const kinds = [...new Set(input.audience.values ?? [])];
      if (kinds.length === 0) throw badRequest("Choose at least one business kind");
      const linked = await db
        .select({ companyId: nextgentBusinessLinks.companyId })
        .from(nextgentBusinessLinks)
        .where(inArray(nextgentBusinessLinks.businessKind, kinds));
      companyIds = linked.map((row) => row.companyId);
    } else if (input.installMissing) {
      const all = await db.select({ id: companies.id, status: companies.status }).from(companies);
      companyIds = all.filter((company) => company.status !== "archived").map((company) => company.id);
    } else {
      companyIds = installs.map((install) => install.companyId);
    }
    const existing = new Set((await db.select({ id: companies.id }).from(companies)).map((row) => row.id));
    const section = nextgentSectionOf(version.payload);
    const priced = (item.priceAmountCents ?? 0) > 0;
    const plan: DeployPlanEntry[] = companyIds.map((companyId) => {
      const install = installOf(companyId);
      const skip = (reason: string, needsConsent = false): DeployPlanEntry => ({ companyId, install, outcome: "skip", reason, needsConsent });
      if (!install) {
        if (!input.installMissing) return skip("not_installed");
        if (!existing.has(companyId)) return skip("no_such_company");
        if (item.status !== "published") return skip("not_published");
        // A pushed install is switched on only when it needs no consent: no data, no charge.
        const startOn = input.enabled === true && permissionsOf(section).length === 0 && !priced;
        return { companyId, install: null, outcome: "install", reason: null, needsConsent: false, enabled: startOn };
      }
      if (install.versionId === version.id) return skip("already_on_version");
      // New data access is always offered to the owner, never pushed or forced.
      if (requiresApproval(install, version)) return skip("needs_consent", true);
      if (input.action !== "force") {
        if (install.approvalMode !== "automatic") return skip("manual_updates");
        if (!channelsFor(install.channel).includes(version.channel as StoreChannel)) return skip("other_channel");
      }
      return { companyId, install, outcome: "apply", reason: null, needsConsent: false };
    });
    return { item, version, plan };
  }

  function summarize(plan: DeployPlanEntry[]) {
    const reasons: Record<string, number> = {};
    for (const entry of plan) if (entry.reason) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
    return {
      targeted: plan.length,
      apply: plan.filter((entry) => entry.outcome === "apply").length,
      install: plan.filter((entry) => entry.outcome === "install").length,
      installSwitchedOff: plan.filter((entry) => entry.outcome === "install" && !entry.enabled).length,
      skip: plan.filter((entry) => entry.outcome === "skip").length,
      needsConsent: plan.filter((entry) => entry.needsConsent).length,
      reasons,
      companies: plan.map((entry) => ({
        companyId: entry.companyId,
        outcome: entry.outcome,
        reason: entry.reason,
        ...(entry.outcome === "install" ? { enabled: entry.enabled === true } : {}),
      })),
    };
  }

  /** Turn the item's effect on or off inside one company. */
  async function applyToCompany(item: StoreItemRow, companyId: string, enabled: boolean) {
    if (item.kind !== "plugin" || !item.pluginKey) return;
    const plugin = await plugins.getByKey(item.pluginKey);
    if (!plugin) {
      if (enabled) throw conflict(`Plugin ${item.pluginKey} is not installed on this platform`);
      return;
    }
    const existing = await plugins.getCompanySettings(plugin.id, companyId);
    await plugins.upsertCompanySettings(plugin.id, companyId, {
      enabled,
      settingsJson: (existing?.settingsJson as Record<string, unknown> | undefined) ?? {},
    });
  }

  return {
    // ----- Admin ----------------------------------------------------------

    async listAll() {
      const items = await db.select().from(storeItems).orderBy(asc(storeItems.name));
      const installCounts = await db
        .select({ itemId: storeInstalls.itemId, installs: count() })
        .from(storeInstalls)
        .groupBy(storeInstalls.itemId);
      const versions = await db.select().from(storeItemVersions).orderBy(desc(storeItemVersions.createdAt));
      const countByItem = new Map(installCounts.map((row) => [row.itemId, Number(row.installs)]));
      return items.map((item) => ({
        ...item,
        price: priceOf(item),
        installCount: countByItem.get(item.id) ?? 0,
        versions: versions.filter((version) => version.itemId === item.id),
      }));
    },

    async create(input: StoreItemInput, userId: string | null) {
      if (input.kind === "plugin" && !input.pluginKey) throw badRequest("A plugin item needs a pluginKey");
      if (input.kind !== "plugin" && input.pluginKey) throw badRequest("Only plugin items take a pluginKey");
      const duplicate = await db.select({ id: storeItems.id }).from(storeItems).where(eq(storeItems.key, input.key));
      if (duplicate.length > 0) throw conflict(`A store item with key "${input.key}" already exists`);
      const [item] = await db
        .insert(storeItems)
        .values({ ...input, pluginKey: input.pluginKey ?? null, createdByUserId: userId })
        .returning();
      return item;
    },

    async update(itemId: string, patch: Partial<Omit<StoreItemInput, "key" | "kind" | "pluginKey">>) {
      await getItem(itemId);
      const [item] = await db
        .update(storeItems)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(storeItems.id, itemId))
        .returning();
      return item;
    },

    /**
     * Release a version to a channel. Installs on that channel with automatic
     * approval move to it at once; manual installs see it as an available
     * update. A required security advisory moves every install on the channel.
     */
    async addVersion(itemId: string, input: StoreVersionInput, userId: string | null) {
      const item = await getItem(itemId);
      const channel = input.channel ?? "stable";
      const advisoryType = input.advisoryType ?? "enhancement";
      const required = input.required ?? false;
      if (required && advisoryType !== "security") throw badRequest("Only security advisories can be required");
      const payload =
        item.kind === "plugin"
          ? parsePluginPayload(input.payload)
          : item.kind === "box-release"
            ? parseBoxReleasePayload(input.payload)
            : parseStorePayload(input.payload);
      const declared = nextgentSectionOf(payload);
      if (declared && (item.kind === "agent" || item.kind === "app" || item.kind === "automation") && declared.kind !== item.kind) {
        throw badRequest(`A ${item.kind} item's release must declare nextgent.kind "${item.kind}"`);
      }
      const version = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: storeItemVersions.id })
          .from(storeItemVersions)
          .where(and(eq(storeItemVersions.itemId, itemId), eq(storeItemVersions.version, input.version)));
        if (existing.length > 0) throw conflict(`Version ${input.version} already exists for ${item.name}`);
        const [inserted] = await tx
          .insert(storeItemVersions)
          .values({
            itemId,
            version: input.version,
            channel,
            advisoryType,
            required,
            changelog: input.changelog ?? null,
            payload,
            createdByUserId: userId,
          })
          .returning();
        // The item's headline version is its newest stable release.
        if (channel === "stable" || !item.latestVersionId) {
          await tx
            .update(storeItems)
            .set({ latestVersionId: inserted.id, updatedAt: new Date() })
            .where(eq(storeItems.id, itemId));
        }
        return inserted;
      });

      const reached = await db
        .select()
        .from(storeInstalls)
        .where(
          and(
            eq(storeInstalls.itemId, itemId),
            channel === "stable" ? undefined : eq(storeInstalls.channel, "fast"),
          ),
        );
      const consentNeeded = reached.filter((install) => requiresApproval(install, version));
      const applyTo = reached.filter(
        (install) => !consentNeeded.includes(install) && (required || install.approvalMode === "automatic"),
      );
      // One company's failure must not hold back the others; it keeps its old
      // version and can retry with Update.
      const failedFor: string[] = [];
      for (const install of applyTo) {
        try {
          await moveInstall(item, install, version, userId);
        } catch {
          failedFor.push(install.companyId);
        }
      }
      return {
        version,
        appliedTo: applyTo.length - failedFor.length,
        pendingFor: reached.length - applyTo.length,
        needsApprovalFor: consentNeeded.map((install) => install.companyId),
        failedFor,
      };
    },

    async publish(itemId: string) {
      const item = await getItem(itemId);
      if (!item.latestVersionId) throw badRequest("Add a version before publishing");
      if (item.kind === "plugin" && item.pluginKey && !(await plugins.getByKey(item.pluginKey))) {
        throw conflict(`Install plugin ${item.pluginKey} on the platform before publishing it`);
      }
      const [updated] = await db
        .update(storeItems)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(storeItems.id, itemId))
        .returning();
      return updated;
    },

    /** Unpublish: no new installs. Companies that already installed it keep it. */
    async retire(itemId: string) {
      await getItem(itemId);
      const [updated] = await db
        .update(storeItems)
        .set({ status: "retired", updatedAt: new Date() })
        .where(eq(storeItems.id, itemId))
        .returning();
      return updated;
    },

    // ----- Company --------------------------------------------------------

    /** Published items plus anything this company already has installed. */
    async listForCompany(companyId: string) {
      const installs = await db.select().from(storeInstalls).where(eq(storeInstalls.companyId, companyId));
      const installByItem = new Map(installs.map((install) => [install.itemId, install]));
      const items = await db.select().from(storeItems).orderBy(asc(storeItems.name));
      const visible = items.filter((item) => item.status === "published" || installByItem.has(item.id));
      const versions: StoreVersionRow[] = visible.length
        ? await db
            .select()
            .from(storeItemVersions)
            .where(inArray(storeItemVersions.itemId, visible.map((item) => item.id)))
            .orderBy(desc(storeItemVersions.createdAt))
        : [];
      return visible.map((item) => {
        const install = installByItem.get(item.id) ?? null;
        const channel = install?.channel ?? "stable";
        const itemVersions = versions.filter((version) => version.itemId === item.id);
        const latest = itemVersions.find((version) => channelsFor(channel).includes(version.channel as StoreChannel)) ?? null;
        const current = install ? itemVersions.find((version) => version.id === install.versionId) ?? null : null;
        const updateAvailable = install !== null && latest !== null && install.versionId !== latest.id;
        const updateNewPermissions = updateAvailable && latest ? newPermissions(install?.approvedPermissions, nextgentSectionOf(latest.payload)) : [];
        const shown = (current ?? latest)?.payload as Record<string, unknown[] | undefined> | undefined;
        const contents = {
          skills: shown?.skills?.length ?? 0,
          agents: shown?.agents?.length ?? 0,
          routines: shown?.routines?.length ?? 0,
          menu: menuFromPayload(shown).map((key) => MENU_CATALOG.find((entry) => entry.key === key)?.label ?? key),
        };
        return {
          id: item.id,
          key: item.key,
          kind: item.kind,
          name: item.name,
          summary: item.summary,
          description: item.description,
          iconUrl: item.iconUrl,
          status: item.status,
          latestVersion: latest?.version ?? null,
          installed: install !== null,
          /** False when an admin pushed it switched off; the owner turns it on. */
          enabled: install ? install.enabled : null,
          installedVersion: current?.version ?? null,
          channel: install?.channel ?? null,
          approvalMode: install?.approvalMode ?? null,
          updateAvailable,
          updateAdvisory: updateAvailable ? latest?.advisoryType ?? null : null,
          updateChangelog: updateAvailable ? latest?.changelog ?? null : null,
          /** The update asks for business data not yet approved: it waits for the owner. */
          needsApproval: updateNewPermissions.length > 0,
          updateNewPermissions,
          needsAccessTo: describePermissions(nextgentSectionOf((current ?? latest)?.payload)),
          contents,
        };
      });
    },

    async install(companyId: string, itemId: string, userId: string | null, subscription: StoreSubscriptionInput = {}) {
      const item = await getItem(itemId);
      if (item.status !== "published") throw conflict("This item is not available in the store");
      if (await getInstall(companyId, itemId)) throw conflict(`${item.name} is already installed`);
      const channel = subscription.channel ?? "stable";
      const version = await newestFor(itemId, channel);
      if (!version) throw conflict(`${item.name} has no release on the ${channel} channel`);
      // Plan check and price first: nothing is created for an item the business may not have.
      const charge = await bridge.assertEntitled(companyId, item.key);
      const installId = randomUUID();
      const [install] = await db
        .insert(storeInstalls)
        .values({
          id: installId,
          companyId,
          itemId,
          versionId: version.id,
          channel,
          approvalMode: subscription.approvalMode ?? "automatic",
          installedByUserId: userId,
        })
        .returning();
      let activation: { charged: boolean } | null = null;
      try {
        // Installing is the owner's consent to the release's permissions (less any optional ones declined).
        activation = await bringUp(item, install, version, userId, subscription.declinedPermissions ?? []);
      } catch (err) {
        await db.delete(storeInstalls).where(eq(storeInstalls.id, installId)).catch(() => undefined);
        throw err;
      }
      const [installed] = await db.select().from(storeInstalls).where(eq(storeInstalls.id, installId));
      // `charge` is what the plan says this costs; `charged` whether gcr-api-clean billed it now.
      return { ...installed, charge, charged: activation?.charged ?? false };
    },

    /** What the install screen shows before the owner says yes: data access with reasons, and the charge. */
    async consent(companyId: string, itemId: string, channel: StoreChannel = "stable") {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      const version = await newestFor(itemId, install?.channel ?? channel);
      const result = await bridge.consent(companyId, item, version);
      return {
        ...result,
        installed: install !== null,
        newPermissions: install && version ? newPermissions(install.approvedPermissions, nextgentSectionOf(version.payload)) : [],
      };
    },

    /** Change a company's channel or approval mode for an installed item. */
    async updateSubscription(companyId: string, itemId: string, subscription: StoreSubscriptionInput) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      const [updated] = await db
        .update(storeInstalls)
        .set({ ...subscription, updatedAt: new Date() })
        .where(eq(storeInstalls.id, install.id))
        .returning();
      return updated;
    },

    // ----- Admin: push, installs, price -------------------------------------

    /** The kinds of the businesses linked to companies, with how many, for the "kind" audience. */
    async businessKinds() {
      const rows = await db
        .select({ kind: nextgentBusinessLinks.businessKind, companies: count() })
        .from(nextgentBusinessLinks)
        .where(isNotNull(nextgentBusinessLinks.businessKind))
        .groupBy(nextgentBusinessLinks.businessKind);
      return rows
        .map((row) => ({ key: row.kind as string, count: Number(row.companies) }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    },

    /** Every company that has the item, with where it stands. */
    async listItemInstalls(itemId: string) {
      await getItem(itemId);
      const rows = await db
        .select({ install: storeInstalls, companyName: companies.name })
        .from(storeInstalls)
        .innerJoin(companies, eq(companies.id, storeInstalls.companyId))
        .where(eq(storeInstalls.itemId, itemId))
        .orderBy(asc(companies.name));
      const versions = await db.select().from(storeItemVersions).where(eq(storeItemVersions.itemId, itemId)).orderBy(desc(storeItemVersions.createdAt));
      return rows.map(({ install, companyName }) => {
        const current = versions.find((version) => version.id === install.versionId) ?? null;
        const latest = versions.find((version) => channelsFor(install.channel).includes(version.channel as StoreChannel)) ?? null;
        // A push can put an install ahead of its channel (e.g. forced onto a fast release).
        const behind = latest !== null && latest.id !== install.versionId && (!current || latest.createdAt > current.createdAt);
        const needsApproval = behind && latest ? requiresApproval(install, latest) : false;
        return {
          installId: install.id,
          companyId: install.companyId,
          companyName,
          version: current?.version ?? null,
          latestVersion: latest?.version ?? null,
          channel: install.channel,
          approvalMode: install.approvalMode,
          status: !install.enabled ? "switched_off" : needsApproval ? "needs_approval" : behind ? "update_available" : "current",
          enabled: install.enabled,
          approvedPermissions: install.approvedPermissions ?? [],
          installedAt: install.createdAt,
          updatedAt: install.updatedAt,
        };
      });
    },

    /** What a push would do, install by install, without changing anything. */
    async previewDeploy(itemId: string, input: StoreDeployInput) {
      const { plan } = await planDeploy(itemId, input);
      return summarize(plan);
    },

    /** Push a release to an audience and record it. One company's failure does not stop the rest. */
    async deploy(itemId: string, input: StoreDeployInput, userId: string | null) {
      const { item, version, plan } = await planDeploy(itemId, input);
      const failedFor: string[] = [];
      for (const entry of plan) {
        try {
          if (entry.outcome === "apply" && entry.install) {
            await moveInstall(item, entry.install, version, userId);
          } else if (entry.outcome === "install") {
            const [created] = await db
              .insert(storeInstalls)
              .values({
                companyId: entry.companyId,
                itemId,
                versionId: version.id,
                channel: version.channel,
                approvalMode: "automatic",
                installedByUserId: userId,
                enabled: false,
              })
              .returning();
            if (entry.enabled) {
              await bridge.assertEntitled(entry.companyId, item.key);
              await bringUp(item, created, version, userId, []);
              await db.update(storeInstalls).set({ enabled: true, updatedAt: new Date() }).where(eq(storeInstalls.id, created.id));
            }
          }
        } catch {
          if (entry.outcome === "install") {
            await db
              .delete(storeInstalls)
              .where(and(eq(storeInstalls.companyId, entry.companyId), eq(storeInstalls.itemId, itemId)))
              .catch(() => undefined);
          }
          entry.outcome = "skip";
          entry.reason = "failed";
          failedFor.push(entry.companyId);
        }
      }
      const summary = summarize(plan);
      const [deployment] = await db
        .insert(storeDeployments)
        .values({
          itemId,
          versionId: version.id,
          version: version.version,
          action: input.action,
          audience: input.audience as Record<string, unknown>,
          notes: input.notes ?? null,
          status: failedFor.length === 0 ? "completed" : summary.apply > 0 ? "partial" : "failed",
          targeted: summary.targeted,
          applied: summary.apply + summary.install,
          skipped: summary.skip,
          needsConsent: summary.needsConsent,
          failed: failedFor.length,
          reasons: summary.reasons,
          createdByUserId: userId,
        })
        .returning();
      return { deployment, ...summary, applied: summary.apply + summary.install, skipped: summary.skip, failedFor };
    },

    async listDeployments(limit = 200) {
      const rows = await db
        .select({ deployment: storeDeployments, itemName: storeItems.name, itemKey: storeItems.key, kind: storeItems.kind })
        .from(storeDeployments)
        .innerJoin(storeItems, eq(storeItems.id, storeDeployments.itemId))
        .orderBy(desc(storeDeployments.createdAt))
        .limit(limit);
      return rows.map(({ deployment, itemName, itemKey, kind }) => ({ ...deployment, itemName, itemKey, kind }));
    },

    /**
     * Set an item's price. gcr-api-clean's billing is told first, since it is
     * what entitlement and install charges read; only then is it shown here.
     */
    async setPrice(itemId: string, input: StorePriceInput) {
      const item = await getItem(itemId);
      const amountCents = input.amountCents ?? 0;
      if (!Number.isInteger(amountCents) || amountCents < 0) throw badRequest("amountCents must be a whole number of cents, 0 or more");
      const currency = (input.currency ?? options.defaultCurrency ?? readNextgentConfig().storePricing.defaultCurrency)?.trim().toLowerCase() ?? null;
      if (!currency) throw unprocessable("Send a currency, or set NEXTGENT_STORE_CURRENCY on the server");
      const price = { amountCents, currency, interval: input.interval?.trim() || null, model: input.model?.trim() || null };
      const billing = await bridge.setPrice(item.key, price);
      const [updated] = await db
        .update(storeItems)
        .set({
          priceAmountCents: price.amountCents,
          priceCurrency: price.currency,
          priceInterval: price.interval,
          priceModel: price.model,
          updatedAt: new Date(),
        })
        .where(eq(storeItems.id, itemId))
        .returning();
      return {
        itemId,
        itemKey: item.key,
        price: priceOf(updated),
        billing,
        ...(billing === null ? { warning: "gcr-api-clean is not configured; the price is not billed" } : {}),
      };
    },

    /**
     * The owner turns on an install an admin pushed switched off. This is the
     * owner's install: plan check, content, gcr-api-clean registration.
     */
    async enable(companyId: string, itemId: string, userId: string | null, options: { declinedPermissions?: string[] } = {}) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      if (install.enabled) return { ...install, charge: null, charged: false };
      const version = install.versionId
        ? await db.select().from(storeItemVersions).where(eq(storeItemVersions.id, install.versionId)).then((rows) => rows[0] ?? null)
        : await newestFor(itemId, install.channel);
      if (!version) throw conflict(`${item.name} has no release to turn on`);
      const charge = await bridge.assertEntitled(companyId, item.key);
      const activation = await bringUp(item, install, version, userId, options.declinedPermissions ?? []);
      const [enabled] = await db
        .update(storeInstalls)
        .set({ enabled: true, versionId: version.id, updatedAt: new Date() })
        .where(eq(storeInstalls.id, install.id))
        .returning();
      return { ...enabled, charge, charged: activation?.charged ?? false };
    },

    async uninstall(companyId: string, itemId: string, userId: string | null = null) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      // gcr-api-clean revokes the install's token and disables its automation first.
      const finish = await bridge.deactivate(install);
      await content.remove(companyId, item, userId);
      await applyToCompany(item, companyId, false);
      await db.delete(storeInstalls).where(eq(storeInstalls.id, install.id));
      await finish();
    },

    /**
     * The owner updates an install. A release asking for business data not yet
     * approved needs `approvePermissions: true`; without it the call answers
     * 409 with what is being asked for, and nothing changes.
     */
    async updateInstall(
      companyId: string,
      itemId: string,
      userId: string | null = null,
      options: { approvePermissions?: boolean } = {},
    ) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      const latest = await newestFor(itemId, install.channel);
      if (!latest) throw conflict(`${item.name} has no release on the ${install.channel} channel`);
      const asked = newPermissions(install.approvedPermissions, nextgentSectionOf(latest.payload));
      if (asked.length > 0 && options.approvePermissions !== true) {
        throw conflict(`${item.name} ${latest.version} needs access to more business data`, {
          code: "needs_approval",
          newPermissions: asked,
          needsAccessTo: describePermissions(nextgentSectionOf(latest.payload)),
        });
      }
      return moveInstall(item, install, latest, userId);
    },

    /**
     * Which store-managed plugins a company may see. Plugins that are not in
     * the store are unaffected; store plugins appear only once installed.
     */
    async pluginVisibility(companyId: string | null) {
      const managed = await db
        .select({ id: storeItems.id, pluginKey: storeItems.pluginKey })
        .from(storeItems)
        .where(isNotNull(storeItems.pluginKey));
      const installed = companyId
        ? await db
            .select({ itemId: storeInstalls.itemId })
            .from(storeInstalls)
            .where(and(eq(storeInstalls.companyId, companyId), eq(storeInstalls.enabled, true)))
        : [];
      const installedIds = new Set(installed.map((row) => row.itemId));
      return {
        storeManaged: new Set(managed.map((row) => row.pluginKey as string)),
        installed: new Set(managed.filter((row) => installedIds.has(row.id)).map((row) => row.pluginKey as string)),
      };
    },
  };
}
