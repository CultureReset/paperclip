CREATE TABLE "store_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"version_id" uuid,
	"installed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" text NOT NULL,
	"changelog" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"description" text,
	"icon_url" text,
	"plugin_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"latest_version_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_items_kind_check" CHECK ("store_items"."kind" IN ('plugin', 'pack', 'skill', 'automation', 'connector')),
	CONSTRAINT "store_items_status_check" CHECK ("store_items"."status" IN ('draft', 'published', 'retired')),
	CONSTRAINT "store_items_plugin_key_check" CHECK (("store_items"."kind" = 'plugin') = ("store_items"."plugin_key" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "store_installs" ADD CONSTRAINT "store_installs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_installs" ADD CONSTRAINT "store_installs_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_installs" ADD CONSTRAINT "store_installs_version_id_store_item_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."store_item_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_item_versions" ADD CONSTRAINT "store_item_versions_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_installs_company_item_uq" ON "store_installs" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE INDEX "store_installs_item_idx" ON "store_installs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_item_versions_item_version_uq" ON "store_item_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "store_item_versions_item_created_idx" ON "store_item_versions" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_items_key_uq" ON "store_items" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_items_plugin_key_uq" ON "store_items" USING btree ("plugin_key");--> statement-breakpoint
CREATE INDEX "store_items_status_idx" ON "store_items" USING btree ("status");