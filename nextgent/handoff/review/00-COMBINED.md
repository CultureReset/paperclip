# NEXT GENT: combined review of everything Claude built

This review was read-only. Nothing was changed, deployed or deleted. Main branches, live sites and both live databases are untouched.

- **Spec used:** ChatGPT's architecture (`SPEC-CHATGPT.md`), which the owner chose.
- **Detail:** the per-repo reports with file:line references are next to this file, `01`–`08`.
- **Where the work is:** branch `claude/agent-ecosystem-architecture-nzexu1` in every repo listed at the end.

Worst first.

---

## 1. The core mistake: platform state was built in the business database

The spec says:

- **Paperclip** (the Saas database) owns platform state: automations, costs, store and installs, and device ownership.
- **gcr-api-clean** (the cyber check database) owns only what is true about the business.

Claude broke that split on its own decision, in every repo. Each item below has to move to Paperclip, or the owner has to rule otherwise.

| # | What was put in the wrong place | Where it is now | Spec |
|---|---|---|---|
| 1 | **Automations/routines.** The engine, waits, scheduler, crons, run records and owner drafts. Paperclip only gets a "hand-off" routine, and its webhook secret is stored in gcr. | gcr `lib/automationEngine.js`, `routes/automations.js`, `nextgent.js:431-443`. Play-user `Automations.jsx` says "One engine — gcr-api-clean's". Plat-admin console. | E12, F: "Paperclip stores/runs the routine" |
| 2 | **Store prices, entitlements, a second install registry.** These are `billing_item_prices`, `nextgent_installs`, and `storeManifest.js`, which calls itself "the store rules". | gcr | C1: Paperclip is the store authority |
| 3 | **Billing and costs.** Stripe, usage credits, phone number charges, and LiteLLM keys (minted in both gcr and Paperclip). | gcr | A1 "costs" = Paperclip (billing location is OPEN) |
| 4 | **Device ownership.** Pairing, `node_pairings`, and `ghost_nodes.entity_slug` hold it; Paperclip holds nothing. | gcr `routes/nodes.js` `/pair/*` | D4: Paperclip holds the association; the relay stays as is |
| 5 | **A new WebSocket transport** to a relay `/connect` route that doesn't exist. | nextgent-platform `link.py` | D4: no new transport |
| 6 | **A second agent runtime.** This is the liveAgent loop for the concierge and Phone Agent, with instructions stored in `nextgent_installs`. | gcr | Paperclip owns agents |
| 7 | **Platform email, texts, notification settings and sign-in codes.** | gcr | platform state |
| 8 | **The two update systems merged.** Computer releases are a Paperclip store item kind (`box-release`), and nothing consumes them. | paperclip `store.ts`, migration 0290; Plat-admin | B: never combine |
| 9 | **Business facts and customer data copied into Paperclip.** Business kind and forwarding address sit in `nextgent_business_links`, and full customer call/SMS transcripts sit in `activity_log`. | paperclip | business state stays in gcr |
| 10 | **The Paperclip API key on the local box.** There are 7 `paperclip_*` tools, and the agent can pass `company_id`. | nextgent-platform `mcp_server.py`, `paperclip.py` | the company never comes from the agent |
| 11 | **Approval receipts no longer pushed** to Paperclip (commit 8b01009 dropped the push). | nextgent-platform `link.py:29-33` | E18 |
| 12 | **The owner app area is ten fixed screens**, not built from installed apps. The Paperclip `store.menu` dashboard was dropped. Bookings/Calendar are built in. | Play-user `nav.js`, `Calendar.jsx` | F, G |
| 13 | **App-build: the store payload is unvalidated, and every app is defined twice.** The builder's QR Menu reuses the shipped item key with a different data model. | App-build- | C1, C3 |

What does match the spec:

- the business bridge: JWKS business tokens, `company_links`, and the slug never taken from a request
- the `business_app_instances` projection
- `app_records` scoped to the install
- surfaces hold no database keys
- gcr-unified reads gcr directly

---

## 2. Security bugs

| Sev | Bug | Where |
|---|---|---|
| High | Service HMAC doesn't bind method, path or query and has no nonce. A signed request can be replayed on another route or direction for 300 s; a signed GET is valid as a DELETE. | gcr signing; paperclip inbound |
| High | `NEXTGENT_SERVICE_SECRET` is reused. It also derives the encryption, session MAC and phone-code keys, so whoever holds it can forge sessions and decrypt OAuth tokens. | gcr |
| High | Consent is forgeable. The unauthenticated `/api/live-photo`, `/contact` and `/opt-in` record consent for any phone and send attacker text. Any "yes" counts as consent. STOP blocks all businesses. | gcr `telephony-live:45` and others |
| High | The install-token route gives the browser a long-lived business token (`expiresAt: null`). | paperclip `nextgent.ts:169-186`; Play-user `installToken.js` |
| High | Scoped agent tokens fall back to the full company token. | paperclip |
| High | XSS in the app HTML renderer, via the `tone`/`style`/`type` attributes on public pages. | App-build- engine |
| Med | The Boxes phone mirror (scrcpy) is interactive, so anyone at the TV can operate the agent phone outside policy. Daemon approve/send acts as the owner for anyone who can reach it. | Boxes |
| Med | `window.open` on agent-supplied URLs accepts `javascript:`. | Play-user `Agents.jsx:291` |
| Med | A company-scoped instance_admin token gets write access in gcr without a `platform_admins` check. | Plat-admin bridge |
| Med | Rentals/services `authRequired` accepts tourists, so guest PII is readable. A remote-view token is stored in plain text. `DELETE /block/:id` cancels any booking. | gcr |
| Med | Cron endpoints are open when `CRON_SECRET` is unset. The unauthenticated AI builder has a spoofable rate limit. Paperclip client path parameters are not encoded. | gcr, App-build-, platform |

---

## 3. Broken flows: things that will not work, or will do damage

1. **All forwarded email will be held** once `nextgent_intake.sql` is applied: the known-senders table is empty and nothing seeds it. Every FareHarbor/Peek/Venmo forward stops. Held payment and HTML-only emails can never be processed.
2. **Transactional texts silently stop** (confirmations, review requests, waivers) for any customer without a consent row. Texted update links are dead.
3. **`completeBookings` first run** marks every past booking completed and sends review requests to the whole historical backlog.
4. **The store push of automations installs nothing.** The payload lacks its `nextgent` section and Paperclip strips it. Since commit a5c72d3, automations cannot reach businesses at all.
5. **Installed apps can never render in Play-user**, because Paperclip `listForCompany` doesn't send `app` or `installId`.
6. **Play-user cannot be typed into:** the `Sheet` steals focus on every keystroke or poll (Business → Edit info, onboarding, New task, Pair a computer).
7. **Play-user viewers are trapped in setup** (a 403 is read as "not linked").
8. **The automation webhook URL points at Play-user**, which forwards to Paperclip, so it doesn't work.
9. Plat-admin hides paused agents, so they can't be resumed.
10. Stripe can double-bill: there are two webhook routes and no install idempotency. Installs are not atomic. A re-install trusts the item kind from the request body.
11. App-build: owner saves fail for any `optionsFrom` field, so QR Menu items can't get a section.
12. Boxes: the local Android/phone features are switched off with no replacement, and the daemon crashes on an unhandled rejection.
13. nextgent-platform: `.env.example` inline comments break the systemd `EnvironmentFile`, so the token becomes the comment text.
14. Paperclip: a store update is applied partially when gcr fails, and the link conflict is checked after the gcr link (orphan links).

## 4. Builds that fail

- **gcr-unified, Play-user (WIP) and Boxes daemon:** they depend on `file:../App-build-/packages/engine`, which fails on any standalone or Vercel build.
- **Boxes shell:** `BusinessHome` imports `KIND_STYLE`, which is not exported.
- **gcr-unified:** listing pages depend on gcr routes that exist only on the branch.
- **Paperclip WIP deploy pack:** `STEPS.md` is missing, ports are hard-coded and the matcher is invalid.

## 5. Owner-rule violations

- **Twilio is still in the code** as a selectable provider (gcr, with tests; paperclip WIP docs).
- **Hard-coded values:**
  - industry regexes that decide permissions (gcr `businessTables`)
  - venue column names in Play-user (`event_name`, `availability_date`…)
  - "Gmail or Outlook", "five minutes"
  - America/Chicago defaults
  - "Gulf Coast Radar" fallbacks
  - a phone number, brand and site URL committed in gcr-unified `.env.production`
  - "Jarvis" in the Paperclip UI, while the server creates the assistant from an env name (this can produce two assistants)
  - the model `claude-sonnet-4-6`
  - Telnyx voice and country defaults
- **Stacked or duplicated pieces:**
  - three automation paths
  - two install registries
  - prices in three places
  - two Stripe webhooks
  - an automation console copied from Admin-dashboard-main
  - repeated helpers and error classes in Play-user
  - duplicate pages in gcr-unified (Directory/search, Openings/deals, Concierge/AiChat)
- **Features dropped without a full replacement:**
  - the Paperclip menu dashboard
  - the store item "Includes…" line
  - the claim email field
  - old gcr invite links
  - Brevo SMS
  - the plugin Business page
  - Boxes local Android
  - App-build builder saving, drafts and pricing (behind a flag)
  - the default receipt push
- **Design decisions Claude made without the owner:**
  - navigation and screens from Claude's own plan §10
  - the nine-step onboarding
  - installed apps public by default
  - unknown email senders held
  - YES/START keywords
  - TV layout and approvals from the TV
  - the WebSocket protocol
  - the 20-pass release gate
  - "Powered by NEXT GENT"
  - text-this-link
  - the trip planner
  - the Ask panel
- **Built-in when it should be an app:** booking capture in the embed widget, the public booking `/manual` path, and the Calendar screen.

## 6. OPEN: the owner decides (not judged right or wrong)

- **Jarvis local vs cloud.** The code does both: Paperclip cloud agent, while ghost-image still installs Jarvis on the box.
- **Facebook/Google: App Maps or official APIs.** The code uses official APIs and Composio; there is no App Map path.
- **Billing location.** All of it is in gcr today.
- **Apps vs modules naming.** Left alone, as the owner asked.
- **Telephony provider** for text-this-link and the concierge. Not Twilio; otherwise undecided.

## 7. Branch inventory (all pushed; nothing uncommitted; main untouched)

| Repo | Branch head | State |
|---|---|---|
| paperclip | bfb6932 | WIP deploy pack |
| gcr-api-clean | 98ba309 | its CLAUDE.md names `claude/new-session-1e1dj0` as the work branch |
| Play-user | eb9c76f | WIP |
| Plat-admin | ba6b1ac | |
| App-build- | 56d1d18 | |
| gcr-unified | 9147550 | WIP, paused |
| Boxes | baedafa | WIP, paused |
| nextgent-platform | 8b01009 | 26 commits beyond main |
| nextgent-maps | 4025155 | |
| nextgent-ghost-image | (no changes) | |

SQL files on the branches have **not** been applied to either live database. Before anyone applies `nextgent_intake.sql` or the consent changes, see items 1–2 in section 3.

## Files for whoever builds next

- `SPEC-CHATGPT.md`: the spec the owner chose.
- `CONTRACT.md` §11–§16: the owner's rules.
- `review/01`–`08`: full per-repo detail with file:line references.
- `FOLLOWUPS.md`: items marked REFERENCE ONLY came from examples and are not specs.
