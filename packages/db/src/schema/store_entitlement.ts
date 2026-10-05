import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { storeItems } from "./store.js";

/**
 * Entitlement (DECISIONS #83, port of gcr-api-clean lib/entitlements.js):
 * may this company have this store item? Free items: everyone. Grant: the
 * operator granted it to the company and the grant is live. Plan: the
 * company's plan (or the default plan) includes the item.
 */
export const storePlans = pgTable(
  "store_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Shown to companies choosing a plan. */
    isPublic: boolean("is_public").notNull().default(true),
    /** The plan a company without one is on. At most one. */
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUq: uniqueIndex("store_plans_key_uq").on(table.key),
    defaultUq: uniqueIndex("store_plans_default_uq").on(table.isDefault).where(sql`${table.isDefault} = true`),
  }),
);

export const storePlanItems = pgTable(
  "store_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => storePlans.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planItemUq: uniqueIndex("store_plan_items_plan_item_uq").on(table.planId, table.itemId),
    itemIdx: index("store_plan_items_item_idx").on(table.itemId),
  }),
);

export const storeGrants = pgTable(
  "store_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    note: text("note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("store_grants_company_idx").on(table.companyId),
    liveUq: uniqueIndex("store_grants_live_uq").on(table.companyId, table.itemId).where(sql`${table.revokedAt} IS NULL`),
  }),
);

/**
 * Which plan a company is on. One row per company; `status` active or
 * trialing counts, `paused` refuses priced installs (gcr-api-clean's billing
 * pause, carried here until billing moves, DECISIONS #83).
 */
export const companyPlans = pgTable(
  "company_plans",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => storePlans.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: text("pause_reason"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check("company_plans_status_check", sql`${table.status} IN ('active', 'trialing', 'paused', 'cancelled')`),
  }),
);
