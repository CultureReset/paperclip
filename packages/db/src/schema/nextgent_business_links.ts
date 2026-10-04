import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

/**
 * One Paperclip company is one business. This is Paperclip's copy of the link
 * gcr-api-clean holds in `company_links`: which business the company runs,
 * its forwarding address, and the company secret holding the business token
 * the agents' business-data tools use. Business data itself never lives here.
 */
export const nextgentBusinessLinks = pgTable(
  "nextgent_business_links",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
    entitySlug: text("entity_slug").notNull(),
    forwardingAddress: text("forwarding_address"),
    /** The business's kind (gcr-api-clean entity type) when known, for store audiences. */
    businessKind: text("business_kind"),
    businessTokenSecretId: uuid("business_token_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    linkedByUserId: text("linked_by_user_id"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entitySlugUq: uniqueIndex("nextgent_business_links_entity_slug_uq").on(table.entitySlug),
  }),
);
