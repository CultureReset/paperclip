ALTER TABLE "store_installs" ADD COLUMN "channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_installs" ADD COLUMN "approval_mode" text DEFAULT 'automatic' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD COLUMN "channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD COLUMN "advisory_type" text DEFAULT 'enhancement' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD COLUMN "required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_installs" ADD CONSTRAINT "store_installs_channel_check" CHECK ("store_installs"."channel" IN ('stable', 'fast'));--> statement-breakpoint
ALTER TABLE "store_installs" ADD CONSTRAINT "store_installs_approval_check" CHECK ("store_installs"."approval_mode" IN ('automatic', 'manual'));--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD CONSTRAINT "store_item_versions_channel_check" CHECK ("store_item_versions"."channel" IN ('stable', 'fast'));--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD CONSTRAINT "store_item_versions_advisory_check" CHECK ("store_item_versions"."advisory_type" IN ('security', 'bugfix', 'enhancement'));--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD CONSTRAINT "store_item_versions_required_check" CHECK (NOT "store_item_versions"."required" OR "store_item_versions"."advisory_type" = 'security');