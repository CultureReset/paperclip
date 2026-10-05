---
title: NEXT GENT wiring
summary: Business tokens, the business link, signed calls with gcr-api-clean, and store installs
---

These endpoints connect Paperclip (accounts, agents, work, store) with
gcr-api-clean (business data). One Paperclip company is one business. Every
setting is an environment variable listed in `.env.example`.

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
company secret `NEXTGENT_BUSINESS_TOKEN`, records the slug and forwarding
address, and writes the business-data plugin's config so the company's agents
can use it. The token is never returned. Response `201`:

```json
{ "entitySlug": "the-business", "forwardingAddress": "…" }
```

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
`{ "linked": true, "entitySlug", "forwardingAddress", "linkedAt" }`.

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
{ "companyId": "…", "taskId": "…", "action": "…", "target": "…",
  "oldValue": "…", "newValue": "…", "device": "…", "verified": true,
  "at": "…", "evidence": {} }
```

Recorded in the company's Activity (`nextgent.receipt`). With `taskId` (an
issue id or identifier in that company) it is also attached to the task as a
system comment; an unknown task is `404`. Response `201 { "id", "taskId" }`.

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
  with its `options`), and `priceModels`, `intervals`, `currency` from
  `NEXTGENT_STORE_PRICE_MODELS`, `NEXTGENT_STORE_PRICE_INTERVALS`,
  `NEXTGENT_STORE_CURRENCY`.
- `POST /api/store/admin/items/{itemId}/deploy/preview` and `…/deploy` —
  body `{ version, action, audience: { mode, companyIds?, values? }, notes? }`.
  The preview answers `{ targeted, apply, skip, needsConsent, reasons,
  companies: [{ companyId, outcome, reason }] }` without changing anything.
  `apply` moves installs on automatic updates and on a channel the release is
  on; `force` also moves manual ones and other channels (security fixes,
  rollbacks). A release asking for new data access is never pushed or forced
  (`needs_consent`). Audience `kind` takes business kinds (`values`), listed in
  meta from the kinds of linked businesses. `installMissing: true` also
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
