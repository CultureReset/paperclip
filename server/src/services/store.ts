import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeInstalls, storeItems, storeItemVersions } from "@paperclipai/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { pluginRegistryService } from "./plugin-registry.js";

export const STORE_ITEM_KINDS = ["plugin", "pack", "skill", "automation", "connector"] as const;
export type StoreItemKind = (typeof STORE_ITEM_KINDS)[number];

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
  changelog?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * The platform store. The instance admin publishes items; a company sees an
 * item inside its workspace only after installing it.
 */
export function storeService(db: Db) {
  const plugins = pluginRegistryService(db);

  async function getItem(itemId: string): Promise<StoreItemRow> {
    const item = await db.select().from(storeItems).where(eq(storeItems.id, itemId)).then((rows) => rows[0]);
    if (!item) throw notFound("Store item not found");
    return item;
  }

  async function getInstall(companyId: string, itemId: string): Promise<StoreInstallRow | null> {
    return db
      .select()
      .from(storeInstalls)
      .where(and(eq(storeInstalls.companyId, companyId), eq(storeInstalls.itemId, itemId)))
      .then((rows) => rows[0] ?? null);
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
     * Add a version. It becomes the item's latest version; with `push`, every
     * company that installed the item is moved to it.
     */
    async addVersion(itemId: string, input: StoreVersionInput, userId: string | null, options: { push: boolean }) {
      const item = await getItem(itemId);
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: storeItemVersions.id })
          .from(storeItemVersions)
          .where(and(eq(storeItemVersions.itemId, itemId), eq(storeItemVersions.version, input.version)));
        if (existing.length > 0) throw conflict(`Version ${input.version} already exists for ${item.name}`);
        const [version] = await tx
          .insert(storeItemVersions)
          .values({
            itemId,
            version: input.version,
            changelog: input.changelog ?? null,
            payload: input.payload ?? {},
            createdByUserId: userId,
          })
          .returning();
        await tx
          .update(storeItems)
          .set({ latestVersionId: version.id, updatedAt: new Date() })
          .where(eq(storeItems.id, itemId));
        let pushedTo = 0;
        if (options.push) {
          const updated = await tx
            .update(storeInstalls)
            .set({ versionId: version.id, updatedAt: new Date() })
            .where(eq(storeInstalls.itemId, itemId))
            .returning({ id: storeInstalls.id });
          pushedTo = updated.length;
        }
        return { version, pushedTo };
      });
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
      const versionIds = items.map((item) => item.latestVersionId).filter((id): id is string => Boolean(id));
      const versions: StoreVersionRow[] = versionIds.length
        ? await db.select().from(storeItemVersions).where(inArray(storeItemVersions.id, versionIds))
        : [];
      const versionById = new Map(versions.map((version) => [version.id, version]));
      return items
        .filter((item) => item.status === "published" || installByItem.has(item.id))
        .map((item) => {
          const install = installByItem.get(item.id) ?? null;
          const latest = item.latestVersionId ? versionById.get(item.latestVersionId) ?? null : null;
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
            installedVersionId: install?.versionId ?? null,
            updateAvailable: install !== null && install.versionId !== item.latestVersionId,
          };
        });
    },

    async install(companyId: string, itemId: string, userId: string | null) {
      const item = await getItem(itemId);
      if (item.status !== "published") throw conflict("This item is not available in the store");
      if (await getInstall(companyId, itemId)) throw conflict(`${item.name} is already installed`);
      await applyToCompany(item, companyId, true);
      const [install] = await db
        .insert(storeInstalls)
        .values({ companyId, itemId, versionId: item.latestVersionId, installedByUserId: userId })
        .returning();
      return install;
    },

    async uninstall(companyId: string, itemId: string) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      await applyToCompany(item, companyId, false);
      await db.delete(storeInstalls).where(eq(storeInstalls.id, install.id));
    },

    async updateInstall(companyId: string, itemId: string) {
      const item = await getItem(itemId);
      const install = await getInstall(companyId, itemId);
      if (!install) throw notFound(`${item.name} is not installed`);
      const [updated] = await db
        .update(storeInstalls)
        .set({ versionId: item.latestVersionId, updatedAt: new Date() })
        .where(eq(storeInstalls.id, install.id))
        .returning();
      return updated;
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
