import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Owner notifications (DECISIONS #85, port of gcr-api-clean
 * owner_notify_settings / owner_notifications): where a company's owner
 * hears about the review queue, unknown senders, approvals and failed
 * actions, and a log of every attempt, including the skipped ones and why.
 */
export const notificationSettings = pgTable("notification_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  email: text("email"),
  phone: text("phone"),
  emailOn: boolean("email_on").notNull().default(true),
  smsOn: boolean("sms_on").notNull().default(true),
  mutedKinds: jsonb("muted_kinds").$type<string[]>().notNull().default([]),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Deduplication key: the same ref is never announced twice for a kind. */
    ref: text("ref"),
    title: text("title").notNull(),
    /** { email: "sent"|<reason>, sms: "sent"|<reason>, skipped?: <why> } */
    channels: jsonb("channels").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("notification_log_company_created_idx").on(table.companyId, table.createdAt),
    refIdx: index("notification_log_ref_idx").on(table.companyId, table.kind, table.ref),
  }),
);
