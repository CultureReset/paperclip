CREATE TABLE "nextgent_business_links_archive_0293" AS SELECT "company_id", "business_kind", "forwarding_address", now() AS "archived_at" FROM "nextgent_business_links";--> statement-breakpoint
ALTER TABLE "nextgent_business_links" DROP COLUMN "forwarding_address";--> statement-breakpoint
ALTER TABLE "nextgent_business_links" DROP COLUMN "business_kind";
