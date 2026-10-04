import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeInstalls, storeItems, storeItemVersions } from "@paperclipai/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { parseStorePayload, storeContentService } from "./store-content.js";
import { MENU_CATALOG, menuFromPayload } from "./store-menu.js";

export const STORE_ITEM_KINDS = ["plugin", "pack", "skill", "automation", "connector"] as const;
export type StoreItemKind = (typeof STORE_ITEM_KINDS)[number];
export const STORE_CHANNELS = ["stable", "fast"] as const;
export type StoreChannel = (typeof STORE_CHANNELS)[number];
export const STORE_ADVISORY_TYPES = ["security", "bugfix", "enhancement"] as const;
export type StoreAdvisoryType = (typeof STORE_ADVISORY_TYPES)[number];
export const STORE_APPROVAL_MODES = ["automatic", "manual"] as const;
export type StoreApprovalMode = (typeof STORE_APPROVAL_MODES)[number];

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

export interface StoreSubscriptionInput {
  channel?: StoreChannel;
  approvalMode?: StoreApprovalMode;
}

/**
 * The platform store. The instance admin publishes items; a company sees an
 * item inside its workspace only after installing it.
 */
export function storeService(db: Db) {
  const plugins = pluginRegistryService(db);
  const content = storeContentService(db);

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

  /** Put a release's content inside the company, then record the install as on that release. */
  async function moveInstall(item: StoreItemRow, install: StoreInstallRow, version: StoreVersionRow, userId: string | null) {
    await content.sync(install.companyId, item, version.payload, userId);
    const [updated] = await db
      .update(storeInstalls)
      .set({ versionId: version.id, updatedAt: new Date() })
      .where(eq(storeInstalls.id, install.id))
      .returning();
    return updated;
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
      const payload = item.kind === "plugin" ? input.payload ?? {} : parseStorePayload(input.payload);
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
      const applyTo = reached.filter((install) => required || install.approvalMode === "automatic");
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
          installedVersion: current?.version ?? null,
          channel: install?.channel ?? null,
          approvalMode: install?.approvalMode ?? null,
          updateAvailable,
          updateAdvisory: updateAvailable ? latest?.advisoryType ?? null : null,
          updateChangelog: updateAvailable ? latest?.changelog ?? null : null,
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
      await applyToCompany(item, companyId, true);
      try {
        await content.sync(companyId, item, version.payload, userId);
      } catch (err) {
        await content.remove(companyId, item, userId).catch(() => undefined);
        await applyToCompany(item, companyId, false).catch(() => undefined);
        throw err;
      }
      const [install] = await db
        .insert(storeInstalls)
        .values({
          companyId,
          itemId,
          versionId: version.id,
          channel,
          approvalMode: subscription.approvalMode ?? "automatic",
          installedByUserId: userId,
        })
        .returning();
      return install;
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

    async uninstall(companyId: string, itemId: string, userId: string | null = null) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      await content.remove(companyId, item, userId);
      await applyToCompany(item, companyId, false);
      await db.delete(storeInstalls).where(eq(storeInstalls.id, install.id));
    },

    async updateInstall(companyId: string, itemId: string, userId: string | null = null) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      const latest = await newestFor(itemId, install.channel);
      if (!latest) throw conflict(`${item.name} has no release on the ${install.channel} channel`);
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
            .where(eq(storeInstalls.companyId, companyId))
        : [];
      const installedIds = new Set(installed.map((row) => row.itemId));
      return {
        storeManaged: new Set(managed.map((row) => row.pluginKey as string)),
        installed: new Set(managed.filter((row) => installedIds.has(row.id)).map((row) => row.pluginKey as string)),
      };
    },
  };
}
