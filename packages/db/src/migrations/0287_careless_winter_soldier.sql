CREATE TABLE "store_install_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_install_resources_kind_check" CHECK ("store_install_resources"."resource_kind" IN ('skill', 'agent', 'routine'))
);
--> statement-breakpoint
ALTER TABLE "store_install_resources" ADD CONSTRAINT "store_install_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_install_resources" ADD CONSTRAINT "store_install_resources_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_install_resources_company_item_resource_uq" ON "store_install_resources" USING btree ("company_id","item_id","resource_kind","resource_key");--> statement-breakpoint
CREATE INDEX "store_install_resources_resource_idx" ON "store_install_resources" USING btree ("resource_kind","resource_id");