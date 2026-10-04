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

## Signed calls from gcr-api-clean

Both carry `x-nextgent-timestamp` (unix seconds) and `x-nextgent-signature`
(hex HMAC-SHA256 of `${timestamp}.${rawBody}` with `NEXTGENT_SERVICE_SECRET`).
Unsigned, stale (over 300 s) or mismatched requests get `401`; a server without
the secret answers `503`.

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
{ "companyId": "…", "channel": "voice", "from": "…", "to": "…",
  "transcript": [{ "role": "…", "text": "…", "at": "…" }],
  "summary": "…", "outcome": "…" }
```

`companyId` may be `"nextgent"`, which means `NEXTGENT_PLATFORM_COMPANY_ID`.
Recorded in Activity (`nextgent.conversation`). Response `201 { "id" }`.

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

`kind` is `agent` | `app` | `automation`; permissions are `resource:action`;
`handoff` (automations only) names the agent work is given to, from this
release or another installed item (`itemKey`).

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
   the routine's `webhookUrl`/`webhookSecret`);
5. stores a returned token as a company secret and binds it to the install's
   agents in the business-data plugin, so those agents act with only what was
   approved.

Any failure rolls the install back. The response adds `charge` (the price)
and `charged` (whether gcr-api-clean billed it now).

Uninstall calls `DELETE /api/nextgent/installs/{installId}` first, then removes
the content and the token secret.

A new release asking for permissions an install has not approved never applies
on its own, not even a required security release: the listing shows
`needsApproval: true` and `updateNewPermissions`, the release response lists
`needsApprovalFor`, and `POST …/update` answers `409 { code: "needs_approval",
newPermissions, needsAccessTo }` until it is sent with
`{ "approvePermissions": true }`, which re-registers the install with the new
permissions.

Without `GCR_API_URL` and `NEXTGENT_SERVICE_SECRET`, entitlement and
registration are skipped with a warning (dev only).
