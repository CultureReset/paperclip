# NEXT GENT wiring contract (v1)

Every repo implements its side of this exactly. If you must change something here, stop and report it instead of inventing a different shape. The plan is `NEXT-GENT-plan-final.md` in the same folder; read sections 2, 5, 6, 7, 8, 9, 10 and 15 before coding.

## Names
- Paperclip = control plane (repo `paperclip`). gcr-api-clean = business data (repo `gcr-api-clean`). Play-user = owner app. Plat-admin = admin console.
- A Paperclip company = one business. Link: `company_links(company_id text primary key, entity_slug text unique not null, linked_at timestamptz default now(), linked_by text)` in the cyber check database (gcr-api-clean owns it).

## 1. Screen → gcr-api-clean (business token, JWKS)
- Paperclip issues: `POST /api/companies/:companyId/business-token` (session auth, caller must be a member of the company, or an instance admin) → `{ "token": "<JWT>", "expiresAt": "<ISO>" }`.
- JWT: alg `EdDSA` (Ed25519) or `RS256`; header `kid`; claims `iss` = `PAPERCLIP_PUBLIC_URL`, `aud` = `"gcr-api-clean"`, `sub` = Paperclip user id, `company_id`, `role` (`owner` | `member` | `instance_admin`), `iat`, `exp` (≤ 300 s after `iat`).
- Paperclip publishes the public keys at `GET /.well-known/jwks.json`. Private key from env `NEXTGENT_JWT_PRIVATE_KEY` (PEM); if missing in dev, generate one at start and warn.
- gcr-api-clean verifies with env `PAPERCLIP_ISSUER` and `PAPERCLIP_JWKS_URL` (cache keys, refetch on unknown `kid`), checks `aud`, `exp`, then resolves `company_id` → `entity_slug` through `company_links`. Sets `req.entitySlug` exactly like the existing Supabase owner path. No slug from the request, ever.
- `role = instance_admin` is honoured only if the Paperclip user id is in `platform_admins.paperclip_user_id` (new nullable column). Admins then name a slug explicitly, as today.

## 2. Screens reach gcr-api-clean through their own proxy
- Play-user and Plat-admin: existing `api/[...path].js` keeps forwarding `/api/*` to Paperclip.
- New `api/biz/[...path].js`: forwards `/biz/<rest>` to `${GCR_API_URL}/api/<rest>`, passing method, body, query and the `Authorization` header unchanged. Env `GCR_API_URL`.
- Front ends call `/biz/...` with `Authorization: Bearer <business token>`; they fetch a token from Paperclip and refresh it before `expiresAt`.

## 3. Service-to-service signing (both directions)
- Shared secret env `NEXTGENT_SERVICE_SECRET` in both Paperclip and gcr-api-clean.
- Headers: `x-nextgent-timestamp` (unix seconds), `x-nextgent-signature` = hex HMAC-SHA256 of `${timestamp}.${rawBody}`. Reject if older than 300 s or signature mismatch (constant-time compare).

## 4. gcr-api-clean endpoints Paperclip calls (signed, section 3)
- `POST /api/nextgent/link` `{ companyId, entitySlug }` or `{ companyId, create: { name, kind, phone?, address?, website? } }` → `{ entitySlug, forwardingAddress, businessToken }` (businessToken = a `business_mcp_tokens` token, scope `read`+`write` permissions for Jarvis, returned once). Idempotent per companyId.
- `POST /api/nextgent/installs` `{ companyId, installId, itemKey, kind: "agent"|"app"|"automation", version, permissions: ["availability:read", ...], routine?: { webhookUrl, webhookSecret } }` → `{ token? }` (token for agent/app installs, limited to `permissions`; automation installs store the routine webhook for the "give to agent" step).
- `DELETE /api/nextgent/installs/:installId` → revokes its token, disables its automation.
- `GET /api/nextgent/entitlement?companyId=&itemKey=` → `{ allowed: bool, reason?, priceCents?, interval? }` (uses `lib/entitlements.js` / `lib/billing.js`).
- `POST /api/nextgent/unlink` `{ companyId, export: bool }` → teardown; returns an export URL when asked.

## 5. Paperclip endpoints gcr-api-clean calls (signed, section 3)
- `POST /api/nextgent/receipts` `{ companyId, taskId?, action, target, oldValue?, newValue?, device?, verified: bool, at, evidence? }` → stored and shown in Activity, attached to the task when `taskId` given.
- `POST /api/nextgent/conversations` `{ companyId | "nextgent", channel: "voice"|"sms", from, to, transcript: [{role, text, at}], summary?, outcome? }` → recorded as an activity/work item.
- `POST /api/nextgent/notify` is NOT needed: notifications are sent by gcr-api-clean directly (email via `utils/email.js`, text via the telephony provider).

## 6. Business token permissions (resource:action)
- `business_mcp_tokens` gets `permissions text[]` (nullable = legacy behaviour from `scope`). Resources map to table groups in `lib/businessTables.js`: `business` (profile, hours, contacts, locations, photos, policies, faqs), `menu`, `availability`, `bookings`, `events`, `reviews`, `transactions` (payments detected), `messages` (send). Actions `read`, `write`, `send`.
- Enforcement lives once, in `lib/businessTables.js`, used by `routes/business-data.js` and `routes/mcp.js`.
- Each token also carries `install_id` (nullable) and `company_id`.

## 7. Telephony (no Twilio)
- Provider switch env `TELEPHONY_PROVIDER` = `telnyx` (default) | `twilio` (legacy path kept, off by default). One module `lib/telephony/index.js` exposing `sendSms({to, from, text})`, `placeCall(...)`, `buyNumber(...)`, `releaseNumber(...)`, `verifyWebhook(req)`; `utils/sms.js` routes through it.
- Telnyx env: `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` (webhook signature), `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_CONNECTION_ID` (voice), `PLATFORM_NUMBER` (codes, notifications), `CONCIERGE_NUMBER`.
- Inbound: `POST /api/telephony/telnyx/messaging` and `POST /api/telephony/telnyx/voice` (webhooks). Number → who answers: `CONCIERGE_NUMBER` → concierge (public MCP); a Phone Agent number → that business (business MCP, its install token).
- Live voice: Telnyx Call Control with speech (gather using speech / AI) driven by gcr-api-clean, answering through LiteLLM with the agent's instructions and MCP tools. Must run on the always-on server (document that it doesn't work on Vercel).

## 8. LiteLLM
- Env in Paperclip: `LITELLM_URL`, `LITELLM_MASTER_KEY`. At sign-up Paperclip creates a key per company (`/key/generate`, `metadata.company_id`, budget from plan); agents of that company use it. gcr-api-clean uses `LITELLM_URL` + a key per company for voice/concierge answers (concierge uses a NEXT GENT key).
- If LiteLLM env is absent, fall back to the existing single key and log a warning (dev only).

## 9. Automations
- New step types in `lib/automationEngine.js`: `wait` (`{ minutes }`, persisted in `automation_waits(run_id, step_index, due_at, state)`, resumed by the existing scheduled check), `agent` (POST to the install's stored routine webhook, HMAC per Paperclip `hmac_sha256` signing), `message` (uses messages.send).
- Events fired: `booking.created`, `booking.changed`, `booking.cancelled`, `booking.completed` (scheduled check: end time passed, not cancelled), `payment.received`, `review.received`, `intake.created`.

## 10. Branch and checks
- Develop and push only on branch `claude/agent-ecosystem-architecture-nzexu1` in each repo. Commit with clear messages ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01A3PAY15Z324k8tnSWNvrmU`.
- Push with `git push -u origin claude/agent-ecosystem-architecture-nzexu1`; never force-push; never push other branches.
- Never touch a live database, live deployment, or enter real secrets. SQL goes in files (`sql/…`) only. Every new env var goes in `.env.example` with a comment.
- Run the repo's own checks before every push and report the output.

## 11. Nothing hard-coded (owner's rule, binding)
- No business names, slugs, industries, categories, business sections, item lists, URLs, hostnames, prices, plan names, model names, phone numbers, emails, provider names or limits in code.
- They come from env vars (documented in the env example), the database (plans and prices as rows), the store manifest, or the business's own data. Only spec-fixed constants (contract header names, JWT `aud`) and the fixed main navigation are built in.
- No sample data in production code paths.
- Before every commit: reread the diff and grep it for literals that should be data or config; fix them; say in the report how you checked.

## 12. Additions (v1.1)
- **Instance admin token.** Paperclip: `POST /api/admin/business-token` (session auth, instance admins only) → `{ token, expiresAt }`, JWT as §1 with `role: "instance_admin"` and no `company_id`. gcr-api-clean: `middleware/auth.js` `adminRequired` (and any other admin gate) accepts it when the `sub` is in `platform_admins.paperclip_user_id`; admin routes keep naming the slug explicitly. Plat-admin uses this token for fleet-wide and admin screens instead of borrowing a company's token.
- **Store admin routes Plat-admin calls (Paperclip):** `GET /api/store/admin/meta` (kinds, channels, advisory types, price models and intervals — from config/DB, not hard-coded lists in the UI), `POST /api/store/admin/items/:id/deploy/preview` and `/deploy` (audience: all | companies[] | channel; force for security fixes), `GET /api/store/admin/items/:id/installs`, `PUT /api/store/admin/items/:id/price` (amount, currency, interval, model; Paperclip forwards price to gcr-api-clean's billing item price so entitlement/install charges use it), `GET /api/store/admin/deployments`. Store kinds must include `box-release` (a signed computer release plan, payload = ghost.json + signature).

## 13. Reuse before building (owner's rule, binding)
- Read the existing code first and reuse it. Extend in place; don't rewrite what works.
- Never delete or replace an existing feature unless the new code covers everything it did. Every final report lists each deleted or rewritten file and what now covers each of its features.

## 14. Capability apps, connectors and page assembly (owner's model, binding)
- **Apps are capabilities, never industries or vendors.** One Availability, one Menu, one Listings, one Book… reused by any business. No "restaurant availability", no "HubSpot availability".
- **Canonical data + connectors.** An app declares the canonical concepts it needs (e.g. availability: resource, date, time, capacity, status, location, service; menu: section, item, description, price, sku, image, availability, modifier; customer/lead: name, phone, email, status, notes, activity). A connector maps a source (manual, CSV, iCal, Google/Outlook calendar, POS, CRM, booking system, forwarded email, API, device observation) into those concepts. Apps never talk to vendors; connectors never render UI. The business chooses a source per concept.
- **Identity and provenance.** Every record has our stable internal id. Vendor ids/SKUs live in an external-references mapping (entity, record id, source, source id). Every record/value keeps source_type, source_id/external_record_id, source_updated_at, last_synced_at, created_by/updated_by and owner_override so syncs update instead of duplicating and never overwrite an owner's correction.
- **One business record; app-owned records are scoped.** Apps read shared business data; records an app creates (song_requests, votes, shoutouts, orders…) belong to the business and the install, behind gcr-api-clean. No database per app.
- **Two surfaces per app.** Public (customer) and owner (backend) are two views of the same records. The owner app's Apps area lists each installed app as its own entry; uninstalling removes both surfaces.
- **Runtime projection.** Paperclip stays the authority for installed/version/enabled/entitled; gcr-api-clean keeps a projection (`business_app_instances`: install id, app key, enabled, public_enabled, render_mode, public_label, config, position) so public pages render without calling Paperclip per visit.
- **Page assembly.** The public page is a shell (branding, theme, header, order) plus installed modules. Each module: installed/removed, reordered, shown/hidden, rendered inline, as a button, or as its own page (`/<business>/<app>`). Header action row (Call, Book, Email, Directions, Social, Save Contact) is made of installed action apps.
- **Action apps and contextual actions.** Call, Book, Book Appointment, Schedule, Request Booking, Contact, Social Links, Save Contact (vCard), Directions, Custom Link are separate store apps when their experience differs. An installed action app can be placed inside another module's card (Book inside a listing, Song Request inside an event) without becoming part of that module.
- **Separate music apps.** Song Request, Crowdsource a Song (free votes per person, paid vote packs, live ranking), Shoutout Request, Tips and Merch Store are independent; removing one never breaks another.
- **Payments as a service.** Apps that take money (merch, vote packs, tips, deposits) call one payments service (Stripe Connect per business; platform fee from config); manual/claimed payments (Venmo, Cash App via forwarded email) stay "claimed" until matched.
- **Distribution and measurement.** QR (and NFC) to the page or a module, Save Contact, page/module/action analytics (views, clicks, submissions), and tracking pixels (Meta, TikTok, Google) configured per business — ids from the business's settings.

## 15. Examples are not specs (owner's rule, binding)
- Prototypes, images, sales pages and reference sites the owner shares are for understanding how things work. Never copy their layouts, wording, sample data or feature lists, and never build a feature only because an example shows it. The real product will look better than the examples.

## 16. Design decisions belong to the owner (binding)
- Builders implement only what the plan and this contract already decide. Any design choice not settled here — where something lives, which database or repo owns it, how a piece is shaped, adding or dropping a feature — is NOT made by the builder: stop that part, keep it out of your commits, and list it in your report as "decision needed" with the options.
