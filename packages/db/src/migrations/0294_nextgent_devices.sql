CREATE TABLE "nextgent_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"relay_node_id" text NOT NULL,
	"device_key" text NOT NULL,
	"paired_computer_id" uuid,
	"name" text,
	"version" text,
	"capabilities" jsonb,
	"sim_status" text,
	"phone_number" text,
	"last_seen_at" timestamp with time zone,
	"paired_by_user_id" text,
	"paired_at" timestamp with time zone,
	"unlinked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nextgent_devices" ADD CONSTRAINT "nextgent_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nextgent_devices_relay_kind_key_uq" ON "nextgent_devices" USING btree ("relay_node_id","kind","device_key");--> statement-breakpoint
CREATE INDEX "nextgent_devices_company_idx" ON "nextgent_devices" USING btree ("company_id");