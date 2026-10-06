DO $$ BEGIN IF (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) IS DISTINCT FROM '732d8a8cfcc78810b6dfb1da0a3bf9ac5add2b8219e22d14c139633b66bdbe79' THEN RAISE EXCEPTION 'Platform baseline changed; inspect before applying'; END IF; END $$;

-- Existing source: 0285_fat_phalanx; SHA-256 f9838beebb81eace13c8ea8621dac22c912ed19e618d21247dc51a155d1ccb5e
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('f9838beebb81eace13c8ea8621dac22c912ed19e618d21247dc51a155d1ccb5e',1791112615247);

-- Existing source: 0286_nebulous_hobgoblin; SHA-256 f8022a8a0435c8a0ebd70c5a2c186784a0758b95a595ae8074ba100ddb272e86
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('f8022a8a0435c8a0ebd70c5a2c186784a0758b95a595ae8074ba100ddb272e86',1791113894641);

-- Existing source: 0287_careless_winter_soldier; SHA-256 06669f89a694b0b091578bf217c1ec48fcd9ce98087e5e983af1fc3dd5014084
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('06669f89a694b0b091578bf217c1ec48fcd9ce98087e5e983af1fc3dd5014084',1791114759839);

-- Existing source: 0288_chubby_doctor_doom; SHA-256 c47a405408334ed3366d0833d8e901abf235bbc60a625d3b3bf4efbb27a0af23
CREATE TABLE "store_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton_key" text DEFAULT 'default' NOT NULL,
	"core_menu" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_singleton_key_unique" UNIQUE("singleton_key")
);


INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('c47a405408334ed3366d0833d8e901abf235bbc60a625d3b3bf4efbb27a0af23',1791115257461);

-- Existing source: 0289_ambitious_kitty_pryde; SHA-256 0424a71430c84d0c59ba342239c525ed185299353e997238d921fff158bb9bf5
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('0424a71430c84d0c59ba342239c525ed185299353e997238d921fff158bb9bf5',1791142860634);

-- Existing source: 0290_outgoing_ronan; SHA-256 dde7db946e7619ac3dc20d0b62529ce47a9b83826f85f5b498b3aff7345a91fe
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('dde7db946e7619ac3dc20d0b62529ce47a9b83826f85f5b498b3aff7345a91fe',1791144467472);

-- Existing source: 0291_secret_omega_sentinel; SHA-256 1b1ef71e62ce3d9426e2db30ebcf2b4992d42236729746c8c42870e26dc86fd3
ALTER TABLE "nextgent_business_links" ADD COLUMN "business_kind" text;--> statement-breakpoint
ALTER TABLE "store_installs" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('1b1ef71e62ce3d9426e2db30ebcf2b4992d42236729746c8c42870e26dc86fd3',1791149542497);

-- Existing source: 0292_store_item_kinds_layout; SHA-256 d045fb5a9b848e4f660301ec9e21f2927034cdf87948cc4d2eb87bcf8b7ae9c1
ALTER TABLE "store_items" DROP CONSTRAINT "store_items_kind_check";--> statement-breakpoint
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_kind_check" CHECK ("store_items"."kind" IN ('plugin', 'pack', 'skill', 'automation', 'connector', 'agent', 'app', 'layout'));

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('d045fb5a9b848e4f660301ec9e21f2927034cdf87948cc4d2eb87bcf8b7ae9c1',1791157696153);

-- Existing source: 0293_nextgent_business_links_archive_business_facts; SHA-256 3310402a23dba92450599d479799cf4fa2c24a9b70863b3c3d7260bd0f440bd1
CREATE TABLE "nextgent_business_links_archive_0293" AS SELECT "company_id", "business_kind", "forwarding_address", now() AS "archived_at" FROM "nextgent_business_links";--> statement-breakpoint
ALTER TABLE "nextgent_business_links" DROP COLUMN "forwarding_address";--> statement-breakpoint
ALTER TABLE "nextgent_business_links" DROP COLUMN "business_kind";


INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('3310402a23dba92450599d479799cf4fa2c24a9b70863b3c3d7260bd0f440bd1',1791161278046);

-- Existing source: 0294_nextgent_devices; SHA-256 c6f93f89454bc6b0fbae5b1e5d69256d8fe53cd9ea3ada57079310f3c41e751f
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('c6f93f89454bc6b0fbae5b1e5d69256d8fe53cd9ea3ada57079310f3c41e751f',1791168481601);

-- Existing source: 0295_automation_runner_entitlement_notify; SHA-256 1e3d401b8105648394a8ade72f170168475aae97aaa6d52412ad88aec45d92ae
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

INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('1e3d401b8105648394a8ade72f170168475aae97aaa6d52412ad88aec45d92ae',1791168619812);

-- Keep platform extensions private on Supabase; server access only.

ALTER TABLE public."store_installs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_installs" FROM anon,authenticated;
GRANT ALL ON public."store_installs" TO service_role;

ALTER TABLE public."store_item_versions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_item_versions" FROM anon,authenticated;
GRANT ALL ON public."store_item_versions" TO service_role;

ALTER TABLE public."store_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_items" FROM anon,authenticated;
GRANT ALL ON public."store_items" TO service_role;

ALTER TABLE public."store_install_resources" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_install_resources" FROM anon,authenticated;
GRANT ALL ON public."store_install_resources" TO service_role;

ALTER TABLE public."store_settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_settings" FROM anon,authenticated;
GRANT ALL ON public."store_settings" TO service_role;

ALTER TABLE public."nextgent_business_links" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."nextgent_business_links" FROM anon,authenticated;
GRANT ALL ON public."nextgent_business_links" TO service_role;

ALTER TABLE public."store_deployments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_deployments" FROM anon,authenticated;
GRANT ALL ON public."store_deployments" TO service_role;

ALTER TABLE public."nextgent_business_links_archive_0293" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."nextgent_business_links_archive_0293" FROM anon,authenticated;
GRANT ALL ON public."nextgent_business_links_archive_0293" TO service_role;

ALTER TABLE public."nextgent_devices" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."nextgent_devices" FROM anon,authenticated;
GRANT ALL ON public."nextgent_devices" TO service_role;

ALTER TABLE public."routine_run_steps" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."routine_run_steps" FROM anon,authenticated;
GRANT ALL ON public."routine_run_steps" TO service_role;

ALTER TABLE public."routine_waits" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."routine_waits" FROM anon,authenticated;
GRANT ALL ON public."routine_waits" TO service_role;

ALTER TABLE public."company_plans" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."company_plans" FROM anon,authenticated;
GRANT ALL ON public."company_plans" TO service_role;

ALTER TABLE public."notification_log" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."notification_log" FROM anon,authenticated;
GRANT ALL ON public."notification_log" TO service_role;

ALTER TABLE public."notification_settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."notification_settings" FROM anon,authenticated;
GRANT ALL ON public."notification_settings" TO service_role;

ALTER TABLE public."store_grants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_grants" FROM anon,authenticated;
GRANT ALL ON public."store_grants" TO service_role;

ALTER TABLE public."store_plan_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_plan_items" FROM anon,authenticated;
GRANT ALL ON public."store_plan_items" TO service_role;

ALTER TABLE public."store_plans" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."store_plans" FROM anon,authenticated;
GRANT ALL ON public."store_plans" TO service_role;
