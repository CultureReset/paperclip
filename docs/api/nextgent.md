---
title: NEXT GENT wiring
summary: Business tokens, the business link, signed calls with gcr-api-clean, and store installs
---

These endpoints are the bridge between Paperclip, which owns platform state
(accounts, companies, agents, work, routines, approvals, activity, costs,
store, installs, permissions), and gcr-api-clean, which with the `cyber check`
database owns business state. One Paperclip company is one business. The
bridge is three things: the link (`company_id` ↔ `entity_slug`), business
tokens that live at most 300 s, and HMAC-signed service calls in either
direction. Every setting is an environment variable listed in `.env.example`.

## Business token for screens

```
POST /api/companies/{companyId}/business-token
```

Session auth. The caller must be an active member of the company (owner or
other non-viewer member) or an instance admin. Returns a short-lived JWT the
screen sends to gcr-api-clean as `Authorization: Bearer …`:

```json
{ "token": "<JWT>", "expiresAt": "2026-10-04T12:05:00.000Z" }
```

- Header: `alg` `EdDSA` (Ed25519) or `RS256`, `kid`.
- Claims: `iss` = `PAPERCLIP_PUBLIC_URL`, `aud` = `"gcr-api-clean"`, `sub` =
  Paperclip user id, `company_id`, `role` (`owner` | `member` |
  `instance_admin`), `iat`, `exp` (at most 300 s after `iat`).
- Viewers get `403`; agents get `403`. Refresh before `expiresAt`.

```
GET /.well-known/jwks.json
```

Public. The verification keys (`{ "keys": [ … ] }`, public halves only).
The signing key is `NEXTGENT_JWT_PRIVATE_KEY`; without it a temporary key is
generated at start and a warning logged (dev only).

```
POST /api/admin/business-token
```

Instance admins only (contract §12). Same token shape with
`role: "instance_admin"` and no `company_id`, for Plat-admin's fleet-wide and
admin screens. gcr-api-clean honours it only for ids in
`platform_admins.paperclip_user_id`; admin routes still name the slug.

## Business link

```
GET    /api/companies/{companyId}/business-link
POST   /api/companies/{companyId}/business-link
DELETE /api/companies/{companyId}/business-link
```

`POST` (owners, admins, instance admins) is called by the app after the owner
picks, creates or claims a business. Body: exactly one of

```json
{ "entitySlug": "the-business" }
{ "create": { "name": "…", "kind": "…", "phone": "…", "address": "…", "website": "…" } }
```

Paperclip calls gcr-api-clean `POST /api/nextgent/link` (signed, with the
owner's email as `notify.email`), stores the returned business token as the
company secret `NEXTGENT_BUSINESS_TOKEN`, records the slug, and writes the
business-data plugin's config so the company's agents can use it. The token
is never returned. Response `201`:

```json
{ "entitySlug": "the-business", "forwardingAddress": "…" }
```

`forwardingAddress` is gcr-api-clean's answer passed through for the screen
that follows; Paperclip does not keep it (nor the business's kind). Read the
live value from gcr-api-clean (`GET /api/owner/intake/forwarding`, business
token).

gcr-api-clean's refusals are passed through with their fields, e.g.
`409 { "error": "…", "claimRequired": true }` (claim the listing first) or
`409 { "error": "…", "claimInstead": { "slug": "…", "name": "…" } }`.
A business already linked to another company answers `409`.

`DELETE` (same roles) tears the link down. Optional body
`{ "export": true }` asks gcr-api-clean for an export first. Paperclip deletes
the business token and every install token, and rewrites the plugin config.
Response: `{ "unlinked": true, "entitySlug": "…", "exportUrl": "…" }`
(`exportUrl` only when exported).

`GET` (any member) answers `{ "linked": false }` or
`{ "linked": true, "entitySlug", "linkedAt" }`.

The link row (`nextgent_business_links`) is the reference only: `entity_slug`
and the secret holding the business token. Facts about the business are read
from gcr-api-clean when a screen or a push needs them.

## Devices

The device registry (SPEC §5): Paperclip knows which computers and Android
phones belong to a company; the relay in gcr-api-clean reaches them;
nextgent-platform operates them. Rows live in `nextgent_devices` (`kind`
`computer` | `android`, `relay_node_id` = gcr-api-clean's `ghost_nodes.id`,
`device_key`, `paired_computer_id`, `name`, `version`, `capabilities`,
`sim_status`, `phone_number`, `last_seen_at`, `paired_by_user_id`, `paired_at`,
`unlinked_at`). `online` is computed from `last_seen_at` with
`NEXTGENT_DEVICE_ONLINE_SECONDS`; unset, it is `null` (unknown) and screens
show `last_seen_at`.

```
GET    /api/companies/{companyId}/devices
POST   /api/companies/{companyId}/devices/pair
DELETE /api/companies/{companyId}/devices/{deviceId}
```

`GET` (any member, or the box with its device token): `{ "devices": [ … ],
"onlineSeconds": 180 }`, linked devices only, each row with `online`.

`POST …/pair` (owners, admins, instance admins) takes the code the box shows:
`{ "code": "ABCD-1234", "name": "Shop box" }` (`name` optional; the code is
matched upper-case). Paperclip mints a DEVICE TOKEN (an agent API key on the
company's assistant with scope `{ "kind": "device", "deviceId" }`), then calls
gcr-api-clean's signed `POST /api/nextgent/nodes/pair {companyId, code, name?,
approvedBy: "paperclip:<userId>", deviceToken}`, which enrols the relay node
(its `entity_slug` comes from `company_links`, never from a session) and hands
the device token to the box through `/pair/poll`. The answer's `node` becomes
the computer row and its `ghostMcpToken` is stored as the company secret
`NEXTGENT_GHOST_MCP_TOKEN` for the assistant; neither token is returned.
Response `201` is the device row. A refused code passes through with
gcr-api-clean's fields; a company without an assistant agent is `409`; without
`GCR_API_URL` and `NEXTGENT_SERVICE_SECRET` the route is `503`. Activity:
`nextgent.device_paired`.

The device token is read-only and held, before any route runs, to four reads in
its own company: `GET …/devices`, `GET …/store`, `GET …/approvals`,
`GET …/activity`. Everything else is `403`. It is revoked when the device is
unlinked.

`DELETE …/devices/{deviceId}` (same roles) asks gcr-api-clean's signed
`POST /api/nextgent/nodes/{nodeId}/revoke {companyId}`, marks the computer and
the phones derived from it `unlinked_at`, and revokes their device tokens.
Response `{ "unlinked": true, "id" }`. Activity: `nextgent.device_unlinked`.
Unlinking the business (`DELETE …/business-link`) does the same for every
device of the company; gcr-api-clean revokes the nodes on its side.

```
POST /api/nextgent/devices/status
```

Signed, from gcr-api-clean's heartbeat on change plus a throttled last_seen:

```json
{ "companyId": "…", "nodeId": "…", "version": "1.3.0", "capabilities": ["sms.send"],
  "phones": [{ "deviceId": "android.primary", "sim": "ready", "number": "+1…", "online": true }],
  "lastSeenAt": "2026-10-04T12:00:00Z" }
```

Upserts the computer row (by `relay_node_id`) and one `android` row per phone
(`device_key` = `deviceId`, `paired_computer_id` = the computer), with
`sim_status`, `phone_number` and `last_seen_at` (a phone reported
`online: false` keeps its last sighting). A node another company's push names
is `409`. Response `{ "computer", "phones" }`.

```
GET /api/admin/nextgent/devices?companyId=&online=
```

Instance admins only: linked devices across companies with `companyName`;
`companyId` narrows to one company, `online` (`true|false`, `1|0`) to one state.

## Invites by email

`POST /api/companies/{companyId}/invites` accepts an optional `email`. The
invite is created as always (a link); then Paperclip asks gcr-api-clean's
signed `POST /api/nextgent/email` to send template `team-invite` with
`business_name`, `inviter`, `role` and `accept_link`
(`OWNER_APP_URL/#/invite/<token>`). The response adds `emailSent` and, when it
was not sent, `emailError`.

## Signed calls from gcr-api-clean

Both carry `x-nextgent-timestamp` (unix seconds), `x-nextgent-nonce` (random,
at least 16 bytes, hex) and `x-nextgent-signature`: hex HMAC-SHA256, with
`NEXTGENT_SERVICE_SECRET`, of

```
${timestamp}\n${nonce}\n${METHOD}\n${pathname}\n${query}\n${sha256hex(rawBody)}
```

(`METHOD` upper-case; `query` the raw query string without its `?`, empty when
there is none; `rawBody` empty when there is none). Paperclip signs its own
calls to gcr-api-clean the same way. Unsigned, stale (over 300 s), replayed
(a nonce seen before inside that window) or mismatched requests get `401` with
a `reason`; a server without the secret answers `503`. Seen nonces are kept in
memory per server process, so a multi-instance deployment needs a shared store
for the replay guard to hold across instances.

The previous format (`${timestamp}.${rawBody}`, no nonce) is accepted only
while `NEXTGENT_ACCEPT_LEGACY_SIGNATURES=true` is set for the switch-over; it
is off by default.

```
POST /api/nextgent/receipts
```

```json
{ "companyId": "…", "taskId": "…", "action": "…", "target": "…", "capability": "…",
  "oldValue": "…", "newValue": "…", "device": "…", "verified": true,
  "at": "…", "evidence": {} }
```

Recorded in the company's Activity (`nextgent.receipt`). With `taskId` (an
issue id or identifier in that company) it is also attached to the task as a
system comment; an unknown task is `404`. `target` may be empty or missing
when the receipt names its `capability` or `action` (the relay's receipts do);
what came is stored as it came. Response `201 { "id", "taskId" }`.

```
POST /api/nextgent/conversations
```

```json
{ "companyId": "…", "conversationId": "…", "channel": "voice", "mode": "…",
  "threadId": "…", "startedAt": "…", "endedAt": "…", "turns": 4, "outcome": "…" }
```

A reference to a conversation gcr-api-clean holds (`live_conversations`):
`conversationId` is its id there; `channel` is `voice` or `sms`; everything
but `companyId` and `channel` is optional. `companyId` may be `"nextgent"`,
which means `NEXTGENT_PLATFORM_COMPANY_ID`. Recorded in Activity
(`nextgent.conversation`) with exactly these fields. The transcript and the
customer's number stay in gcr-api-clean: the older body (`from`, `to`,
`transcript`, `summary`) is still accepted, but those fields are dropped
before anything is written (`turns` is then the transcript's length).
`server/sql/strip-conversation-transcripts.sql` strips them from rows
recorded before this change; the owner applies it by hand. Response
`201 { "id" }`.

```
GET /api/companies/{companyId}/receipts?limit=50&offset=0
```

Any member (not agents). Receipts newest first:

```json
{ "receipts": [{ "id", "companyId", "taskId", "task": { "id", "identifier", "title" },
  "action", "target", "oldValue", "newValue", "device", "verified", "at",
  "evidence", "recordedAt" }], "total": 12, "limit": 50, "offset": 0 }
```

`limit` is 1–200 (default 50).

## Setup jobs

- **Sign-up** (company created through `POST /api/companies`, self-serve or
  with any NEXT GENT setting present): a LiteLLM key for the company
  (`LITELLM_URL`, `LITELLM_MASTER_KEY`, optional `LITELLM_COMPANY_BUDGET`,
  `LITELLM_BUDGET_DURATION`), stored as company secret `NEXTGENT_LITELLM_KEY`,
  and the company's assistant agent (`NEXTGENT_ASSISTANT_NAME`). Each step is
  skipped with a warning when its settings are missing; a failed step never
  undoes the sign-up. Nothing from the store is installed.
- **Agent runs** of a company with a LiteLLM key get `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_API_KEY` pointing at
  LiteLLM with that key, unless the agent, project or routine sets them, or
  the agent uses its own AI connection.

## Store installs

A release payload may carry a `nextgent` section:

```json
{
  "nextgent": {
    "kind": "agent",
    "permissions": [{ "permission": "availability:read", "reason": "See what is open" }],
    "handoff": { "itemKey": "review-agent", "agentKey": "review", "title": "Send a review request" }
  }
}
```

`kind` is `agent` | `app` | `automation`; permissions are `resource:action`,
each with a `reason` and optionally `optional: true` (the owner may decline it
at install with `declinedPermissions: [...]`; a new optional permission never
holds an update, it is simply not granted). An app release also carries its
manifest as `payload.app`, kept whole; a layout release carries `payload.layout`
(an object with at least `id` and `version`).
`handoff` (automations only) names the agent work is given to, from this
release or another installed item (`itemKey`).

An `app` item's release passes a gate before it is stored (the full rule set is
`@nextgent/app-engine` `validateManifest`; this is the minimum until that
package installs here): `payload.nextgent.kind` is `"app"`, and `payload.app`
is an object with `schema_version`, `id` equal to the item key, `version` equal
to the release version (which must be semver), `runtime.type: "engine"`, a
`ui` object and a `permissions` array. A refusal is `400` naming the field,
e.g. `payload.app.runtime.type`.

```
GET /api/companies/{companyId}/store
```

Each listing carries, beyond the item and update fields: `installId` (the
`store_installs` row, null before install), `installEnabled`, `versionId` (the
installed release, or the latest on the channel), `app` (that release's
manifest for an `app` item, null for other kinds), `price` (`{ amountCents,
currency, interval, model }` or null) and `approvedPermissions`.

```
GET /api/companies/{companyId}/store/{itemId}/consent
```

What the install screen shows: `needsAccessTo` (permission, resource, action,
reason, `changesThings` for write/send), `allowed`, `reason`, and
`charge: { priceCents, interval }` from gcr-api-clean's entitlement.

`POST /api/companies/{companyId}/store/{itemId}/install` now:

1. asks gcr-api-clean `GET /api/nextgent/entitlement`; not allowed is `402`
   with `code: "not_entitled"` and the price;
2. creates the item's content and the install;
3. for an automation with a hand-off, creates that agent's routine with a
   webhook trigger (`signingMode: "hmac_sha256"`) — needs `PAPERCLIP_API_URL`
   or a public origin for the webhook URL;
4. calls `POST /api/nextgent/installs` with the release's permissions (and
   the routine's `webhookUrl`/`webhookSecret`), the manifest as `app` (a
   layout's as `layout`, never `app`) and the install's `enabled` switch. An `app` or `layout` item is registered even
   when its release has no NEXT GENT section, so gcr-api-clean can project it
   into the business's page;
5. stores a returned token as a company secret and binds it to the install's
   agents in the business-data plugin, so those agents act with only what was
   approved.

Any failure rolls the install back. The response adds `charge` (the price)
and `charged` (whether gcr-api-clean billed it now).

```
POST /api/companies/{companyId}/installs/{installId}/token
```

Members (not viewers). A short-lived session token for the screen that draws
an installed app: `{ "token": "…", "expiresAt": "…" }`, minted by
gcr-api-clean's signed `POST /api/nextgent/installs/{installId}/session` (at
most 300 s). It can only touch what the owner approved for that install and
dies with the install. The install's long-lived token stays a server-side
secret and is never sent to a browser; without `GCR_API_URL` and
`NEXTGENT_SERVICE_SECRET` the route answers `503`.

```
POST /api/companies/{companyId}/store/{itemId}/enable
```

Owners and admins. Turns on an install an admin pushed switched off: plan
check, content, registration with gcr-api-clean (`declinedPermissions`
optional), then `PATCH /api/nextgent/installs/{installId}` with
`{ enabled: true }`. This is the owner's consent.

A version move that changes no permissions (an automatic update, a push, an
owner's update) is sent to gcr-api-clean as
`PATCH /api/nextgent/installs/{installId}` with `{ version, app }` (`{ version,
layout }` for a layout, which never sends `app`), so the projection follows
the release. One that changes permissions
re-registers with `POST /api/nextgent/installs` as before.

Agents an install creates carry `metadata.storeItemKey`, `metadata.installId`
and `metadata.storeItem` (`itemId`, `itemKey`, `resourceKey`), so apps can tie
an agent to its store item without matching names.

Uninstall calls `DELETE /api/nextgent/installs/{installId}` first (gcr-api-clean
switches an app's projection off and keeps its data), then removes the content
and the token secret.

A new release asking for permissions an install has not approved never applies
on its own, not even a required security release: the listing shows
`needsApproval: true` and `updateNewPermissions`, the release response lists
`needsApprovalFor`, and `POST …/update` answers `409 { code: "needs_approval",
newPermissions, needsAccessTo }` until it is sent with
`{ "approvePermissions": true }`, which re-registers the install with the new
permissions.

Without `GCR_API_URL` and `NEXTGENT_SERVICE_SECRET`, entitlement and
registration are skipped with a warning (dev only).

## Store administration (contract §12)

Instance admins only.

- `GET /api/store/admin/meta` — `kinds` (`plugin`, `pack`, `skill`,
  `automation`, `connector`, `agent`, `app`, `layout`; the database
  constraint), `channels`, `advisoryTypes`, `approvalModes`,
  `forceableAdvisory`, `actions` (`apply`, `force` with `force: true`),
  `audienceModes` (`all`; `companies` with `needs: "companies"`; `channel`
  with its `options`; `kind` with `options` `[{ key, count }]` from
  gcr-api-clean, empty when it is not configured), and `priceModels`,
  `intervals`, `currency` from
  `NEXTGENT_STORE_PRICE_MODELS`, `NEXTGENT_STORE_PRICE_INTERVALS`,
  `NEXTGENT_STORE_CURRENCY`.
- `POST /api/store/admin/items/{itemId}/deploy/preview` and `…/deploy` —
  body `{ version, action, audience: { mode, companyIds?, values? }, notes? }`.
  The preview answers `{ targeted, apply, skip, needsConsent, reasons,
  companies: [{ companyId, outcome, reason }] }` without changing anything.
  `apply` moves installs on automatic updates and on a channel the release is
  on; `force` also moves manual ones and other channels (security fixes,
  rollbacks). A release asking for new data access is never pushed or forced
  (`needs_consent`). Audience `kind` takes business kinds (`values`). The kinds,
  and which companies have each, come from gcr-api-clean's signed
  `GET /api/nextgent/business-kinds` (`[{ key, count, companyIds }]`); meta
  lists `{ key, count }`. Paperclip keeps no copy: without gcr-api-clean the
  list is empty and a `kind` push targets nobody. `installMissing: true` also
  installs where the item is missing (audience `all` then means every
  company); those installs start switched off (`enabled: false`, owner turns
  them on) unless `enabled: true` and the release needs no data and has no
  price. Pushes cannot reach listings that are not linked to a company. Skip reasons: `not_installed`, `already_on_version`,
  `needs_consent`, `manual_updates`, `other_channel`, `failed`. `deploy`
  records the push and answers `201 { deployment, applied, skipped,
  needsConsent, reasons, companies, failedFor }`.
- `GET /api/store/admin/deployments` — pushes, newest first, with
  `itemName`, `itemKey`, `kind`.
- `GET /api/store/admin/items/{itemId}/installs` — each company with the item:
  `installId`, `companyId`, `companyName`, `version`, `latestVersion`,
  `channel`, `approvalMode`, `status` (`current` | `update_available` |
  `needs_approval`), `approvedPermissions`, `installedAt`.
- `PUT /api/store/admin/items/{itemId}/price` — `{ amountCents, currency?,
  interval?, model? }`. Forwarded first to gcr-api-clean
  `PUT /api/nextgent/items/{itemKey}/price` (signed), which entitlement and
  install charges read; only then stored on the item (`price` in
  `GET /api/store/admin/items`). Without a currency, `NEXTGENT_STORE_CURRENCY`
  is used; with neither, `422`.
- A `layout` item's release payload carries `layout` (an object with at least
  `id` and `version`); a release without it is refused. It puts nothing inside
  a company; like an app it is registered with gcr-api-clean on install.
