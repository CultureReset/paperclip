-- Source: nextgent_phone.sql
-- ============================================================
-- NEXT GENT — phone: verification codes (more below as the
-- Phone Agent pieces land)
-- ============================================================
--
-- phone_verification_codes   one-time codes texted through lib/telephony
--                            (lib/phoneVerification.js). Only an HMAC of the
--                            code is stored; asking again consumes the last.
--
-- Additive only. Safe to re-run.

create table if not exists public.phone_verification_codes (
    id           uuid primary key default gen_random_uuid(),
    phone        text not null,
    purpose      text not null,
    code_hash    text not null,
    expires_at   timestamptz not null,
    attempts     integer not null default 0,
    consumed_at  timestamptz,
    created_at   timestamptz not null default now()
);

create index if not exists phone_verification_codes_live_idx
    on public.phone_verification_codes (phone, purpose, created_at desc)
    where consumed_at is null;

alter table public.phone_verification_codes enable row level security;
revoke all on public.phone_verification_codes from anon, authenticated;

-- business_phone_numbers   a number bought for a business (a Phone Agent
--                          install). registration_status is the texting
--                          registration (US A2P 10DLC), an outside process:
--                          not_started | pending | approved | rejected. It is
--                          set by whoever handles the filing, never assumed;
--                          a business texts from its number only once it is
--                          approved (lib/messages.js).

create table if not exists public.business_phone_numbers (
    id                    uuid primary key default gen_random_uuid(),
    entity_slug           text not null,
    company_id            text,
    install_id            text,
    phone_number          text not null unique,
    provider              text not null,
    provider_ref          text,
    purpose               text not null default 'phone_agent',
    status                text not null default 'active',
    registration_status   text not null default 'not_started',
    registration_ref      text,
    registration_note     text,
    registration_updated_at timestamptz,
    charged               boolean not null default false,
    created_at            timestamptz not null default now(),
    released_at           timestamptz,

    constraint business_phone_numbers_status_check check (status in ('active', 'released', 'failed')),
    constraint business_phone_numbers_registration_check
        check (registration_status in ('not_started', 'pending', 'approved', 'rejected'))
);

create index if not exists business_phone_numbers_slug_idx    on public.business_phone_numbers (entity_slug);
create index if not exists business_phone_numbers_install_idx on public.business_phone_numbers (install_id);

alter table public.business_phone_numbers enable row level security;
revoke all on public.business_phone_numbers from anon, authenticated;

notify pgrst, 'reload schema';

-- forwarding_codes   how an owner forwards their own line to the Phone
--                    Agent number, per network type. {e164} and {national}
--                    are filled with the number. These are the standard
--                    network codes (GSM supplementary-service codes, and the
--                    *72 family many North American carriers use); a carrier
--                    with its own codes is another row.
create table if not exists public.forwarding_codes (
    key                text primary key,
    label              text not null,
    network            text,
    when_forwarded     text,
    enable_template    text not null,
    disable_template   text,
    note               text,
    sort_order         integer not null default 100
);

insert into public.forwarding_codes (key, label, network, when_forwarded, enable_template, disable_template, sort_order) values
    ('gsm-unanswered',   'Forward calls you do not answer',     'gsm',  'no_answer',   '**61*{e164}#', '##61#', 10),
    ('gsm-busy',         'Forward calls when you are busy',      'gsm',  'busy',        '**67*{e164}#', '##67#', 20),
    ('gsm-unreachable',  'Forward calls when your phone is off', 'gsm',  'unreachable', '**62*{e164}#', '##62#', 30),
    ('gsm-all',          'Forward every call',                   'gsm',  'always',      '**21*{e164}#', '##21#', 40),
    ('star72-all',       'Forward every call',                   'star', 'always',      '*72{national}', '*73',  50),
    ('star71-unanswered','Forward calls you do not answer',      'star', 'no_answer',   '*71{national}', '*73',  60)
on conflict (key) do nothing;

-- nextgent_installs: what the install payload said about itself, so the live
-- handlers (routes/telephony-live.js) know the agent's instructions.
alter table public.nextgent_installs add column if not exists capabilities text[] not null default '{}';
alter table public.nextgent_installs add column if not exists instructions text;

alter table public.forwarding_codes enable row level security;
revoke all on public.forwarding_codes from anon, authenticated;

notify pgrst, 'reload schema';

-- live_conversations   one call or text conversation answered live by the
--                      concierge or a Phone Agent (routes/telephony-live.js):
--                      who called whom, the transcript, the tool calls, the
--                      voice loop's state. This is the only copy: Paperclip is
--                      posted a reference to the row when it ends (its id,
--                      channel, mode, times, turn count and outcome — POST
--                      /api/nextgent/conversations), never the transcript or
--                      a customer number. recorded_at / record_error say
--                      whether that reference was taken. A business reads its
--                      own rows at GET /api/owner/conversations (routes/owner.js).
create table if not exists public.live_conversations (
    id                uuid primary key default gen_random_uuid(),
    channel           text not null,
    mode              text not null,
    entity_slug       text,
    company_id        text,
    from_number       text,
    to_number         text,
    provider_ref      text unique,
    transcript        jsonb not null default '[]'::jsonb,
    tool_calls        jsonb not null default '[]'::jsonb,
    status            text not null default 'open',
    state             text,
    transcribing      boolean not null default false,
    outcome           text,
    started_at        timestamptz not null default now(),
    last_activity_at  timestamptz not null default now(),
    ended_at          timestamptz,
    recorded_at       timestamptz,
    record_error      text,

    constraint live_conversations_channel_check check (channel in ('voice', 'sms')),
    constraint live_conversations_status_check  check (status in ('open', 'closed'))
);

create index if not exists live_conversations_open_sms_idx
    on public.live_conversations (from_number, to_number, last_activity_at desc) where status = 'open';

-- nextgent_ai_keys   the LiteLLM key a company's live calls run on, made once
--                    with the master key and kept sealed (lib/litellm.js).
create table if not exists public.nextgent_ai_keys (
    company_id  text primary key,
    key_sealed  text not null,
    created_at  timestamptz not null default now()
);

alter table public.live_conversations enable row level security;
alter table public.nextgent_ai_keys   enable row level security;
revoke all on public.live_conversations from anon, authenticated;
revoke all on public.nextgent_ai_keys   from anon, authenticated;

notify pgrst, 'reload schema';


-- Source: nextgent_messages.sql
-- ============================================================
-- NEXT GENT — messages a business sends and receives (CONTRACT §6, plan §8)
-- ============================================================
--
-- message_threads     one conversation per business, channel and customer.
--                     mode 'agent' lets agents and automations answer;
--                     'owner' means the owner took it over and nothing
--                     automatic sends into it until they hand it back.
--                     owner_read_at: what the owner has seen (unread counts).
-- business_messages   every message in and out: owner, agent, automation,
--                     customer. status: draft | pending_approval | queued |
--                     sent | failed | blocked | received. A blocked message
--                     says why (status_reason), e.g. no consent on file.
-- message_consent     a customer's yes (or later no) to texts from one
--                     business. Texts go only to a phone with consent here
--                     or an sms_consent opt-in (booking_opt_ins), and never
--                     to one in sms_opt_outs.
--
-- All three carry entity_slug but are platform rows, written through
-- lib/messages.js (lib/businessTables.js PLATFORM_TABLES holds them back from
-- the generic section writer).
--
-- Additive only. Safe to re-run.

create table if not exists public.message_threads (
    id                uuid primary key default gen_random_uuid(),
    entity_slug       text not null,
    channel           text not null,
    customer_address  text not null,
    mode              text not null default 'agent',
    taken_over_at     timestamptz,
    taken_over_by     text,
    last_message_at   timestamptz,
    owner_read_at     timestamptz,
    created_at        timestamptz not null default now(),

    constraint message_threads_channel_check check (channel in ('email', 'sms', 'voice')),
    constraint message_threads_mode_check    check (mode in ('agent', 'owner')),
    unique (entity_slug, channel, customer_address)
);

create table if not exists public.business_messages (
    id                   uuid primary key default gen_random_uuid(),
    entity_slug          text not null,
    thread_id            uuid,
    channel              text not null,
    direction            text not null,
    customer_address     text not null,
    business_address     text,
    subject              text,
    body                 text not null,
    status               text not null,
    status_reason        text,
    author               text not null,
    install_id           text,
    automation_run_id    text,
    provider_message_id  text,
    edited_at            timestamptz,
    sent_at              timestamptz,
    created_at           timestamptz not null default now(),

    constraint business_messages_channel_check   check (channel in ('email', 'sms', 'voice')),
    constraint business_messages_direction_check check (direction in ('in', 'out')),
    constraint business_messages_status_check    check (status in ('draft', 'pending_approval', 'queued', 'sent', 'failed', 'blocked', 'received'))
);

create index if not exists business_messages_thread_idx on public.business_messages (thread_id, created_at);
create index if not exists business_messages_slug_idx   on public.business_messages (entity_slug, created_at desc);
create index if not exists message_threads_slug_idx     on public.message_threads (entity_slug, last_message_at desc);

create table if not exists public.message_consent (
    id            uuid primary key default gen_random_uuid(),
    entity_slug   text not null,
    channel       text not null default 'sms',
    phone         text not null,
    status        text not null default 'granted',
    source        text,
    consent_text  text,
    recorded_by   text,
    recorded_at   timestamptz not null default now(),

    constraint message_consent_status_check check (status in ('granted', 'revoked')),
    unique (entity_slug, channel, phone)
);

alter table public.message_threads   enable row level security;
alter table public.business_messages enable row level security;
alter table public.message_consent   enable row level security;
revoke all on public.message_threads   from anon, authenticated;
revoke all on public.business_messages from anon, authenticated;
revoke all on public.message_consent   from anon, authenticated;

notify pgrst, 'reload schema';


-- Source: nextgent_scheduler_state.sql
-- ============================================================
-- NEXT GENT — scheduler state: what the scheduled checks remember
-- ============================================================
--
-- scheduler_state   one row per key. The first user is the booking
--                   completion check (lib/businessEvents.js completeBookings):
--                   key booking_complete_watermark holds the time the check
--                   first ran. Only bookings that end after that moment are
--                   ever marked completed, so enabling the check does not
--                   mark a business's whole history completed and fire
--                   booking.completed (review requests) for all of it. The
--                   value is written once, by the first run; it is never a
--                   date typed into code.
--
-- Until this table exists the completion check does nothing and says so in
-- its result, rather than guessing a starting point.
--
-- Additive only. Safe to re-run.

create table if not exists public.scheduler_state (
    key         text primary key,
    value       text,
    updated_at  timestamptz not null default now()
);

alter table public.scheduler_state enable row level security;
revoke all on public.scheduler_state from anon, authenticated;

notify pgrst, 'reload schema';


-- Source: nextgent_business_contacts.sql
-- ============================================================
-- NEXT GENT — the people a business hears from and keeps (DECISIONS #44, #49)
-- ============================================================
--
-- Two business facts that apps used to keep as their own records
-- (enquiry forms in app_records; a `leads` dataKey in the generic section
-- store), now one table each, keyed by the business:
--
--   entity_leads       an enquiry: who asked, how to reach them, what they
--                      said, where it came from (`source`: the app key, a
--                      form, an import) and where it stands (`status`).
--                      Contract `leads.items` (lib/dataContracts.js).
--   entity_customers   the business's own customer record (customer_id is
--                      per business, DECISIONS #49; platform-wide identity is
--                      deferred and the 2026-07-19 canonical-gaps migration is
--                      NOT applied). One row per (business, phone) when a phone
--                      is known. Contract `customers.items`.
--
-- Both carry the provenance columns of SPEC §6.6, so a re-sync from an outside
-- system updates the row it made rather than duplicating it, and never
-- overwrites what the owner corrected (owner_override):
--
--   source_type         where the row came from (an app key, 'import', 'owner', 'sync:<provider>' …)
--   source_id           that source's own id for the record (an install id, a file)
--   external_record_id  the record's id in the outside system
--   source_updated_at   when the outside system last changed it
--   last_synced_at      when it was last compared with the outside system
--   created_by / updated_by
--   owner_override      true once the owner edited it by hand: a sync must not overwrite
--
-- The platform's own sales leads (`leads`, `business_leads`) are unrelated and
-- untouched. These two carry entity_slug, so they are business sections; the
-- raw table names are held private by lib/businessTables.js (a lead is a
-- record of a person) and are reached through their contracts, which the
-- registry opens to the permissioned door only — never the public one.
--
-- Additive only. Safe to re-run.

create table if not exists public.entity_leads (
    id                  uuid primary key default gen_random_uuid(),
    entity_slug         text not null,
    name                text,
    email               text,
    phone               text,
    message             text,
    source              text,
    status              text not null default 'new',
    source_type         text,
    source_id           text,
    external_record_id  text,
    source_updated_at   timestamptz,
    last_synced_at      timestamptz,
    created_by          text,
    updated_by          text,
    owner_override      boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists entity_leads_slug_idx on public.entity_leads (entity_slug, created_at desc);
create index if not exists entity_leads_source_idx on public.entity_leads (entity_slug, source_type, external_record_id);

create table if not exists public.entity_customers (
    id                  uuid primary key default gen_random_uuid(),
    entity_slug         text not null,
    name                text,
    phone               text,
    email               text,
    notes               text,
    source_type         text,
    source_id           text,
    external_record_id  text,
    source_updated_at   timestamptz,
    last_synced_at      timestamptz,
    created_by          text,
    updated_by          text,
    owner_override      boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists entity_customers_slug_idx on public.entity_customers (entity_slug, created_at desc);
create index if not exists entity_customers_source_idx on public.entity_customers (entity_slug, source_type, external_record_id);
-- One customer per phone per business, when a phone is known.
create unique index if not exists entity_customers_slug_phone_key on public.entity_customers (entity_slug, phone) where phone is not null;

alter table public.entity_leads     enable row level security;
alter table public.entity_customers enable row level security;
revoke all on public.entity_leads     from anon, authenticated;
revoke all on public.entity_customers from anon, authenticated;

notify pgrst, 'reload schema';


-- Source: nextgent_event_outbox.sql
-- ============================================================
-- NEXT GENT — the business event outbox (DECISIONS #87)
-- ============================================================
--
-- business_event_outbox   one row per business event emitted
--                         (lib/businessEvents.js emit) for a business that is
--                         linked to a Paperclip company. lib/eventOutbox.js
--                         posts each row, signed, as
--                         POST /api/nextgent/events
--                         { companyId, event, eventId, occurredAt, ref }
--                         and records the outcome here. A failed post is
--                         retried (next_attempt_at, doubling) from the
--                         scheduler and the cron until it goes or the row is
--                         parked as dead with its last error.
--
--   id              the event id (uuid): Paperclip's idempotency key
--   ref             ids and a non-PII summary only (booking_id, date,
--                   start_time, party, status, source, app, table, record_id,
--                   …). Never a customer's name, email or phone (#37):
--                   lib/eventOutbox.js refFor builds it from an allow-list.
--
-- Rows are written only while EVENTS_TO_PAPERCLIP is true (off until Phase
-- C of the Step 7 change list). Until this table exists the module logs the
-- missing table and the local fan-out runs as before.
--
-- Additive only. Safe to re-run.

create table if not exists public.business_event_outbox (
    id               text primary key,
    entity_slug      text not null,
    company_id       text not null,
    event            text not null,
    occurred_at      timestamptz not null,
    ref              jsonb not null default '{}'::jsonb,
    status           text not null default 'pending' check (status in ('pending', 'sent', 'dead')),
    attempts         integer not null default 0,
    last_error       text,
    next_attempt_at  timestamptz not null default now(),
    sent_at          timestamptz,
    created_at       timestamptz not null default now()
);

-- The drain reads pending rows that are due, oldest first.
create index if not exists business_event_outbox_due_idx
    on public.business_event_outbox (next_attempt_at)
    where status = 'pending';
create index if not exists business_event_outbox_slug_idx
    on public.business_event_outbox (entity_slug, occurred_at desc);
create index if not exists business_event_outbox_company_idx
    on public.business_event_outbox (company_id, occurred_at desc);

alter table public.business_event_outbox enable row level security;
revoke all on public.business_event_outbox from anon, authenticated;

comment on table public.business_event_outbox is
    'Business events on their way to Paperclip (POST /api/nextgent/events), ids and non-PII summary only. Written only by gcr-api-clean (lib/eventOutbox.js).';

notify pgrst, 'reload schema';


-- Source: nextgent_business_currency.sql
-- ============================================================
-- NEXT GENT — the business's currency is a business fact (DECISIONS #44)
-- ============================================================
--
-- QR Menu and Listings each kept a `config.currency` of their own, and the
-- owner app fell back to a build-time default. The currency a business prices
-- in is one fact about the business, so it lives on the business record and
-- every app reads it through the `business.currency` contract
-- (lib/dataContracts.js).
--
-- Nullable, with no default here: a null means "not set", and the API answers
-- with its DEFAULT_CURRENCY environment value (the same one
-- routes/email-webhook.js already uses) rather than this file deciding a
-- currency for every business. The owner sets it through PATCH
-- /api/owner/profile like any other editable column.
--
-- Additive only. Safe to re-run.

alter table public.entity
  add column if not exists currency text;

comment on column public.entity.currency is
  'ISO 4217 code the business prices in. Null = not set; the API falls back to DEFAULT_CURRENCY.';

notify pgrst, 'reload schema';


-- Source: nextgent_messages_app_channel.sql
-- ============================================================
-- NEXT GENT — an app's submission lands in the one Messages inbox (DECISIONS #48)
-- ============================================================
--
-- Every app-owned table a visitor may append to (manifest data.tables.<t>.public
-- = 'append') is a submission to the business: an enquiry, a song request, a
-- shout-out. routes/app-data.js records each one as an inbound business_messages
-- row on a message_threads thread, so it shows in Messages beside the texts
-- and emails — channel 'app', install_id = the install it came through, the
-- customer's email or phone as the address (else the record's first text).
--
-- The two channel checks only knew email | sms | voice. This widens each by
-- 'app'. Dropping a check constraint touches no rows and no columns; it is
-- re-added with the extra value in the same statement run. Which app a row came
-- from is read from install_id (lib/messages.js), so no column is added.
--
-- Needs nextgent_messages.sql. Additive only. Safe to re-run.

alter table public.message_threads
    drop constraint if exists message_threads_channel_check;
alter table public.message_threads
    add constraint message_threads_channel_check check (channel in ('email', 'sms', 'voice', 'app'));

alter table public.business_messages
    drop constraint if exists business_messages_channel_check;
alter table public.business_messages
    add constraint business_messages_channel_check check (channel in ('email', 'sms', 'voice', 'app'));

notify pgrst, 'reload schema';


-- Source: nextgent_menu_items_order.sql
-- ============================================================
-- NEXT GENT — menu items have an order and an availability (DECISIONS #65)
-- ============================================================
--
-- schema.sql's menu_items has neither column, yet routes/platform.js has been
-- writing is_available and the QR Menu app orders its items. This makes both
-- real columns:
--
--   sort_order     the owner's order within a section (null = unordered; the
--                  menu.items contract reads sort_order, then id)
--   is_available   false hides an item without deleting it (default true)
--
-- Additive only. Safe to re-run.

alter table public.menu_items
  add column if not exists sort_order   integer,
  add column if not exists is_available boolean not null default true;

create index if not exists menu_items_slug_order_idx on public.menu_items (entity_slug, sort_order, id);

notify pgrst, 'reload schema';


-- Source: nextgent_intake.sql
-- ============================================================
-- NEXT GENT — forwarded-email intake: confirmations, senders, payments
-- (plan §9 "How data comes in", build step 7)
-- ============================================================
--
-- forwarding_confirmation_rules   how to recognise a mail provider's
--                                 "confirm forwarding" email: who sends it,
--                                 and where the code and link are. Rows, so a
--                                 new provider is an insert, not a deploy.
--                                 Patterns are case-insensitive regexes; the
--                                 first capture group is the value.
-- forwarding_confirmations        a confirmation that arrived at a business's
--                                 forwarding address: the code and link the
--                                 owner needs in onboarding.
-- intake_known_senders            who forwards mail into a business. A sender
--                                 not here (or not approved) waits for review
--                                 and the owner is told; approving it
--                                 processes what was held.
-- email_parser_log.intake_state   processed | held (unknown sender) | review
-- email_parser_log.raw_html       the html part of a held email, so html-only
-- email_webhook_log.raw_html      mail can be read after approval
-- payments_detected              payments read from forwarded email
--                                 ('claimed' until matched) or from a signed
--                                 provider webhook ('verified').
--
-- Additive only. Safe to re-run.

create table if not exists public.forwarding_confirmation_rules (
    provider          text primary key,
    label             text not null,
    from_pattern      text not null,
    subject_pattern   text,
    code_pattern      text,
    link_pattern      text,
    mailbox_pattern   text,
    enabled           boolean not null default true,
    updated_at        timestamptz not null default now()
);

-- The two providers the plan names. Their senders and formats are the
-- providers' own; edit these rows when a provider changes its email.
insert into public.forwarding_confirmation_rules
    (provider, label, from_pattern, subject_pattern, code_pattern, link_pattern, mailbox_pattern)
values
    ('gmail', 'Gmail',
     'forwarding-noreply@google\.com',
     'forwarding confirmation',
     '(?:confirmation code|\(#)\s*:?\s*(\d{6,12})',
     '(https://mail(?:-settings)?\.google\.com/\S+)',
     '([^\s<>()]+@[^\s<>()]+) has requested to automatically forward'),
    ('outlook', 'Outlook',
     '@(?:[a-z0-9-]+\.)*(?:microsoft|outlook|live)\.com',
     '(?:verify|forward)',
     '(?:security code|verification code|code)\s*:?\s*(\d{4,10})',
     '(https://(?:[a-z0-9-]+\.)*(?:microsoft|live|outlook)\.com/\S+)',
     null)
on conflict (provider) do nothing;

create table if not exists public.forwarding_confirmations (
    id              uuid primary key default gen_random_uuid(),
    entity_slug     text not null,
    provider        text not null,
    code            text,
    link            text,
    mailbox         text,
    from_email      text,
    subject         text,
    received_at     timestamptz not null default now(),
    used_at         timestamptz
);

create index if not exists forwarding_confirmations_slug_idx
    on public.forwarding_confirmations (entity_slug, received_at desc);

create table if not exists public.intake_known_senders (
    id              uuid primary key default gen_random_uuid(),
    entity_slug     text not null,
    sender          text not null,
    status          text not null default 'pending',
    example_subject text,
    first_seen_at   timestamptz not null default now(),
    decided_at      timestamptz,
    decided_by      text,

    constraint intake_known_senders_status_check check (status in ('pending', 'approved', 'blocked')),
    unique (entity_slug, sender)
);

alter table public.email_parser_log add column if not exists intake_state text;

-- A held email must be readable later exactly as it would have been read on
-- arrival, so held rows keep the whole body: raw_text (the text part) and
-- raw_html (the html part, for html-only mail). Processed rows keep the
-- truncated text they always did.
alter table public.email_parser_log add column if not exists raw_html text;
alter table if exists public.email_webhook_log add column if not exists raw_html text;

-- Seed known senders from what has already worked: every sender whose
-- forwarded email a business has read into a booking before this table
-- existed is approved for that business, so applying this file does not
-- stop the forwards that were working. Derived from the parser's own log;
-- no sender is named here. Which senders are held is the owner's rule and
-- is not changed by this.
insert into public.intake_known_senders (entity_slug, sender, status, example_subject, first_seen_at, decided_at, decided_by)
select l.entity_slug,
       s.sender,
       'approved',
       min(l.subject),
       coalesce(min(l.created_at), now()),
       now(),
       'seed:email_parser_log'
from public.email_parser_log l
cross join lateral (
    select lower(trim(coalesce(substring(l.from_email from '<([^>]+)>'), l.from_email))) as sender
) s
where l.entity_slug is not null
  and l.parsed is true
  and l.event_date is not null
  and coalesce(l.manual, false) is false
  and coalesce(l.bulk, false) is false
  and s.sender like '%@%'
group by l.entity_slug, s.sender
on conflict (entity_slug, sender) do nothing;

create table if not exists public.payments_detected (
    id              uuid primary key default gen_random_uuid(),
    entity_slug     text not null,
    amount_cents    integer,
    currency        text,
    payer           text,
    source          text not null,
    status          text not null default 'claimed',
    reference       text,
    received_at     timestamptz not null default now(),
    details         jsonb not null default '{}'::jsonb,

    constraint payments_detected_status_check check (status in ('claimed', 'verified', 'refunded')),
    unique (entity_slug, source, reference)
);

create index if not exists payments_detected_slug_idx on public.payments_detected (entity_slug, received_at desc);

alter table public.forwarding_confirmation_rules enable row level security;
alter table public.forwarding_confirmations      enable row level security;
alter table public.intake_known_senders          enable row level security;
alter table public.payments_detected             enable row level security;
revoke all on public.forwarding_confirmation_rules from anon, authenticated;
revoke all on public.forwarding_confirmations      from anon, authenticated;
revoke all on public.intake_known_senders          from anon, authenticated;
revoke all on public.payments_detected             from anon, authenticated;

notify pgrst, 'reload schema';
