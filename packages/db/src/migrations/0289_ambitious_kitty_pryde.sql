CREATE TABLE "nextgent_business_links" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"entity_slug" text NOT NULL,
	"forwarding_address" text,
	"business_token_secret_id" uuid,
	"linked_by_user_id" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_installs" ADD COLUMN "approved_permissions" jsonb;--> statement-breakpoint
ALTER TABLE "store_installs" ADD COLUMN "token_secret_id" uuid;--> statement-breakpoint
ALTER TABLE "nextgent_business_links" ADD CONSTRAINT "nextgent_business_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nextgent_business_links" ADD CONSTRAINT "nextgent_business_links_business_token_secret_id_company_secrets_id_fk" FOREIGN KEY ("business_token_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nextgent_business_links_entity_slug_uq" ON "nextgent_business_links" USING btree ("entity_slug");