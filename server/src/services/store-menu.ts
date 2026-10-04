import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeInstalls, storeItemVersions, storeSettings } from "@paperclipai/db";
import { badRequest } from "../errors.js";

/**
 * Every menu entry a company can have. `paths` are the app routes the entry
 * covers, so the app can hide links and the server stays the one list.
 */
export const MENU_CATALOG = [
  { key: "search", label: "Search", paths: ["/search"] },
  { key: "dashboard", label: "Dashboard", paths: ["/dashboard"] },
  { key: "inbox", label: "Inbox", paths: ["/inbox"] },
  { key: "store", label: "Store", paths: ["/store"] },
  { key: "decisions", label: "Decisions", paths: ["/decisions"] },
  { key: "status", label: "Status", paths: ["/status"] },
  { key: "conference-room", label: "Conference Room", paths: ["/board-chat"] },
  { key: "tasks", label: "Tasks", paths: ["/issues"] },
  { key: "projects", label: "Projects", paths: ["/projects"] },
  { key: "routines", label: "Routines", paths: ["/routines"] },
  { key: "goals", label: "Goals", paths: ["/goals"] },
  { key: "artifacts", label: "Artifacts", paths: ["/artifacts"] },
  { key: "skills", label: "Skills", paths: ["/skills"] },
  { key: "workspaces", label: "Workspaces", paths: ["/workspaces"] },
  { key: "cases", label: "Cases", paths: ["/cases"] },
  { key: "pipelines", label: "Pipelines", paths: ["/pipelines"] },
  { key: "agents", label: "Agents", paths: ["/agents", "/org"] },
  { key: "connectors", label: "Connectors", paths: ["/apps"] },
  { key: "timeline", label: "Timeline", paths: ["/timeline"] },
  { key: "costs", label: "Costs", paths: ["/costs"] },
  { key: "activity", label: "Activity", paths: ["/activity"] },
  { key: "settings", label: "Settings", paths: ["/company/settings"] },
] as const;

export type MenuKey = (typeof MENU_CATALOG)[number]["key"];
export const MENU_KEYS = MENU_CATALOG.map((entry) => entry.key) as [MenuKey, ...MenuKey[]];

/** Always shown: without these a company could not reach the store or its settings. */
export const LOCKED_MENU: MenuKey[] = ["store", "settings"];
/** Used until the platform admin saves a core menu. */
export const DEFAULT_CORE_MENU: MenuKey[] = ["search", "dashboard", "inbox", "store", "settings"];

/** Menu entries a release turns on: the ones it names, plus the ones its content needs. */
export function menuFromPayload(payload: unknown): MenuKey[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const keys = new Set<MenuKey>();
  const valid = new Set<string>(MENU_KEYS);
  if (Array.isArray(record.menu)) {
    for (const key of record.menu) if (typeof key === "string" && valid.has(key)) keys.add(key as MenuKey);
  }
  const has = (field: string) => Array.isArray(record[field]) && (record[field] as unknown[]).length > 0;
  if (has("agents")) keys.add("agents");
  if (has("routines")) keys.add("routines");
  if (has("skills")) keys.add("skills");
  return [...keys];
}

export function storeMenuService(db: Db) {
  async function coreMenu(): Promise<MenuKey[]> {
    const row = await db
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.singletonKey, "default"))
      .then((rows) => rows[0] ?? null);
    const saved = (row?.coreMenu ?? DEFAULT_CORE_MENU) as MenuKey[];
    return [...new Set([...saved, ...LOCKED_MENU])];
  }

  return {
    coreMenu,

    async setCoreMenu(keys: string[]) {
      const valid = new Set<string>(MENU_KEYS);
      const unknown = keys.filter((key) => !valid.has(key));
      if (unknown.length > 0) throw badRequest(`Unknown menu entries: ${unknown.join(", ")}`);
      const coreMenu = [...new Set([...keys, ...LOCKED_MENU])];
      await db
        .insert(storeSettings)
        .values({ singletonKey: "default", coreMenu })
        .onConflictDoUpdate({ target: storeSettings.singletonKey, set: { coreMenu, updatedAt: new Date() } });
      return coreMenu;
    },

    /** What one company's menu shows: the core entries plus what its installs turn on. */
    async visibleFor(companyId: string) {
      const core = await coreMenu();
      const installs = await db
        .select({ versionId: storeInstalls.versionId })
        .from(storeInstalls)
        .where(eq(storeInstalls.companyId, companyId));
      const versionIds = installs.map((install) => install.versionId).filter((id): id is string => Boolean(id));
      const versions = versionIds.length
        ? await db
            .select({ payload: storeItemVersions.payload })
            .from(storeItemVersions)
            .where(and(inArray(storeItemVersions.id, versionIds)))
        : [];
      const unlocked = new Set<MenuKey>();
      for (const version of versions) for (const key of menuFromPayload(version.payload)) unlocked.add(key);
      return {
        catalog: MENU_CATALOG,
        core,
        visible: MENU_KEYS.filter((key) => core.includes(key) || unlocked.has(key)),
      };
    },
  };
}
