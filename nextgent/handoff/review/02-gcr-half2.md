# Review: gcr-api-clean half 2 (read-only; every diff line read; some large old files read diff+context only — gcr.js, google-business.js, platform.js, public.js, rentals.js, services.js, stripe.js, tourist*.js, transportation.js, webhooks.js, server.js, utils/sms.js)
## Spec deviations
1 Automations/routines stored and run in gcr (nextgent.js:431-443, automation_waits, owner_automation_drafts, cron tick); Paperclip routine webhook secret stored in business DB; control inverted (gcr engine calls Paperclip routine as a step).
2 Store prices (billing_item_prices), entitlement (gcr store_items/plans/grants), second install record (nextgent_installs) in business DB. business_app_instances projection matches spec.
3 Billing/costs in business DB (Stripe ids, item charges, usage credits, pause, LiteLLM keys in nextgent_ai_keys). (H: owner decides; costs = Paperclip per A1.)
4 Second agent runtime: telephony-live LiteLLM agent loop in gcr; agent instructions stored in nextgent_installs.
5 Device↔business association decided in gcr (node_pairings, /pair routes); Paperclip holds nothing.
6 Platform email/notifications/sign-in codes in business DB (team invite email, owner_notifications, phone_verification_codes, message tables "platform rows").
7 Duplicate store/release paths: old app catalogue kept; prices in 3 places until later drop; admin automation rollout = second release system.
8 Device capability tools served from gcr (mcp-ghost) — medium (pass-through over relay).
Fits spec: bridge (HMAC, company_links, no slug from request, claim before linking).
## Owner-rule
Hard-coding: owner-availability limited threshold 3 (disagrees with engine ≤2/25%); tourist MAX_ROUNDS 8 + model claude-sonnet-4-6 (pre-existing); live-photo "Thanks for dining" restaurant wording; concierge company id 'nextgent' literal; gcr.js cache/limits; consent fold country code '1'; "Expires tonight" for 30h links; Telnyx default.
Twilio still supported (provider switch, inbound signature checks, tests).
Stacking: three automation paths (platform.js old runner, automationEngine, Paperclip routines); two Stripe webhook routes; two availability status rules; four test DB stubs.
Changed without replacement: every transactional text now needs message_consent → flows without consent capture stop sending (design decision); Brevo SMS removed; texted update links broken.
Decisions made without spec: YES/START keyword, companies see all business computers, write≠read, trust ranks, public MCP 600→60 + kill switch, remote screen view, unknown senders held.
Emails pulled: none.
## Bugs
1 Texted update links dead (no passcode created, validate refuses).
2 Consent forgeable: unauthenticated POST /api/live-photo records consent for any phone and texts attacker body; /contact and /opt-in same.
3 Any "yes" = consent (telephony-live:45); STOP blocks globally for all businesses.
4 Install not atomic: token mint failure leaves charge+install; failed app/automation step doesn't release bought number.
5 Re-install trusts body kind/itemKey: can swap automation with no entitlement/charge; updates install before projection.
6 DELETE /block/:id can cancel any booking, no event.
7 Remote-view token stored in plain text in ghost_node_requests.body.
8 Rentals/services authRequired accepts tourists → guest PII readable.
9 Double billing if Stripe posts to both webhook routes.
10 Google push cron open without CRON_SECRET.
11 Deterministic tourist passwords sha256(phone+'gcr-salt') (pre-existing; newly reachable via Telnyx path).
12 Session tokens mintable for any install (companyId optional); update-link passcodes Math.random, no attempt limit, non-constant compare; wait steps up to 1h late on Vercel.
13 Weak tests: memdb maybeSingle/eq loose; not/order no-ops; owner tests stub ownerRequired; dedup test can pass on collision.
## OPEN (owner)
Jarvis: code runs agents in cloud. FB/Google: official API used. Billing: all in gcr. Naming: "apps".
