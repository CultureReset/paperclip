-- Existing source: sql/business_mcp_tokens.sql
-- ============================================================
-- business_mcp_tokens — the keys an AI assistant connects with
-- ============================================================
--
-- One row per MCP client a business has authorised. routes/mcp.js reads this
-- to decide which business a request acts as, and whether it may write.
--
-- The token itself is never stored. Only sha256(token) is, so a leak of this
-- table does not hand anybody a working key — and a lost token is replaced,
-- not recovered. token_hint is the last six characters, purely so a dashboard
-- can show which row is which.
--
-- Safe to re-run.

create table if not exists public.business_mcp_tokens (
    id           uuid primary key default gen_random_uuid(),
    entity_slug  text        not null,
    label        text        not null default 'AI assistant',
    token_hash   text        not null unique,
    token_hint   text        not null default '',
    scope        text        not null default 'read',
    created_by   uuid,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at   timestamptz,

    -- Read or write, nothing else. A typo in the API would otherwise become a
    -- scope nobody checks, which reads as "not write" and fails open on reads.
    constraint business_mcp_tokens_scope_check check (scope in ('read', 'write'))
);

-- Every sign-in is a lookup by hash, so this is the index that matters. The
-- unique constraint above already provides it; named here for clarity.
create index if not exists business_mcp_tokens_slug_idx
    on public.business_mcp_tokens (entity_slug);

-- Only gcr-api-clean reads this table, and it holds the service key, which
-- bypasses RLS. Enabling RLS with no policy therefore changes nothing for the
-- API and closes the table to anon and authenticated entirely — which is the
-- point: a browser must never be able to list credential rows, even hashed.
alter table public.business_mcp_tokens enable row level security;

revoke all on public.business_mcp_tokens from anon, authenticated;

comment on table public.business_mcp_tokens is
    'MCP client credentials, one per AI assistant a business has authorised. Hashes only — see routes/mcp.js.';

-- Existing source: sql/ghost_mcp_tokens.sql
-- ============================================================
-- ghost_mcp_tokens — credentials for an agent to reach one enrolled Ghost
-- ============================================================
-- Tokens are scoped to one node, not just a business. Only SHA-256 hashes are
-- stored; raw tokens are returned once by POST /api/nodes/:id/mcp-token.
-- The API service role is the only reader/writer.

create table if not exists public.ghost_mcp_tokens (
    id           uuid primary key default gen_random_uuid(),
    node_id      uuid        not null references public.ghost_nodes (id) on delete cascade,
    entity_slug  text        not null,
    label        text        not null default 'Paperclip',
    token_hash   text        not null unique,
    token_hint   text        not null default '',
    created_by   uuid,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
);

-- The relay uses a nullable idempotency key for at-most-once action submission.
-- Existing dashboard callers may leave it null; Paperclip action calls must set it.
alter table public.ghost_node_requests
    add column if not exists idempotency_key text;

create unique index if not exists ghost_node_requests_node_idempotency_idx
    on public.ghost_node_requests (node_id, idempotency_key)
    where idempotency_key is not null;

create index if not exists ghost_mcp_tokens_node_idx
    on public.ghost_mcp_tokens (node_id);

alter table public.ghost_mcp_tokens enable row level security;
revoke all on table public.ghost_mcp_tokens from public, anon, authenticated;
grant all on public.ghost_mcp_tokens to service_role;

notify pgrst, 'reload schema';

comment on table public.ghost_mcp_tokens is
    'Hashed MCP credentials scoped to one Ghost node. Revoke by node/token id; revoking the Ghost also disables its agent credentials.';

-- Existing source: sql/nextgent_link.sql
-- ============================================================
-- NEXT GENT — the business link (CONTRACT §1, §4, §6)
-- ============================================================
--
-- One Paperclip company is one business. company_links is the only place that
-- says which: middleware/ownerAuth.js resolves a Paperclip token's company_id
-- through it, exactly as it resolves a Supabase session through entity_owners.
-- The slug is never taken from the request.
--
-- Also here, because they are part of the same step:
--
--   platform_admins.paperclip_user_id   an instance admin is honoured only if
--                                       their Paperclip user id is listed.
--   business_mcp_tokens.permissions     resource:action list. NULL keeps the
--                                       legacy behaviour of `scope`.
--   business_mcp_tokens.install_id      the store install a token belongs to.
--   business_mcp_tokens.company_id      the Paperclip company it was issued to.
--   business_claims.paperclip_*         who asked, so an admin approval of a
--                                       review claim can create the link.
--
-- Needs sql/business_mcp_tokens.sql and sql/business_claims_entity_slug.sql
-- first (see sql/ORDER.md). Additive only. Safe to re-run.

create table if not exists public.company_links (
    company_id  text primary key,
    entity_slug text unique not null,
    linked_at   timestamptz default now(),
    linked_by   text
);

alter table public.company_links enable row level security;
revoke all on public.company_links from anon, authenticated;

comment on table public.company_links is
    'Paperclip company -> entity_slug, one row per linked business. Written only by gcr-api-clean (routes/nextgent.js, routes/claims.js, admin claim approval).';

-- Instance admins, by their Paperclip user id. Nullable: existing rows are
-- Supabase users and keep working through the Supabase path.
alter table public.platform_admins
    add column if not exists paperclip_user_id text;

create unique index if not exists platform_admins_paperclip_user_idx
    on public.platform_admins (paperclip_user_id)
    where paperclip_user_id is not null;

-- Business token permissions (CONTRACT §6).
alter table public.business_mcp_tokens
    add column if not exists permissions text[];
alter table public.business_mcp_tokens
    add column if not exists install_id text;
alter table public.business_mcp_tokens
    add column if not exists company_id text;

create index if not exists business_mcp_tokens_install_idx
    on public.business_mcp_tokens (install_id)
    where install_id is not null;
create index if not exists business_mcp_tokens_company_idx
    on public.business_mcp_tokens (company_id)
    where company_id is not null;

comment on column public.business_mcp_tokens.permissions is
    'resource:action list (business, menu, availability, bookings, events, reviews, transactions, messages x read, write, send). NULL = legacy, governed by scope.';

-- Who filed a claim from Paperclip, so approving it can link the company.
alter table public.business_claims
    add column if not exists paperclip_company_id text;
alter table public.business_claims
    add column if not exists paperclip_user_id text;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_installs.sql
-- ============================================================
-- NEXT GENT — store installs as gcr-api-clean sees them (CONTRACT §4)
-- ============================================================
--
-- Paperclip holds the catalog and the install record. gcr-api-clean keeps only
-- what it needs to enforce and bill an install:
--
--   install_id           Paperclip's id, the key for DELETE.
--   permissions          what the owner approved (also on the token row).
--   routine_webhook_*    for automation installs: where the "give to agent"
--                        step posts. The secret is stored encrypted
--                        (AES-256-GCM, key derived from NEXTGENT_SERVICE_SECRET).
--   status               active | removed. Part 2's automation engine reads it.
--
-- Additive only. Safe to re-run.

create table if not exists public.nextgent_installs (
    install_id                text primary key,
    company_id                text not null,
    entity_slug               text not null,
    item_key                  text not null,
    kind                      text not null,
    version                   text,
    permissions               text[] not null default '{}',
    routine_webhook_url       text,
    routine_webhook_secret    text,
    status                    text not null default 'active',
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    removed_at                timestamptz,

    constraint nextgent_installs_kind_check   check (kind in ('agent', 'app', 'automation')),
    constraint nextgent_installs_status_check check (status in ('active', 'removed'))
);

create index if not exists nextgent_installs_company_idx on public.nextgent_installs (company_id);
create index if not exists nextgent_installs_slug_idx    on public.nextgent_installs (entity_slug);

alter table public.nextgent_installs enable row level security;
revoke all on public.nextgent_installs from anon, authenticated;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_claims.sql
-- ============================================================
-- NEXT GENT — claim codes (plan §5, "Claiming a listed business")
-- ============================================================
--
-- A code sent to the listing's own phone, by text or by an automated call when
-- the number cannot take texts. Only an HMAC of the code is stored. Attempts
-- are counted so a six-digit code cannot be walked.
--
-- The admin-review fallback does not use this table: it files a row in the
-- existing business_claims (see sql/nextgent_link.sql for its new columns).
--
-- Additive only. Safe to re-run.

create table if not exists public.claim_codes (
    id                 uuid primary key default gen_random_uuid(),
    company_id         text not null,
    paperclip_user_id  text,
    entity_slug        text not null,
    phone              text not null,
    channel            text not null,
    code_hash          text not null,
    attempts           integer not null default 0,
    expires_at         timestamptz not null,
    verified_at        timestamptz,
    created_at         timestamptz not null default now(),

    constraint claim_codes_channel_check check (channel in ('sms', 'voice'))
);

create index if not exists claim_codes_company_idx on public.claim_codes (company_id, created_at desc);
create index if not exists claim_codes_slug_idx    on public.claim_codes (entity_slug);

alter table public.claim_codes enable row level security;
revoke all on public.claim_codes from anon, authenticated;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_notify.sql
-- ============================================================
-- NEXT GENT — owner notifications (plan §6, step 4)
-- ============================================================
--
-- owner_notify_settings   where a business's owner wants to hear about the
--                         review queue, unknown senders, approvals and failed
--                         actions. Without a row, lib/notify.js falls back to
--                         the listing's own email and phone.
-- owner_notifications     one row per notification sent (or skipped, with the
--                         reason), so a quiet notifier is visible.
--
-- Additive only. Safe to re-run.

create table if not exists public.owner_notify_settings (
    entity_slug  text primary key,
    email        text,
    phone        text,
    email_on     boolean not null default true,
    sms_on       boolean not null default true,
    muted_kinds  text[] not null default '{}',
    updated_at   timestamptz not null default now()
);

create table if not exists public.owner_notifications (
    id           uuid primary key default gen_random_uuid(),
    entity_slug  text not null,
    kind         text not null,
    ref          text,
    title        text not null,
    channels     jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

create index if not exists owner_notifications_slug_idx
    on public.owner_notifications (entity_slug, created_at desc);
create index if not exists owner_notifications_ref_idx
    on public.owner_notifications (entity_slug, kind, ref)
    where ref is not null;

alter table public.owner_notify_settings enable row level security;
alter table public.owner_notifications   enable row level security;
revoke all on public.owner_notify_settings from anon, authenticated;
revoke all on public.owner_notifications   from anon, authenticated;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_nodes.sql
-- ============================================================
-- NEXT GENT — computers: QR pairing, remote view, receipts (plan §11)
-- ============================================================
--
-- node_pairings          the TV sign-in (OAuth device flow): the computer's
--                        device code and the short code it shows, both as
--                        hashes; the owner approves the short code for their
--                        business; the computer collects its node token once
--                        (held sealed until then, erased after).
-- node_remote_sessions   short-lived links to view a computer's screen.
-- ghost_node_requests    + paperclip_task_id: the Paperclip task an
--                        instruction belongs to (plan §11 "one path to the
--                        computer"); + receipt_posted_at / receipt_error:
--                        whether the result went back to Paperclip as a
--                        receipt (POST /api/nextgent/receipts).
--
-- Needs sql/ghost_nodes.sql (and ghost_mcp_tokens.sql). Additive only. Safe
-- to re-run.

create table if not exists public.node_pairings (
    id                uuid primary key default gen_random_uuid(),
    device_code_hash  text not null unique,
    user_code_hash    text not null,
    name              text,
    status            text not null default 'pending',
    entity_slug       text,
    node_id           uuid,
    token_sealed      text,
    expires_at        timestamptz not null,
    approved_at       timestamptz,
    approved_by       text,
    collected_at      timestamptz,
    created_at        timestamptz not null default now(),

    constraint node_pairings_status_check check (status in ('pending', 'approved', 'collected'))
);

create index if not exists node_pairings_user_code_idx on public.node_pairings (user_code_hash) where status = 'pending';

create table if not exists public.node_remote_sessions (
    id           uuid primary key default gen_random_uuid(),
    node_id      uuid not null,
    entity_slug  text not null,
    token_hash   text not null unique,
    expires_at   timestamptz not null,
    revoked_at   timestamptz,
    created_by   text,
    created_at   timestamptz not null default now()
);

alter table public.ghost_node_requests add column if not exists paperclip_task_id text;
alter table public.ghost_node_requests add column if not exists receipt_posted_at timestamptz;
alter table public.ghost_node_requests add column if not exists receipt_error     text;

alter table public.node_pairings        enable row level security;
alter table public.node_remote_sessions enable row level security;
revoke all on public.node_pairings        from anon, authenticated;
revoke all on public.node_remote_sessions from anon, authenticated;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_nodes_registry.sql
-- ============================================================
-- NEXT GENT — computers: what the registry was last told (DECISIONS #73)
-- ============================================================
--
-- ghost_nodes.registry_state      the status last pushed to Paperclip's device
--                                 registry: { version, capabilities, phones }
--                                 (lib/deviceSync.js), so the next heartbeat
--                                 knows whether anything changed
-- ghost_nodes.registry_synced_at  when it was pushed, for the throttled
--                                 last-seen push (DEVICE_STATUS_PUSH_SECONDS)
--
-- Needs sql/ghost_nodes.sql. Additive only. Safe to re-run. Until applied
-- nothing is pushed and heartbeats are unaffected.

alter table public.ghost_nodes add column if not exists registry_state     jsonb;
alter table public.ghost_nodes add column if not exists registry_synced_at timestamptz;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_apps.sql
-- ============================================================
-- NEXT GENT — installed apps: app-owned records
-- ============================================================
--
-- CONTRACT §14. Paperclip is the authority for what is installed, at which
-- version, enabled and entitled. gcr-api-clean keeps a projection of each
-- installed app so public pages and the app's own screens render without
-- calling Paperclip per visit. That projection is an entity_modules row
-- (sql/nextgent_entity_modules.sql, Step 3 contract §B). This file keeps:
--
--   app_records              the records an app keeps for itself (its
--                            manifest's data.tables), scoped by install and
--                            business; one table for every app, no database
--                            per app. `data` holds the declared columns.
--
-- Written and read only through routes/nextgent.js and routes/app-data.js
-- (service key). It carries entity_slug and is held back from the generic
-- business sections by lib/businessTables.js PLATFORM_TABLES / app_records.
--
-- Needs nextgent_installs.sql. Additive only. Safe to re-run.

-- superseded by nextgent_entity_modules.sql
--
-- business_app_instances was the first home of the projection. Nothing reads
-- or writes it any more (lib/appInstances.js is on entity_modules); where it
-- was applied it stays as it is — this repo drops nothing (npm run check:sql).
-- Its DDL, for the record:
--
--   create table if not exists public.business_app_instances (
--       install_id      text primary key references public.nextgent_installs (install_id),
--       entity_slug     text not null,
--       company_id      text not null,
--       app_key         text not null,
--       version         text,
--       enabled         boolean not null default true,
--       public_enabled  boolean not null default true,
--       render_mode     text not null default 'inline',
--       public_label    text,
--       config          jsonb not null default '{}'::jsonb,
--       position        integer,
--       manifest        jsonb,
--       created_at      timestamptz not null default now(),
--       updated_at      timestamptz not null default now(),
--       constraint business_app_instances_render_mode_check check (render_mode in ('inline', 'button', 'page'))
--   );
--   create index if not exists business_app_instances_slug_idx on public.business_app_instances (entity_slug, position);
--   alter table public.business_app_instances enable row level security;
--   revoke all on public.business_app_instances from anon, authenticated;

create table if not exists public.app_records (
    id          uuid primary key default gen_random_uuid(),
    install_id  text not null references public.nextgent_installs (install_id),
    entity_slug text not null,
    app_table   text not null,
    data        jsonb not null default '{}'::jsonb,
    source      text not null default 'owner',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint app_records_source_check check (source in ('owner', 'visitor'))
);

create index if not exists app_records_install_table_idx on public.app_records (install_id, app_table, created_at desc);
create index if not exists app_records_slug_idx on public.app_records (entity_slug);

alter table public.app_records enable row level security;
revoke all on public.app_records from anon, authenticated;

notify pgrst, 'reload schema';

-- Existing source: sql/nextgent_entity_modules.sql
-- ============================================================
-- NEXT GENT — installed apps live in entity_modules (Step 3 contract, §B)
-- ============================================================
--
-- Paperclip is the authority for what is installed, at which version and
-- whether it is enabled. gcr-api-clean keeps one entity_modules row per app
-- install so the public page and the app's own screens render without calling
-- Paperclip per visit. entity_modules is a pre-existing live table (no DDL
-- here); these columns are added to it:
--
--   managed_by    'paperclip' for Paperclip's rows; null for the owner's and
--                 the legacy dashboard's (routes/platform.js never touches a
--                 paperclip row)
--   install_id    Paperclip store_installs.id — one row per install
--   company_id    the Paperclip company
--   version       the installed version
--   render_mode   how the public page draws it: inline | button | page | action
--   public_label  the owner's label for it on the public page
--   updated_at
--
-- The rest of the install is in the columns the table already has:
--   module_key = the app key, enabled, sort_order = position,
--   settings.manifest = the engine manifest (Paperclip's payload.app),
--   settings.config = the app's settings (secrets sealed by lib/secretBox.js),
--   settings.showOnPublic = the one public flag.
--
-- Written by lib/appInstances.js (routes/nextgent.js, routes/owner.js); read by
-- routes/app-data.js, routes/gcr.js and routes/platform.js. Supersedes
-- business_app_instances (sql/nextgent_apps.sql, which keeps app_records).
--
-- Additive only. Safe to re-run.

alter table public.entity_modules
  add column if not exists managed_by   text,
  add column if not exists install_id   text unique,
  add column if not exists company_id   text,
  add column if not exists version      text,
  add column if not exists render_mode  text check (render_mode in ('inline', 'button', 'page', 'action')) default 'inline',
  add column if not exists public_label text,
  add column if not exists updated_at   timestamptz default now();

create index if not exists entity_modules_install_id_idx on public.entity_modules (install_id);

notify pgrst, 'reload schema';

grant all on public.business_mcp_tokens, public.ghost_mcp_tokens, public.company_links, public.nextgent_installs, public.claim_codes, public.owner_notify_settings, public.owner_notifications, public.node_pairings, public.node_remote_sessions, public.app_records to service_role;

