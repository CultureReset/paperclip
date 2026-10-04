ALTER TABLE "nextgent_business_links" ADD COLUMN "business_kind" text;--> statement-breakpoint
ALTER TABLE "store_installs" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;