## Step 4 scoping: the business bridge (read-only; nothing was written)

**Short answer:**
- Removing `business_kind` and `forwarding_address` from Paperclip is mostly mechanical.
- The one real dependency is the store's admin push "kind" audience. It needs a new signed gcr route, because no existing gcr route returns business kinds keyed by company.
- Paperclip stores full customer call/SMS transcripts with no size cap. Nothing in Play-user or Plat-admin displays the transcript text itself.
- Voice transcripts are stored in gcr (`live_conversations`), but no gcr route lets an owner read them.

Repos and heads checked: paperclip 5dc2531, gcr-api-clean c8aa85a, Play-user 9e5dbf0, Plat-admin a30b076.

---

### 1. `nextgent_business_links`: columns, readers, writers

**Columns.** Schema is `/home/user/paperclip/packages/db/src/schema/nextgent_business_links.ts:11-27`. Migrations are `0289_ambitious_kitty_pryde.sql:1-15` (creates the table) and `0291_secret_omega_sentinel.sql:1` (adds `business_kind`). The latest migration is 0292, so the next one is 0293.

| Column | Use |
|---|---|
| `company_id` (pk, fk companies, cascade) | link key |
| `entity_slug` (not null, unique `nextgent_business_links_entity_slug_uq`) | the reference; keep |
| `forwarding_address` | copied business fact |
| `business_kind` | copied business fact |
| `business_token_secret_id` (fk company_secrets, set null) | platform credential |
| `linked_by_user_id`, `linked_at`, `updated_at` | link metadata |

The doc comment at :5-9 calls the row "Paperclip's copy of the link gcr holds in `company_links`".

**`business_kind`**
- Written only in `server/src/services/nextgent-business-link.ts:100-102,119,122`. The value comes from gcr's link response `kind`/`entityType` (gcr `routes/nextgent.js:198-208`, which reads `entity.entity_type`). If gcr sends none, it falls back to `input.create.kind`, then to the previous value. That fallback is where drift can happen.
- Read in `server/src/services/store.ts:277-284` (`planDeploy`, audience `mode==="kind"` turns kinds into company ids).
- Read in `store.ts:630-640` (`businessKinds()`), which feeds `routes/store.ts:179,193` (`GET /store/admin/meta` → `audienceModes[kind].options`).
- UI consumer: Plat-admin `src/modules/console/StoreItem.jsx:123-129,182,200-213`. It shows the options from meta generically and sends `audience.values`.
- History: the values persist in `store_deployments.audience` (migration 0290). Plat-admin `Deployments.jsx:209` shows only the mode.
- Types and docs: `nextgent-gcr-client.ts:31-33`; `docs/api/nextgent.md:308-309`.
- Tests: `nextgent-integration.test.ts:596-607`.
- The value is free text: Play-user `Onboarding.jsx:359` asks "In your own words".

**`forwarding_address`**
- Written in `nextgent-business-link.ts:97,119,122`, and returned at :138 in the POST response.
- Read in `routes/nextgent.ts:212` (`GET /companies/:id/business-link`).
- In Play-user, `businessLink.get` (`src/lib/paperclip.js:140-141`) has **no callers**; only `.token`, `.link` and `.unlink` are used.
- Play-user `Onboarding.jsx:205` keeps the POST response's `forwardingAddress` as a fallback only. Line :416-417 reads the live value from gcr `GET /api/owner/intake/forwarding` first.
- Plat-admin: no use. Paperclip UI: no use.
- Docs: `docs/api/nextgent.md:65-70,85`.
- Tests: `nextgent-routes.test.ts:168-177`, `nextgent-clients.test.ts:40`, `nextgent-integration.test.ts:142-155,179-180,199,385,929`.

**Can the bridge serve each one?**
- **forwarding_address: yes, already.** gcr computes it from the slug and environment settings (`lib/forwardingAddress.js:23-27`). `GET /api/owner/intake/forwarding` (`routes/owner.js:236-242`, business token, `ownerRequired`) returns `{address, confirmation}`. The `/link` response also returns it, so Paperclip can pass it through without storing it. Dropping it loses nothing: it can always be recomputed.
- **business_kind: no existing route.**
  - Agents get it per company from MCP `whoami` → `industry` (`routes/mcp.js:313-323`) through the plugin's `business_whoami`.
  - `GET /api/business/industries` (`business-data.js:251-280`) counts every entity, needs `ownerRequired`, and has no company ids.
  - The `admin-platform` routes return `entity_type` keyed by slug, behind admin auth.
  - The kind audience needs a new signed route that joins `company_links` → `entity.entity_type` and returns company ids. One example: `GET /api/nextgent/business-kinds` → `[{key,count,companyIds}]`.
  - `entity_type` is authoritative in gcr, so dropping the Paperclip copy loses nothing.

### 2. Customer transcripts

**What gcr sends.** There are only two signed posts from gcr to Paperclip (`lib/serviceSigning.js:147` `signedPost`):
- `lib/ghostReceipts.js:80` sends device receipts.
- `lib/liveAgent.js:163-183` (`closeConversation`) sends `{companyId ('nextgent' for the concierge, else live_conversations.company_id), channel, from, to, transcript:[{role,text,at}], outcome}`.
  - It is called from `routes/telephony-live.js:162` (voice hang-up), `liveAgent.js:122,186-191` (SMS idle close) and `liveAgent.js:195-204` (`retryUnrecorded`). The last two are driven by `lib/scheduler.js:24` and `routes/automations.js:645`.
  - `summary` is never sent; no caller passes it.
  - `messages.js` and the phone agent send nothing to Paperclip.

**What Paperclip stores.**
- Received at `routes/nextgent.ts:294-296` (`POST /api/nextgent/conversations`, signature only) and validated by `nextgentConversationSchema` (`services/nextgent-inbound.ts:27-35`).
- Written at `nextgent-inbound.ts:167-194` as `activity_log` with `action:"nextgent.conversation"`, `entityType:"nextgent_conversation"`, `entityId` a random uuid, and `details:{channel, from, to, transcript, summary, outcome}`.
- **No size cap:**
  - The array and each text are unbounded in zod.
  - Only caller turns are cut, to 4000 characters (`liveAgent.js:139`).
  - An SMS session keeps growing as long as each gap stays under 30 minutes.
  - The only ceiling is the 10 MB JSON body limit (`server/src/http/body-limits.ts:1`).
- `persistActivity` (`services/activity-log.ts:158-176`) also publishes the full details as a live event (`activity.logged`).

**Who reads it.**
- Paperclip `GET /companies/:id/activity` (`routes/activity.ts:222-236`) returns the whole details object to any member and to agents with company read access.
- The Paperclip UI `ActivityRow.tsx` shows only the action verb.
- Play-user `Activity.jsx:32-42,144` and `Agents.jsx:482-486`:
  - The title comes from `details.summary` (always absent), so it reads "Nextgent conversation nextgent conversation".
  - The Result line shows the non-object details: channel, **from, to (customer phone)**, outcome.
  - The transcript array itself is never shown.
- Plat-admin `BusinessDetail.jsx:55,202-213` shows only action and entityType.

**Where gcr already holds the same data.**
- `live_conversations` (`sql/nextgent_phone.sql:105-148`) holds the full transcript plus `tool_calls`, outcome, started/ended, `recorded_at` and `record_error`.
- Business-mode SMS is also stored in `business_messages`/`message_threads` (`lib/messages.js:344-354` inbound; the agent reply goes through `messages.sendMessage` at `telephony-live.js:98-101`).
- **Voice and concierge transcripts exist only in `live_conversations`.** No route reads that table: it is hidden in `lib/businessTables.js:82` and has no owner or admin route.

**Minimal reference for Paperclip:**
- `{companyId, conversationId (live_conversations.id), channel, mode, threadId?, startedAt, endedAt, turns, outcome}`.
- No body and no customer number.
- Play-user and Plat-admin would show the same as today minus the phone numbers. Showing the content would need a new gcr owner route such as `GET /api/owner/conversations/:id`.

### 3. Other business state on the Paperclip side

| Item | Where | Reader |
|---|---|---|
| `business_kind`, `forwarding_address` | above | above |
| `entity_slug` | link row | conflict check `nextgent-business-link.ts:51-58`; `nextgent.business_linked`/`_unlinked` activity details (`:136,170`). It is a reference; keep it |
| Customer transcripts and phone numbers | `activity_log.details` (above) | above |
| Automation "agent" step payload: `business{slug,name}`, `trigger` (e.g. booking with customer name/phone), `payload` | gcr `lib/automationEngine.js:424-436` → Paperclip routine webhook → `routine_runs.trigger_payload` (`packages/db/src/schema/routines.ts:157`) | routine run views |
| Device receipts: `target`/`newValue`/`evidence` may carry a customer number or text body for Android SMS sends | `ghostReceipts.js:67-78` → `nextgent-inbound.ts:119-165` (activity plus issue comment) | Play-user Activity, `/receipts` |
| `business_name` in invite email | `routes/access.ts:3367-3371` uses the Paperclip **company** name, not `entity.name` | gcr email template |

- No business data in the Paperclip UI, `packages/shared`, the deploy WIP pack (`deploy/digitalocean/*`: settings and worker ids only), or migrations 0286-0292.

### 4. The bridge as it stands (confirmed)

**Paperclip → gcr, HMAC signed** (`server/src/services/nextgent-gcr-client.ts:137-171`):
- `POST /link`, `POST /unlink`
- `POST /installs`, `PATCH /installs/:id`, `DELETE /installs/:id`, `POST /installs/:id/session`
- `POST /email`, `PUT /items/:key/price`, `GET /entitlement`
- gcr also mounts `/usage` and `/numbers/:phone/registration` (`routes/nextgent.js:692,738`).
- All of these use `router.use(serviceSigned)` (`routes/nextgent.js:57`).

**gcr → Paperclip, signed:** `POST /api/nextgent/receipts` and `POST /api/nextgent/conversations` (`routes/nextgent.ts:290-296`).

**Signing:**
- HMAC-SHA256 over the timestamp, nonce, method, path, query and the SHA-256 of the body.
- Requests older than 300 s are refused, a reused nonce is refused, and the compare is constant-time (`nextgent-service-signing.ts:5-17,141-158`; gcr `lib/serviceSigning.js:5-42`).
- The secret is `NEXTGENT_SERVICE_SECRET`.

**Tokens:**
- **Paperclip business JWT:** EdDSA or RS256, audience `gcr-api-clean`, lifetime at most 300 s. Issued by `routes/nextgent.ts:129-142` (company) and `:149-163` (instance admin). Lifetime is capped in `nextgent-config.ts:87,107` and `nextgent-business-jwt.ts:126`. gcr checks it against the JWKS (`lib/paperclipAuth.js:119-176`, which rejects anything over 300 s). The JWKS is served at `routes/nextgent.ts:285-288`.
- **Install session token** `gcr_mcp_ist.`: at most 300 s, separate `NEXTGENT_SESSION_SECRET` (`lib/businessTokens.js:17-59`).
- **Long-lived company/install tokens** (`gcr_mcp_`, stored hashed): server-side only. They are held as Paperclip company secrets and passed to the plugin by `secret_ref` (`nextgent-business-plugin.ts:33-63`).

**Slug never taken from a request: confirmed.**
- gcr resolves every bridge call through `company_links`: `nextgent.js:147,222,343,640,705,725`.
- `/link` with an `entitySlug` that is not already linked returns 409 `claimRequired` (`:147-157`).
- Owner routes resolve the slug from the token (`middleware/ownerAuth.js:205-226`).
- The plugin never sends a slug (`plugin-cybercheck/src/gcr.ts:1-9`).
- Accepted exceptions: an admin listed in `platform_admins` names the slug (`ownerAuth.js:32-36,212-222`), and the public, read-only MCP and app routes take one (`mcp-public.js:345-354`, `app-data.js:308`).

### 5. README lines CONS §5 says to rewrite

- `/home/user/paperclip/nextgent/README.md:3-6`: "Paperclip is the product… Nothing else holds business state."
- `:8-13`: the diagram shows only Supabase "Saas".
- `:29-31`: "NEXT GENT does not use them, nor `gcr-api-clean`…".
- Related wording at `NEXT_GENT.md:3-4`.
- Spec references: `SPEC.md:233`; CONS `chatgpt-original-40-consolidate.md:15`.

---

### Change list (order keeps each repo green)

1. **gcr `routes/nextgent.js`:** add the signed business-kinds route (header comment :9-29), with tests in `scripts/test-nextgent.js`. Keep `kind`/`forwardingAddress` in the `/link` response.
2. **Paperclip conversation schema** (`nextgent-inbound.ts:27-35,167-194`):
   - Accept the reference shape; make `transcript`/`from`/`to` optional and never store them; add caps.
   - Update `openapi.ts:11511`, `docs/api/nextgent.md:133-143`, and tests `nextgent-routes.test.ts:273,305-325` and `nextgent-integration.test.ts:915-921`.
   - This must ship before step 3. The current schema requires `transcript`, so a gcr post without it would be refused and retried forever.
3. **gcr `lib/liveAgent.js:169-177`:** post only the reference fields. Update `scripts/test-live.js:178-188`, `README.md:259` and the comment in `sql/nextgent_phone.sql:105-109`.
4. **Paperclip kinds through the bridge:**
   - `nextgent-gcr-client.ts`: add the kinds call; drop `kind`/`entityType` at :31-33.
   - `nextgent-store.ts` (store bridge): expose it.
   - `store.ts:277-284,630-640` and `routes/store.ts:179,193`: use it.
   - Rewrite the test at `nextgent-integration.test.ts:596-607` with a mocked bridge.
5. **Paperclip link service:** in `nextgent-business-link.ts:97-102,119,122`, stop writing both fields; keep `forwardingAddress` as a pass-through in the POST response (:138). Drop it from `routes/nextgent.ts:212`. Update the link tests listed in section 1.
6. **Paperclip schema and migration:** remove both columns from the schema (:16-18, comment :5-9) and generate 0293 with `pnpm db:generate`, which also produces the snapshot and journal entry. The SQL goes into a file; the owner applies it.
7. **Docs:** `docs/api/nextgent.md:60-85,293-310`; the `nextgent/README.md` rewrite.
8. **Play-user:** doc comments only, `src/lib/paperclip.js:140,145`. `Activity.jsx` works unchanged.
9. **Plat-admin:** no change needed.

Optional: add gcr owner/admin routes that read `live_conversations` (in `routes/owner.js`, plus Play-user `src/lib/business.js`) so voice and concierge transcripts can be seen at all.

### Decisions for the owner (not mechanical)

1. **Kind audience:** keep it through the new gcr route, or drop it? `entity_type` is free text, so the kind values drift.
2. **Migration 0293:** archive the two columns to a backup table first, or just drop them? Both can be rebuilt from gcr.
3. **Old `nextgent.conversation` rows already holding transcripts:** strip them with an owner-applied SQL file, or leave them? Two things to weigh:
   - Paperclip treats `activity_log` as an audit trail.
   - The old rows carry no gcr id to match them against `live_conversations`.
4. **Customer number in Paperclip Activity:** show none, a masked number, or the business's own number only?
5. **Transcript viewing:** should owners and operators be able to read call/text transcripts in gcr? If so, the screen and wording are a design question.
6. **Automation agent step:** it sends booking and customer data into Paperclip `routine_runs`. Fix it now, or with step 7.1?
7. **Receipts:** should SMS bodies or numbers in receipts be trimmed?
8. **README:** the rewrite wording.
9. **`entity_slug`:** keep the copied reference? It is needed for the conflict check added in step 2.9.