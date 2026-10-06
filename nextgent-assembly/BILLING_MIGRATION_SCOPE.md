# Existing Stripe billing migration scope

Target: cyber check, mkepugvdlktfsossumox. Status: applied after the owner explicitly approved the exact prepared scope. Migration `20261006000941_nextgent_existing_stripe_billing` is recorded in production history.

Uses existing nextgent_billing.sql, nextgent_prices.sql, nextgent_prices_fold.sql and nextgent_stripe_events.sql, plus server-role grants on the four new tables. SQL SHA-256: `8b339a239e50edc60fb236bc57c29614827909697351499136c0761775ffd0d0`.

Adds Stripe IDs and non-payment timing columns to existing plans/subscriptions, legacy price columns to store_items, and billing_item_charges, billing_usage_credits, billing_item_prices and stripe_webhook_events. Enables RLS on the four new tables, revokes browser-role access, and grants server-role access. The price fold inserts legacy paid item prices only where no canonical price already exists; it does not overwrite existing canonical prices or delete legacy columns.

Historical read-only production preflight: billing_plan, billing_subscription and store_items are present. All four new tables are absent. Exactly one default billing plan exists with currency populated. Existing Stripe/store price additions are absent.

This migration creates schema and folds existing prices; it does not charge customers, create Stripe products, change subscription amounts or configure provider keys/webhooks. Checkout, webhook replay, invoice/subscription state and a real paid app-install flow still require deployed-service acceptance. DDL may lock existing tables.

Post-application verification: all four new tables exist with RLS enabled, anon/authenticated SELECT denied and service-role CRUD allowed. All eight expected Stripe/payment/legacy-price columns exist. Zero legacy paid store items remain without a canonical price. This proves schema and access controls, not live checkout or deployed billing behavior.
