CREATE TABLE "store_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version_id" uuid,
	"version" text NOT NULL,
	"action" text NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"targeted" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"needs_consent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_items" DROP CONSTRAINT "store_items_kind_check";--> statement-breakpoint
ALTER TABLE "store_items" ADD COLUMN "price_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "store_items" ADD COLUMN "price_currency" text;--> statement-breakpoint
ALTER TABLE "store_items" ADD COLUMN "price_interval" text;--> statement-breakpoint
ALTER TABLE "store_items" ADD COLUMN "price_model" text;--> statement-breakpoint
ALTER TABLE "store_deployments" ADD CONSTRAINT "store_deployments_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_deployments" ADD CONSTRAINT "store_deployments_version_id_store_item_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."store_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_deployments_item_created_idx" ON "store_deployments" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "store_deployments_created_idx" ON "store_deployments" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_kind_check" CHECK ("store_items"."kind" IN ('plugin', 'pack', 'skill', 'automation', 'connector', 'agent', 'app', 'box-release'));