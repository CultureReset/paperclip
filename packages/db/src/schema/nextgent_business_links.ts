import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

/**
 * One Paperclip company is one business. This row is the reference side of
 * the link gcr-api-clean holds in `company_links`: which business the company
 * runs (`entity_slug`, DECISIONS #40) and the company secret holding the
 * business token the agents' business-data tools use. Facts about the
 * business (its kind, its forwarding address, anything else) live in
 * gcr-api-clean and are read from it, never copied here (DECISIONS #32, #33).
 */
export const nextgentBusinessLinks = pgTable(
  "nextgent_business_links",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
    entitySlug: text("entity_slug").notNull(),
    businessTokenSecretId: uuid("business_token_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    linkedByUserId: text("linked_by_user_id"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entitySlugUq: uniqueIndex("nextgent_business_links_entity_slug_uq").on(table.entitySlug),
  }),
);
