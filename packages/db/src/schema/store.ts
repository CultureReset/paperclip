import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Platform store: items the instance admin publishes and each company may
 * install. An item is only visible inside a company once that company has
 * installed it.
 */
export const storeItems = pgTable(
  "store_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    description: text("description"),
    iconUrl: text("icon_url"),
    /** For kind = "plugin": the plugin_key this item installs. */
    pluginKey: text("plugin_key"),
    status: text("status").notNull().default("draft"),
    latestVersionId: uuid("latest_version_id"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUq: uniqueIndex("store_items_key_uq").on(table.key),
    pluginKeyUq: uniqueIndex("store_items_plugin_key_uq").on(table.pluginKey),
    statusIdx: index("store_items_status_idx").on(table.status),
    kindCheck: check(
      "store_items_kind_check",
      sql`${table.kind} IN ('plugin', 'pack', 'skill', 'automation', 'connector')`,
    ),
    statusCheck: check("store_items_status_check", sql`${table.status} IN ('draft', 'published', 'retired')`),
    pluginKeyCheck: check(
      "store_items_plugin_key_check",
      sql`(${table.kind} = 'plugin') = (${table.pluginKey} IS NOT NULL)`,
    ),
  }),
);

export const storeItemVersions = pgTable(
  "store_item_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    changelog: text("changelog"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemVersionUq: uniqueIndex("store_item_versions_item_version_uq").on(table.itemId, table.version),
    itemCreatedIdx: index("store_item_versions_item_created_idx").on(table.itemId, table.createdAt),
  }),
);

export const storeInstalls = pgTable(
  "store_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => storeItemVersions.id, { onDelete: "set null" }),
    installedByUserId: text("installed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyItemUq: uniqueIndex("store_installs_company_item_uq").on(table.companyId, table.itemId),
    itemIdx: index("store_installs_item_idx").on(table.itemId),
  }),
);
