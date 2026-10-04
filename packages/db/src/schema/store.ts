import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, index, uniqueIndex, check } from "drizzle-orm/pg-core";
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
    /**
     * The item's price, as the instance admin set it. gcr-api-clean's billing
     * holds the authoritative copy (it bills installs); this one is for display.
     */
    priceAmountCents: integer("price_amount_cents"),
    priceCurrency: text("price_currency"),
    priceInterval: text("price_interval"),
    priceModel: text("price_model"),
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
      sql`${table.kind} IN ('plugin', 'pack', 'skill', 'automation', 'connector', 'agent', 'app', 'box-release')`,
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
    /** Release channel, as in Red Hat/OLM: "stable" for everyone, "fast" for early access. */
    channel: text("channel").notNull().default("stable"),
    /** Advisory type, as in Red Hat errata. */
    advisoryType: text("advisory_type").notNull().default("enhancement"),
    /** A required security advisory reaches every install on its channels, even manual ones. */
    required: boolean("required").notNull().default(false),
    changelog: text("changelog"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemVersionUq: uniqueIndex("store_item_versions_item_version_uq").on(table.itemId, table.version),
    itemCreatedIdx: index("store_item_versions_item_created_idx").on(table.itemId, table.createdAt),
    channelCheck: check("store_item_versions_channel_check", sql`${table.channel} IN ('stable', 'fast')`),
    advisoryCheck: check(
      "store_item_versions_advisory_check",
      sql`${table.advisoryType} IN ('security', 'bugfix', 'enhancement')`,
    ),
    requiredCheck: check(
      "store_item_versions_required_check",
      sql`NOT ${table.required} OR ${table.advisoryType} = 'security'`,
    ),
  }),
);

export const storeInstalls = pgTable(
  "store_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => storeItemVersions.id, { onDelete: "set null" }),
    /** "stable" receives stable releases; "fast" receives stable and fast releases. */
    channel: text("channel").notNull().default("stable"),
    /** "automatic" takes new releases as they ship; "manual" stays put until the company updates. */
    approvalMode: text("approval_mode").notNull().default("automatic"),
    installedByUserId: text("installed_by_user_id"),
    /**
     * Data permissions (resource:action) the owner approved for this install.
     * A release that asks for anything outside this list waits for approval
     * instead of applying automatically. Null when the item declares none.
     */
    approvedPermissions: jsonb("approved_permissions").$type<string[]>(),
    /** Company secret holding the token gcr-api-clean issued for this install. */
    tokenSecretId: uuid("token_secret_id"),
    /**
     * False for an install an admin pushed "switched off": it is listed in the
     * company but nothing is created, registered or billed until the owner
     * turns it on, which is also the owner's consent to its data access.
     */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyItemUq: uniqueIndex("store_installs_company_item_uq").on(table.companyId, table.itemId),
    itemIdx: index("store_installs_item_idx").on(table.itemId),
    channelCheck: check("store_installs_channel_check", sql`${table.channel} IN ('stable', 'fast')`),
    approvalCheck: check("store_installs_approval_check", sql`${table.approvalMode} IN ('automatic', 'manual')`),
  }),
);

/**
 * What an install created inside its company: one row per skill, agent or
 * routine declared in the installed release. Updates change these in place;
 * uninstall removes them.
 */
export const storeInstallResources = pgTable(
  "store_install_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    resourceKey: text("resource_key").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyItemResourceUq: uniqueIndex("store_install_resources_company_item_resource_uq").on(
      table.companyId,
      table.itemId,
      table.resourceKind,
      table.resourceKey,
    ),
    resourceIdx: index("store_install_resources_resource_idx").on(table.resourceKind, table.resourceId),
    kindCheck: check(
      "store_install_resources_kind_check",
      sql`${table.resourceKind} IN ('skill', 'agent', 'routine')`,
    ),
  }),
);

/**
 * Platform-wide store settings, one row. `coreMenu` lists the menu entries
 * every company sees; everything else appears only once an installed item
 * turns it on.
 */
export const storeSettings = pgTable("store_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  singletonKey: text("singleton_key").notNull().default("default").unique(),
  coreMenu: jsonb("core_menu").$type<string[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A push of one release to an audience of companies (all, chosen companies,
 * or a channel), as the instance admin sent it, with what it reached.
 */
export const storeDeployments = pgTable(
  "store_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => storeItemVersions.id, { onDelete: "set null" }),
    version: text("version").notNull(),
    action: text("action").notNull(),
    audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    status: text("status").notNull().default("completed"),
    targeted: integer("targeted").notNull().default(0),
    applied: integer("applied").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    needsConsent: integer("needs_consent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    reasons: jsonb("reasons").$type<Record<string, number>>().notNull().default({}),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemCreatedIdx: index("store_deployments_item_created_idx").on(table.itemId, table.createdAt),
    createdIdx: index("store_deployments_created_idx").on(table.createdAt),
  }),
);
