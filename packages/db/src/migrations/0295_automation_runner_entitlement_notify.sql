CREATE TABLE "routine_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_waits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"routine_revision_id" uuid,
	"step_index" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_plans" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_plans_status_check" CHECK ("company_plans"."status" IN ('active', 'trialing', 'paused', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"title" text NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"phone" text,
	"email_on" boolean DEFAULT true NOT NULL,
	"sms_on" boolean DEFAULT true NOT NULL,
	"muted_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routine_revisions" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "output" jsonb;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "routine_triggers" ADD COLUMN "event_name" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "mode" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "last_run_status" text;--> statement-breakpoint
ALTER TABLE "store_items" ADD COLUMN "access" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_run_steps" ADD CONSTRAINT "routine_run_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_run_steps" ADD CONSTRAINT "routine_run_steps_run_id_routine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."routine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_waits" ADD CONSTRAINT "routine_waits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_waits" ADD CONSTRAINT "routine_waits_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_waits" ADD CONSTRAINT "routine_waits_run_id_routine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."routine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_waits" ADD CONSTRAINT "routine_waits_routine_revision_id_routine_revisions_id_fk" FOREIGN KEY ("routine_revision_id") REFERENCES "public"."routine_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_plans" ADD CONSTRAINT "company_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_plans" ADD CONSTRAINT "company_plans_plan_id_store_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."store_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_grants" ADD CONSTRAINT "store_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_grants" ADD CONSTRAINT "store_grants_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_plan_items" ADD CONSTRAINT "store_plan_items_plan_id_store_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."store_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_plan_items" ADD CONSTRAINT "store_plan_items_item_id_store_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."store_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routine_run_steps_run_position_idx" ON "routine_run_steps" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "routine_run_steps_company_created_idx" ON "routine_run_steps" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "routine_waits_state_due_idx" ON "routine_waits" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "routine_waits_routine_idx" ON "routine_waits" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "routine_waits_run_idx" ON "routine_waits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "notification_log_company_created_idx" ON "notification_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_log_ref_idx" ON "notification_log" USING btree ("company_id","kind","ref");--> statement-breakpoint
CREATE INDEX "store_grants_company_idx" ON "store_grants" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_grants_live_uq" ON "store_grants" USING btree ("company_id","item_id") WHERE "store_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "store_plan_items_plan_item_uq" ON "store_plan_items" USING btree ("plan_id","item_id");--> statement-breakpoint
CREATE INDEX "store_plan_items_item_idx" ON "store_plan_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_plans_key_uq" ON "store_plans" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "store_plans_default_uq" ON "store_plans" USING btree ("is_default") WHERE "store_plans"."is_default" = true;--> statement-breakpoint
CREATE INDEX "routine_triggers_company_event_idx" ON "routine_triggers" USING btree ("company_id","event_name");--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_access_check" CHECK ("store_items"."access" IN ('free', 'plan', 'grant'));