-- Existing source: sql/nextgent_billing.sql
-- ============================================================
-- NEXT GENT — billing additions (plan §15 step 11)
-- ============================================================
--
-- Same one billing system (sql/billing.sql, lib/billing.js, lib/entitlements.js,
-- routes/stripe.js). Prices stay rows, never constants:
--
--   store_items.price_cents / price_interval / stripe_price_id
--       what an item costs when installed. interval: one_time | month | year.
--   billing_plan.stripe_price_id
--       the Stripe price behind a plan's monthly subscription.
--   billing_subscription.stripe_customer_id / stripe_subscription_id
--       the Stripe objects for a business.
--   billing_subscription.payment_failed_since
--       the non-payment clock. It runs the same grace period as usage limits
--       (lib/billing.js restrictionState); when it runs out the business is
--       paused, never deleted.
--   billing_item_charges
--       one row per priced install (store item or Phone Agent number), with
--       the Stripe subscription item / invoice item that bills it.
--   billing_usage_credits
--       AI spend per company per period, as reported from LiteLLM.
--
-- Needs sql/billing.sql and sql/store.sql first. Additive only. Safe to re-run.

alter table public.store_items add column if not exists price_cents     integer not null default 0;
alter table public.store_items add column if not exists price_interval  text;
alter table public.store_items add column if not exists stripe_price_id text;

alter table public.billing_plan add column if not exists stripe_price_id text;

alter table public.billing_subscription add column if not exists stripe_customer_id     text;
alter table public.billing_subscription add column if not exists stripe_subscription_id text;
alter table public.billing_subscription add column if not exists payment_failed_since   timestamptz;
alter table public.billing_subscription add column if not exists paused_at              timestamptz;

create table if not exists public.billing_item_charges (
    id                uuid primary key default gen_random_uuid(),
    entity_slug       text not null,
    company_id        text,
    install_id        text,
    item_key          text not null,
    price_cents       integer not null default 0,
    price_interval    text,
    stripe_ref        text,
    status            text not null default 'active',
    created_at        timestamptz not null default now(),
    removed_at        timestamptz,

    constraint billing_item_charges_status_check check (status in ('active', 'removed', 'failed'))
);

create index if not exists billing_item_charges_slug_idx    on public.billing_item_charges (entity_slug);
create index if not exists billing_item_charges_install_idx on public.billing_item_charges (install_id);

create table if not exists public.billing_usage_credits (
    id            uuid primary key default gen_random_uuid(),
    entity_slug   text not null,
    company_id    text not null,
    source        text not null,
    period_start  timestamptz not null,
    period_end    timestamptz not null,
    spend_usd     numeric(12,4) not null default 0,
    credits       bigint not null default 0,
    recorded_at   timestamptz not null default now(),

    constraint billing_usage_credits_period unique (company_id, source, period_start, period_end)
);

create index if not exists billing_usage_credits_slug_idx on public.billing_usage_credits (entity_slug, period_start desc);

alter table public.billing_item_charges  enable row level security;
alter table public.billing_usage_credits enable row level security;
revoke all on public.billing_item_charges  from anon, authenticated;
revoke all on public.billing_usage_credits from anon, authenticated;

notify pgrst, 'reload schema';


-- Existing source: sql/nextgent_prices.sql
-- ============================================================
-- NEXT GENT — item prices set by Paperclip's store (CONTRACT §12)
-- ============================================================
--
-- PUT /api/nextgent/items/:itemKey/price writes here. lib/billingStripe.js
-- itemByKey() lays this row over the store_items row (or stands in for it when
-- this API's store has no such item), so entitlement answers and install
-- charges use the price Paperclip set. stripe_price_id is the Stripe Price
-- created for the current amount; Stripe prices never change, so a new amount
-- gets a new price and installs already billed keep theirs.
--
-- Additive only. Safe to re-run.

create table if not exists public.billing_item_prices (
    item_key           text primary key,
    amount_cents       integer not null default 0,
    currency           text not null,
    interval           text,
    model              text,
    stripe_product_id  text,
    stripe_price_id    text,
    updated_at         timestamptz not null default now(),

    constraint billing_item_prices_amount_check   check (amount_cents >= 0),
    constraint billing_item_prices_interval_check check (interval is null or interval in ('one_time', 'month', 'year'))
);

alter table public.billing_item_prices enable row level security;
revoke all on public.billing_item_prices from anon, authenticated;

notify pgrst, 'reload schema';


-- Existing source: sql/nextgent_prices_fold.sql
-- ============================================================
-- NEXT GENT — one home for item prices: billing_item_prices
-- ============================================================
--
-- An item's price used to live in two places: store_items.price_cents /
-- price_interval / stripe_price_id (sql/nextgent_billing.sql) and
-- billing_item_prices (sql/nextgent_prices.sql, what Paperclip's store sets).
-- lib/billingStripe.js itemByKey() now reads billing_item_prices only, so this
-- copies every price still held on a store_items row into it.
--
--   * A row already in billing_item_prices wins (on conflict do nothing):
--     that is the price Paperclip set last.
--   * The currency is the default billing plan's (billing_plan.currency, a
--     row, not a literal here). Items are skipped if no default plan exists;
--     set one first.
--   * Free items with no Stripe price need no row: no row means free.
--
-- The three store_items columns are left in place. Dropping them is a later,
-- separate file (see sql/ORDER.md), once this has been applied and checked.
--
-- Needs sql/nextgent_billing.sql and sql/nextgent_prices.sql. Additive only.
-- Safe to re-run.

insert into public.billing_item_prices (item_key, amount_cents, currency, interval, stripe_price_id, updated_at)
select
    si.key,
    coalesce(si.price_cents, 0),
    plan.currency,
    case
        when coalesce(si.price_cents, 0) = 0 then si.price_interval
        else coalesce(si.price_interval, 'one_time')
    end,
    case when coalesce(si.price_cents, 0) > 0 then si.stripe_price_id else null end,
    now()
from public.store_items si
cross join lateral (
    select bp.currency from public.billing_plan bp where bp.is_default limit 1
) plan
where (coalesce(si.price_cents, 0) > 0 or si.stripe_price_id is not null)
  and (si.price_interval is null or si.price_interval in ('one_time', 'month', 'year'))
on conflict (item_key) do nothing;

notify pgrst, 'reload schema';


-- Existing source: sql/nextgent_stripe_events.sql
-- ============================================================
-- NEXT GENT — Stripe webhook events, each processed once
-- ============================================================
--
-- stripe_webhook_events   one row per Stripe event id this API has acted on.
--                         Both webhook paths (/api/stripe/webhook and the
--                         older /api/webhooks/stripe) run the same handler
--                         (routes/stripe.js), which claims the event id here
--                         before doing anything; a second delivery of the
--                         same event, on either path or by Stripe's retry,
--                         finds the row and does nothing. A handler failure
--                         releases the claim so the retry can run.
--
-- Additive only. Safe to re-run.

create table if not exists public.stripe_webhook_events (
    event_id     text primary key,
    type         text,
    received_at  timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

notify pgrst, 'reload schema';


grant all on public.billing_item_charges, public.billing_usage_credits, public.billing_item_prices, public.stripe_webhook_events to service_role;
