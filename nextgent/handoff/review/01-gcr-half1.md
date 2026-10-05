# Review: gcr-api-clean half 1 (read-only; every diff line read; new files whole)
## Spec deviations
- Automations run in gcr/business DB (engine runner, waits, scheduler, crons, run records); agent step calls INTO Paperclip with webhook secret from nextgent_installs; entity_automations as install target; owner automation drafts = second control plane; businessEvents runs business-side automations.
- Store installs/versions/permissions in business DB (nextgent_installs read as authority in appInstances, businessTokens, liveAgent, automationEngine); storeManifest.js declares itself THE editable store rules → store rules in gcr not Paperclip.
- Store prices/billing/costs in business DB (setItemPrice with Stripe products, chargeInstall, checkout, applyStripeEvent; LiteLLM usage pull into billing_usage_credits, Paperclip push refused; phone number charges; per-company LiteLLM keys in nextgent_ai_keys).
- Platform email/texts from business API (notify, email templates, billing notices, claim codes).
- Device association resolved in gcr (ghost_mcp_tokens pasted into Paperclip as custom MCP; device→company via ghost_node_requests→company_links; pairing in gcr).
- Agents run inside gcr (liveAgent LLM tool loop for concierge/Phone Agent; instructions from nextgent_installs; Paperclip gets transcript only).
- Two automation release paths (admin deploy + store installs).
- Twilio kept as selectable provider.
- Business sign-up/sign-in still in gcr (Supabase) beside Paperclip path.
- Booking built in: embed widget booking lead capture; email-parser /manual public booking path.
Matches: bridge (JWKS verify, company_links, slug never from request except platform admin); business_app_instances projection; app_records scoped.
## Owner-rule
Broken/dropped: (1) ALL forwarded email held for review once nextgent_intake.sql applied (known senders table empty, no seeding) — every working FareHarbor/Peek/Venmo forward stops; (2) held payment emails can never be processed (body not logged); (3) HTML-only held emails can't be parsed after approval; (4) transactional texts (booking confirmations, review requests, waivers, resend) silently stop without a consent row; dashboard reports sms_sent wrongly.
Hard-coded: businessTables industry heuristics regex (happy_hour|live_music|food|drink|menu…) decide permissions; GOVERNED_COLUMN regex over-locks; email-parser fallback 'Gulf Coast Radar'; 'gcr-' prefix; Telnyx voice female/en-US; country US; NANP-only format; 7-day grace; customer-facing copy in claims/embed/billing.
Decisions made: embed hides phone/booking link until visitor gives name+phone; installed apps public by default (public_enabled default true) vs "owner chooses what is public"; any Paperclip member gets full owner write and can claim.
## Bugs
H1 service signing doesn't bind method/path/query, no nonce → replay across routes for 300 s (signed GET /entitlement valid as DELETE install), and across directions.
H2 NEXTGENT_SERVICE_SECRET also derives secretBox keys, install-session MAC, phone-code HMAC → holder can forge session tokens and decrypt OAuth tokens.
H3 completeBookings first run marks all past active bookings completed and fires booking.completed → review requests to the whole historical backlog; head-of-line blocking.
M4 wait stuck 'running' on error. M5 timezone default Chicago → UTC (blank env) shifts schedules. M6 spoofable LiteLLM billing attribution (request metadata). M7 possible double-count of spend, no pagination. M8 cron endpoints open without CRON_SECRET; secret in URL. M9 consent text stored ≠ shown; booking yes reused for marketing; anyone can register consent for any phone via embed lead. M10 booking popup always blocked. M11 public /manual booking gate weak/reusable. M12 bookings written via section API/MCP/automation data steps fire no events. M13 install double-charge (no idempotency); item subscriptions separate from plan subscription. M14 sms.send to "own" numbers that owner can edit to any number. M15 every unparsed forwarded email notifies owner (no dedupe).
L16–23: retryUnrecorded rewrites ended_at; payments emits event on failed insert; read-then-insert races (notify, googlePush, appInstances, double-send messages); unrecorded run stops at wait and reports ok; owner drafts dead-end; Telnyx async order recorded active, release 404 treated as released (billing stops, number may live); 7-day signed export link with customer records; README tests unverified.
## OPEN
Jarvis/agents: cloud (gcr liveAgent). FB/Google: official APIs, no App Map path. Billing: all in gcr. Naming: apps.
