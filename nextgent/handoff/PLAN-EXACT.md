# NEXT GENT: exact fix plan, step by step

**Source of truth:** ChatGPT's own documents, saved word for word in `chatgpt-originals/`. They are:

| File | Content |
|---|---|
| 15 | the reconciled architecture |
| 16 | the Sandbar walkthrough |
| 12 | corrections: devices, executor, simplicity, the ten screens |
| 10 | the repo-by-repo keep/merge decisions |
| 5 | repos as Lego blocks |
| 32 | the capability app store |

Where those documents and the owner disagree, the owner wins and the builder asks.

## Rules for every step (no exceptions)

1. **Branch.** Work only on `claude/agent-ecosystem-architecture-nzexu1`. Never touch main, never force-push, never delete a file without a replacement that does everything it did.
2. **No live changes.** No live database change, no deploy, no real secret. SQL is written to files only, and the owner applies it.
3. **Before writing code,** read what exists for that feature, so nothing is rebuilt that is already there.
4. **After writing code:**
   - Reread the whole diff.
   - Run that repo's checks (listed per step).
   - Confirm every route the code calls actually exists.
5. **Report after each step:** what changed, the commits, the check output, and anything left. Then **stop until the owner says next.**
6. **Design choices** (screens, wording, layout, prices, defaults) go to the owner as a question. The builder never decides them.
7. **Nothing hard-coded:** no industries, names, URLs, prices, models, providers, numbers, emails or limits. **No Twilio.**

Repo checks:

| Repo | Checks |
|---|---|
| gcr-api-clean | `npm run verify`, `npm run test:mcp`, `npm test` |
| paperclip | typecheck, server tests |
| Play-user | `npm run check` and `vite build` |
| Plat-admin | `npm run verify` and build |
| App-build- | engine tests |
| nextgent-platform | `pytest`, `ruff` |

---

## STEP 1: Write the real spec (no code)

- **1.1** Write `SPEC.md` from `chatgpt-originals/`, quoting ChatGPT's wording. Every rule cites its source file.
  - It replaces `SPEC-CHATGPT.md`, `CONTRACT.md` §14 and Claude's plans, which are kept as history and not deleted.
- **1.2** List each point where ChatGPT and the owner disagree as a question.
- **1.3** The owner reads it and approves or changes it.

**Done when:** the owner approves `SPEC.md`.

## STEP 2: Fix the dangerous bugs (branch only, no design changes)

**gcr-api-clean:**

- **2.1 Forwarded email.** The intake must not hold mail from senders that already work.
  - Seed known senders from the existing parsed-email history in the SQL file.
  - Store the body of held mail, so payment and HTML-only mail can be processed after approval.
- **2.2 Texts.** Booking confirmations, review requests, waivers and update links must keep sending.
  - Transactional texts follow the rules that applied before consent was added.
  - Only marketing needs a consent row.
  - Update links get their passcode created again.
- **2.3 `completeBookings`.** It may only act on bookings that end after the job is first switched on. No backlog sends.
- **2.4 Consent.**
  - Remove consent recording from the unauthenticated `/api/live-photo`, `/contact` and `/opt-in` routes.
  - A "yes" counts only as a reply to a consent question that was actually sent.
  - STOP applies per business.
- **2.5 Signing.**
  - The HMAC covers method, path, query, body, timestamp and a nonce, and the nonce is checked against replays.
  - Each purpose gets its own secret (service signing, encryption, session MAC, phone codes). The new secret names go in `.env.example`; values come from the owner.
- **2.6 Smaller security fixes:**
  - Tourists can't read rentals/services.
  - `DELETE /block/:id` is owner-scoped.
  - The remote-view token is not stored in plain text.
  - Cron routes refuse requests without `CRON_SECRET`.
  - One Stripe webhook route, with idempotent installs.

**paperclip:**

- **2.7** The install-token route returns a short-lived token, never the stored long-lived one.
- **2.8** Scoped agent tokens fail closed: no fallback to the company token.
- **2.9** Check for a link conflict before calling gcr, and roll back cleanly when gcr fails during a store update.

**App-build- engine:**

- **2.10** Escape every HTML attribute (fixes the XSS through `tone`, `style` and `type`).
- **2.11** Owner saves work for `optionsFrom` fields.

**Play-user:**

- **2.12** `Sheet` focus: run the focus effect only on open, not when `onClose` changes.
- **2.13** Viewers: a 403 for a viewer is not "not linked". Viewers see the app read-only.
- **2.14** The webhook URL uses gcr's own public address, not Play-user's.
- **2.15** `window.open` accepts only http and https.

**Plat-admin:**

- **2.16** Show paused agents.
- **2.17** The bridge requires a `platform_admins` check for writes.

**Boxes:**

- **2.18** The scrcpy mirror is view-only (`--no-control`).
- **2.19** Daemon approve and send require the owner token.
- **2.20** Fix the `KIND_STYLE` export and the crash on unhandled rejection.

**nextgent-platform:**

- **2.21** Fix `.env.example` inline comments and `~` expansion, and URL-encode Paperclip path parameters.

**Builds (gcr-unified, Play-user, Boxes):**

- **2.22** Replace the `file:../App-build-/packages/engine` dependency with a form that builds standalone.
  - Owner choice: a published package or a vendored copy. Ask.

**Done when:** every repo's checks pass, and each fix has a test that failed before the fix and passes after.

## STEP 3: ChatGPT integration job 1, the Paperclip store

- **3.1** Confirm the `nextgent/foundation` store is fully on the branch: `store_items`, `store_item_versions`, `store_installs`, `store_install_resources`, `store_settings`, channels, update modes and advisories.
- **3.2** `listForCompany` returns what the surfaces need to render an installed app: install id, version, enabled, the manifest reference and public on/off.
  - This fixes "installed apps can never render" in Play-user.
- **3.3** Install records company, item, version, channel and update mode.
  - The Play-user install sheet offers a channel choice.
  - Wording of the choice goes to the owner.
- **3.4** Computer releases (`box-release`) come out of the store. Releases belong to ghost-image (two update systems, never combined).
  - The Plat-admin release screen shows what ghost-image publishes, or is parked until the owner decides.

**Done when:** an owner can install, update, pause and remove an app, agent and automation in Play-user, and Paperclip is the only record of it.

## STEP 4: ChatGPT integration job 2, the business bridge

- **4.1** Keep the restored bridge as it is: JWKS tokens of 300 s or less, `company_links`, and the slug never taken from a request.
- **4.2** Stop copying business facts into Paperclip. Remove `business_kind` and `forwarding_address` from `nextgent_business_links` and read them through the bridge. Done as a migration file, with no data loss.
- **4.3** Customer call and SMS transcripts stay in gcr. Paperclip activity keeps a reference only.

**Done when:** Play-user Business, Jarvis and agents read and edit business facts only through the bridge, and Paperclip holds no business facts.

## STEP 5: ChatGPT integration job 3, the app engine into the store

- **5.1** One definition per app. Remove the duplicate `src/modules/*/manifest.ts` starters after confirming `apps/*/manifest.json` covers each one.
- **5.2** Paperclip validates the app manifest on publish, using the engine's validator on the server, not only in the browser.
- **5.3** Apps read shared business data and keep only app-specific records.
  - FAQ, leads, contacts and currency move from app records to business data.
  - Each app's data is listed for the owner first.
- **5.4** The builder's QR Menu gets its own item key, or uses the shipped QR Menu's data model. Owner choice.
- **5.5** Apps declare the events they emit (booking.created and so on), so automations have triggers.

**Done when:** an app published from the builder installs from the Paperclip store and renders its owner and public faces over business data in Play-user and gcr-unified.

## STEP 6: ChatGPT integration job 4, devices

- **6.1** Paperclip device registry, as in ChatGPT doc 12:
  - Computer: device_id, version, capabilities, online/offline, last_seen.
  - Android: device_id, paired computer, SIM status, capabilities, last_seen.
  - Each record references the existing relay node id.
- **6.2** The relay (gcr `routes/nodes.js` + `ghost_nodes`) is untouched in how it carries messages.
  - Pairing writes the company↔device association into Paperclip.
  - gcr no longer decides device ownership.
- **6.3** Remove the new WebSocket transport (`link.py` `/connect`) and go back to the existing relay.
- **6.4** Restore the receipt push from nextgent-platform to Paperclip (dropped in 8b01009).
- **6.5** Remove the Paperclip API key and the 7 `paperclip_*` tools from the local box.
  - Instructions arrive as tasks carrying what the executor needs.
  - The executor does not call gcr directly (ChatGPT doc 12, point 3).

**Done when:** Play-user Computer, Boxes and Plat-admin show which devices belong to a company from Paperclip, and an Android action produces a receipt in Activity.

## STEP 7: Move what Claude put in the wrong database

- **7.1 Automations.** Stored and run as Paperclip routines, defined as WHEN/WAIT/DO/USING data.
  - gcr only reports business events and keeps business data.
  - Port every feature of the gcr engine first: waits, schedules, drafts, run history, the admin rollout.
  - Prove parity with a side-by-side test, then switch Play-user and Plat-admin, then retire the gcr engine. Its code stays in history.
- **7.2 Store prices and entitlements.** Paperclip only. gcr keeps only `business_app_instances` (the small projection public pages read).
- **7.3 Agents.** One runtime, in Paperclip. The concierge and Phone Agent run as Paperclip agents using the business MCP, and gcr's liveAgent loop is retired after parity.
- **7.4 Platform email, texts, notification settings and sign-in codes** move to Paperclip.
- **7.5 Billing** goes wherever the owner decides (open question). Until then, untouched.

**Done when:** the cyber check database holds only business state, and no feature was lost (checked against the feature list for each item).

## STEP 8: Feature work, in the owner's order

- **8.1 Play-user, ten fixed screens** (ChatGPT doc 12).
  - Inside them, everything is dynamic: installed apps, business sections, industry data.
  - Remove the hard-coded venue columns, "Gmail or Outlook" and "five minutes".
- **8.2** Dashboards-users- functionality goes under Business in Play-user. Its standalone deployment is retired only after parity.
- **8.3** Admin-dashboard-main goes under Business Data in Plat-admin. Same rule.
- **8.4** Public page = business data plus installed app blocks. The owner chooses show/hide, order and render mode.
- **8.5** Store permission screen in plain words ("needs Availability + Bookings").
- **8.6** Just-do-it: compare its data model with gcr's and bring the better pieces into gcr.
- **8.7** Linux-: list features Boxes lacks and port those.
- **8.8** Remove Twilio from the code once the owner names the provider.
- **8.9** Final sweep for hard-coded values and duplicates across every repo.

## Owner decisions needed (the builder stops here when one is reached)

| # | Decision | Needed by |
|---|---|---|
| 1 | Billing location | step 7.5 |
| 2 | Facebook/Google updates via App Maps or official APIs | step 8 |
| 3 | Phone and text provider (not Twilio) | step 8.8 |
| 4 | How the app engine is shared: published package or vendored copy | step 2.22 |
| 5 | QR Menu item key | step 5.4 |
| 6 | All wording and layout choices raised during the steps | as raised |
