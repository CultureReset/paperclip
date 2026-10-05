# Proof 4: Step 4, the business bridge, over real HTTP (Paperclip ⇄ gcr-api-clean)

Run at 2026-10-05T01:06:33.196Z.

Paperclip at `http://127.0.0.1:4600` (real routes/store.ts + routes/nextgent.ts + routes/activity.ts on embedded Postgres with all migrations), gcr-api-clean at `http://127.0.0.1:4610` (real routes/nextgent.js, routes/owner.js and lib/liveAgent.js on scripts/lib/memdb.js). Shared NEXTGENT_SERVICE_SECRET; gcr's PAPERCLIP_API_URL and PAPERCLIP_ISSUER are the Paperclip URL. Read-only on both repos.

Repo state at run time:
```
9861fc7 Docs: Paperclip owns platform state, gcr-api-clean + cyber check own business state, the bridge connects them
---
1307a10 Paperclip gets a conversation reference, owners read the conversation (DECISIONS #34, #36)
```

Paperclip company A: `7068529b-8993-466d-bc59-885129d5f493` (owner `user-ce473b60-f52a-409a-8fce-3a7db624e594`); company B: `4f3951f6-a3c5-49b2-a61b-53b9dbdd4b5c` (owner `user-2346e929-ee74-4e6d-8019-4f2da3bb345f`). Both created by direct insert into companies + an owner membership.

## Step 1: Link company A to a new business; Paperclip's link holds the reference only (DECISIONS #32, #33, #40)

`POST {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/business-link` (Paperclip as owner A) → **201**
request body:
```json
{
  "create": {
    "name": "Proof Diner",
    "kind": "cafe"
  }
}
```
response:
```json
{
  "entitySlug": "proof-diner",
  "forwardingAddress": "gcr-proof-diner@parse.example.test"
}
```
- PASS: link answered 201 with the slug gcr-api-clean created
`GET {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/business-link` (Paperclip as owner A) → **200**
response:
```json
{
  "linked": true,
  "entitySlug": "proof-diner",
  "linkedAt": "2026-10-05T01:06:45.136Z"
}
```
- PASS: GET business-link is exactly {linked, entitySlug, linkedAt}
- PASS: no forwardingAddress / businessKind in the GET response
Paperclip Postgres: nextgent_business_links rows:
```json
[
  {
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "entity_slug": "proof-diner",
    "business_token_secret_id": "f059821f-2ece-43c0-9c76-f7f960014042",
    "linked_by_user_id": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "linked_at": "2026-10-05 01:06:45.136132+00",
    "updated_at": "2026-10-05 01:06:45.136132+00"
  }
]
```
Paperclip Postgres: information_schema.columns for nextgent_business_links:
```json
[
  {
    "column_name": "company_id",
    "data_type": "uuid"
  },
  {
    "column_name": "entity_slug",
    "data_type": "text"
  },
  {
    "column_name": "business_token_secret_id",
    "data_type": "uuid"
  },
  {
    "column_name": "linked_by_user_id",
    "data_type": "text"
  },
  {
    "column_name": "linked_at",
    "data_type": "timestamp with time zone"
  },
  {
    "column_name": "updated_at",
    "data_type": "timestamp with time zone"
  }
]
```
Paperclip Postgres: nextgent_business_links_archive_0293 (table, columns):
```json
{
  "table": [
    {
      "table_name": "nextgent_business_links_archive_0293"
    }
  ],
  "columns": [
    {
      "column_name": "company_id"
    },
    {
      "column_name": "business_kind"
    },
    {
      "column_name": "forwarding_address"
    },
    {
      "column_name": "archived_at"
    }
  ]
}
```
Paperclip Postgres: drizzle.__drizzle_migrations tail:
```json
[
  {
    "id": 292,
    "hash": "3310402a23dba92450599d479799cf4fa2c24a9b70863b3c3d7260bd0f440bd1",
    "created_at": "1791161278046"
  },
  {
    "id": 291,
    "hash": "d045fb5a9b848e4f660301ec9e21f2927034cdf87948cc4d2eb87bcf8b7ae9c1",
    "created_at": "1791157696153"
  },
  {
    "id": 290,
    "hash": "1b1ef71e62ce3d9426e2db30ebcf2b4992d42236729746c8c42870e26dc86fd3",
    "created_at": "1791149542497"
  }
]
```
- PASS: the row exists for company A with the slug
- PASS: table columns are exactly company_id, entity_slug, business_token_secret_id, linked_by_user_id, linked_at, updated_at
- PASS: no business_kind / forwarding_address column
- PASS: migration 0293 ran: nextgent_business_links_archive_0293 exists with company_id, business_kind, forwarding_address, archived_at
drizzle journal last entry: `0293_nextgent_business_links_archive_business_facts` (idx 293); migrations logged in the database: latest id 292
- PASS: journal's last migration is 0293 and the database's newest drizzle migration row has 0293's `when` as its created_at
gcr memdb: entity:
```json
[
  {
    "id": "id-1",
    "created_at": "2026-10-05T01:06:45.062Z",
    "slug": "proof-diner",
    "name": "Proof Diner",
    "entity_type": "cafe",
    "phone": null,
    "website_url": null,
    "is_active": false,
    "show_in_listings": false
  }
]
```
gcr memdb: company_links:
```json
[
  {
    "id": "id-2",
    "created_at": "2026-10-05T01:06:45.062Z",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "entity_slug": "proof-diner",
    "linked_by": "paperclip:link"
  }
]
```
- PASS: gcr has entity_type 'cafe' on the entity (gcr is where the kind lives)
- PASS: the link call reached gcr signed
`POST {paperclip}/api/companies/4f3951f6-a3c5-49b2-a61b-53b9dbdd4b5c/business-link` (Paperclip as ownerB) → **201**
request body:
```json
{
  "create": {
    "name": "Proof Plumbing",
    "kind": "plumber"
  }
}
```
response:
```json
{
  "entitySlug": "proof-plumbing",
  "forwardingAddress": "gcr-proof-plumbing@parse.example.test"
}
```
- PASS: company B linked to its own new business

## Step 2: Business kinds come live from gcr (DECISIONS #32): admin meta → signed GET /api/nextgent/business-kinds; a kind-audience push targets the company

gcr memdb: entity 'proof-diner' after setting entity_type = restaurant:
```json
[
  {
    "id": "id-1",
    "created_at": "2026-10-05T01:06:45.062Z",
    "slug": "proof-diner",
    "name": "Proof Diner",
    "entity_type": "restaurant",
    "phone": null,
    "website_url": null,
    "is_active": false,
    "show_in_listings": false
  }
]
```
`GET {paperclip}/api/store/admin/meta` (Paperclip as admin) → **200**
response (selected):
```json
{
  "audienceModes": [
    {
      "key": "all"
    },
    {
      "key": "companies",
      "needs": "companies"
    },
    {
      "key": "channel",
      "options": [
        "stable",
        "fast"
      ]
    },
    {
      "key": "kind",
      "options": [
        {
          "key": "plumber",
          "count": 1
        },
        {
          "key": "restaurant",
          "count": 1
        }
      ]
    }
  ]
}
```
- PASS: meta 200 with audienceModes.kind.options
- PASS: options include exactly {key:'restaurant', count:1} (the console gets key and count; company ids stay in the planner)
- PASS: options include {key:'plumber', count:1} for company B and no 'cafe' (the earlier value is gone: nothing is cached in Paperclip)
gcr inbound /api/nextgent calls during meta:
```json
[
  {
    "at": "2026-10-05T01:06:45.310Z",
    "method": "GET",
    "path": "/api/nextgent/business-kinds",
    "signed": true,
    "body": null
  }
]
```
- PASS: gcr saw a signed GET /api/nextgent/business-kinds
- PASS: engine toStorePublication accepts the shipped QR Menu manifest
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-qr-menu",
  "kind": "app",
  "name": "QR Menu",
  "summary": "A live menu customers scan at the table.",
  "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone."
}
```
response (selected):
```json
{
  "id": "6a16232b-f430-4646-afba-02fbc9f3fe25",
  "key": "core-qr-menu",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/6a16232b-f430-4646-afba-02fbc9f3fe25/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "permission": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ]
    },
    "app": "<manifest core-qr-menu@1.0.0, 2438 bytes>"
  },
  "channel": "stable",
  "changelog": "First release"
}
```
response (selected):
```json
{
  "appliedTo": 0,
  "pendingFor": 0
}
```
`POST {paperclip}/api/store/admin/items/6a16232b-f430-4646-afba-02fbc9f3fe25/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: item created, version 1.0.0 accepted, published
`POST {paperclip}/api/store/admin/items/6a16232b-f430-4646-afba-02fbc9f3fe25/deploy/preview` (Paperclip as admin) → **200**
request body:
```json
{
  "version": "1.0.0",
  "action": "apply",
  "audience": {
    "mode": "kind",
    "values": [
      "restaurant"
    ]
  },
  "installMissing": true,
  "enabled": true
}
```
response:
```json
{
  "targeted": 1,
  "apply": 0,
  "install": 1,
  "installSwitchedOff": 1,
  "skip": 0,
  "needsConsent": 0,
  "reasons": {},
  "companies": [
    {
      "companyId": "7068529b-8993-466d-bc59-885129d5f493",
      "outcome": "install",
      "reason": null,
      "enabled": false
    }
  ]
}
```
- PASS: preview 200
- PASS: preview targets company A and not company B
- PASS: the preview asked gcr for the kinds (signed GET business-kinds)
`POST {paperclip}/api/store/admin/items/6a16232b-f430-4646-afba-02fbc9f3fe25/deploy` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "action": "apply",
  "audience": {
    "mode": "kind",
    "values": [
      "restaurant"
    ]
  },
  "installMissing": true,
  "enabled": true
}
```
response:
```json
{
  "deployment": {
    "id": "3f798dc2-6e90-4a76-ab21-ce214d302278",
    "itemId": "6a16232b-f430-4646-afba-02fbc9f3fe25",
    "versionId": "e9685fea-eee3-4ac7-866f-68746e60d26a",
    "version": "1.0.0",
    "action": "apply",
    "audience": {
      "mode": "kind",
      "values": [
        "restaurant"
      ]
    },
    "notes": null,
    "status": "completed",
    "targeted": 1,
    "applied": 1,
    "skipped": 0,
    "needsConsent": 0,
    "failed": 0,
    "reasons": {},
    "createdByUserId": "proof-admin",
    "createdAt": "2026-10-05T01:06:45.463Z"
  },
  "targeted": 1,
  "apply": 0,
  "install": 1,
  "installSwitchedOff": 1,
  "skip": 0,
  "needsConsent": 0,
  "reasons": {},
  "companies": [
    {
      "companyId": "7068529b-8993-466d-bc59-885129d5f493",
      "outcome": "install",
      "reason": null,
      "enabled": false
    }
  ],
  "applied": 1,
  "skipped": 0,
  "failedFor": []
}
```
- PASS: deploy: targeted 1 (company A), install 1, no failures
QR Menu declares permissions (menu:read, menu:write), so the push installs it switched off pending the owner's consent (services/store.ts:300 `startOn` needs no permissions and no price); nothing goes to gcr until the owner enables it. The owner of company A enables it now, which is what proves the push landed on A's business.
- PASS: company A has the install (switched off)
`POST {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/store/6a16232b-f430-4646-afba-02fbc9f3fe25/enable` (Paperclip as owner A) → **200**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "2ae77780-1f19-4769-b3c5-4af08d79f650",
  "enabled": true,
  "approvedPermissions": [
    "menu:read",
    "menu:write"
  ],
  "tokenSecretId": "1b229fce-74c5-454f-b293-61f0ddb2de03"
}
```
- PASS: owner A enable → 200, enabled true
gcr memdb: nextgent_installs:
```json
[
  {
    "install_id": "2ae77780-1f19-4769-b3c5-4af08d79f650",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "entity_slug": "proof-diner",
    "item_key": "core-qr-menu",
    "status": "active"
  }
]
```
- PASS: gcr registered the install for company A's business only
`GET {paperclip}/api/companies/4f3951f6-a3c5-49b2-a61b-53b9dbdd4b5c/store` (Paperclip as ownerB) → **200**
response (selected):
```json
[
  {
    "id": "6a16232b-f430-4646-afba-02fbc9f3fe25",
    "installed": false
  }
]
```
- PASS: company B's listing shows the item not installed

## Step 3: A closed SMS conversation in gcr posts a REFERENCE to Paperclip (DECISIONS #34, #41): no transcript, no phone number

gcr memdb: seeded message_threads row:
```json
{
  "id": "thread-1",
  "entity_slug": "proof-diner",
  "channel": "sms",
  "customer_address": "+15550123456"
}
```
gcr memdb: seeded live_conversations row (open, 3 turns, caller number in from_number and in the text):
```json
{
  "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
  "channel": "sms",
  "mode": "business",
  "entity_slug": "proof-diner",
  "company_id": "7068529b-8993-466d-bc59-885129d5f493",
  "from_number": "+15550123456",
  "to_number": "+15550200000",
  "provider_ref": null,
  "transcript": [
    {
      "role": "caller",
      "text": "Hi, this is a customer at +15550123456, do you have gluten-free pancakes?",
      "at": "2026-10-05T01:01:45.594Z"
    },
    {
      "role": "agent",
      "text": "Yes, we do. Would you like to book a table?",
      "at": "2026-10-05T01:02:45.594Z"
    },
    {
      "role": "caller",
      "text": "Yes please, 7pm for two. My number is 555-012-3456.",
      "at": "2026-10-05T01:03:45.594Z"
    }
  ],
  "tool_calls": [],
  "status": "open",
  "state": "answered",
  "started_at": "2026-10-05T01:01:45.594Z",
  "last_activity_at": "2026-10-05T01:06:45.597Z"
}
```
`POST {gcr}/__proof/close-conversation` (gcr-api-clean) → **200**
request body:
```json
{
  "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
  "outcome": "booked"
}
```
response:
```json
{
  "closed": {
    "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
    "channel": "sms",
    "mode": "business",
    "entity_slug": "proof-diner",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "from_number": "+15550123456",
    "to_number": "+15550200000",
    "provider_ref": null,
    "transcript": [
      {
        "role": "caller",
        "text": "Hi, this is a customer at +15550123456, do you have gluten-free pancakes?",
        "at": "2026-10-05T01:01:45.594Z"
      },
      {
        "role": "agent",
        "text": "Yes, we do. Would you like to book a table?",
        "at": "2026-10-05T01:02:45.594Z"
      },
      {
        "role": "caller",
        "text": "Yes please, 7pm for two. My number is 555-012-3456.",
        "at": "2026-10-05T01:03:45.594Z"
      }
    ],
    "tool_calls": [],
    "status": "closed",
    "state": "answered",
    "started_at": "2026-10-05T01:01:45.594Z",
    "last_activity_at": "2026-10-05T01:06:45.604Z",
    "ended_at": "2026-10-05T01:06:45.604Z",
    "outcome": "booked",
    "recorded_at": "2026-10-05T01:06:45.677Z",
    "record_error": null
  },
  "row": {
    "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
    "channel": "sms",
    "mode": "business",
    "entity_slug": "proof-diner",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "from_number": "+15550123456",
    "to_number": "+15550200000",
    "provider_ref": null,
    "transcript": [
      {
        "role": "caller",
        "text": "Hi, this is a customer at +15550123456, do you have gluten-free pancakes?",
        "at": "2026-10-05T01:01:45.594Z"
      },
      {
        "role": "agent",
        "text": "Yes, we do. Would you like to book a table?",
        "at": "2026-10-05T01:02:45.594Z"
      },
      {
        "role": "caller",
        "text": "Yes please, 7pm for two. My number is 555-012-3456.",
        "at": "2026-10-05T01:03:45.594Z"
      }
    ],
    "tool_calls": [],
    "status": "closed",
    "state": "answered",
    "started_at": "2026-10-05T01:01:45.594Z",
    "last_activity_at": "2026-10-05T01:06:45.604Z",
    "ended_at": "2026-10-05T01:06:45.604Z",
    "outcome": "booked",
    "recorded_at": "2026-10-05T01:06:45.677Z",
    "record_error": null
  }
}
```
- PASS: closeConversation ran: status closed, ended_at set, recorded_at set, record_error null
Paperclip inbound /api/nextgent calls during close:
```json
[
  {
    "at": "2026-10-05T01:06:45.659Z",
    "method": "POST",
    "path": "/api/nextgent/conversations",
    "signed": true,
    "body": {
      "companyId": "7068529b-8993-466d-bc59-885129d5f493",
      "conversationId": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
      "channel": "sms",
      "mode": "business",
      "threadId": "thread-1",
      "startedAt": "2026-10-05T01:01:45.594Z",
      "endedAt": "2026-10-05T01:06:45.604Z",
      "turns": 3,
      "outcome": "booked"
    }
  }
]
```
- PASS: Paperclip received one signed POST /api/nextgent/conversations
- PASS: the body is exactly the reference shape (companyId + {conversationId, channel, mode, threadId, startedAt, endedAt, turns, outcome})
- PASS: the wire body has no transcript text and no phone number
`GET {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/activity?limit=200` (Paperclip as owner A) → **200**
response:
```json
[
  {
    "id": "a994d594-54ba-4269-a86b-7a772ea3782a",
    "companyId": "7068529b-8993-466d-bc59-885129d5f493",
    "actorType": "system",
    "actorId": "nextgent",
    "action": "nextgent.conversation",
    "entityType": "nextgent_conversation",
    "entityId": "308d3c07-6cad-4e97-a362-1857087c1a75",
    "agentId": null,
    "runId": null,
    "responsibleUserId": null,
    "details": {
      "mode": "business",
      "turns": 3,
      "channel": "sms",
      "endedAt": "2026-10-05T01:06:45.604Z",
      "outcome": "booked",
      "threadId": "thread-1",
      "startedAt": "2026-10-05T01:01:45.594Z",
      "conversationId": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5"
    },
    "createdAt": "2026-10-05T01:06:45.667Z"
  },
  {
    "id": "72fee577-a7e7-4a72-8488-03fd61a849cb",
    "companyId": "7068529b-8993-466d-bc59-885129d5f493",
    "actorType": "user",
    "actorId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "action": "nextgent.install_authorized",
    "entityType": "store_item",
    "entityId": "6a16232b-f430-4646-afba-02fbc9f3fe25",
    "agentId": null,
    "runId": null,
    "responsibleUserId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "details": {
      "kind": "app",
      "itemKey": "core-qr-menu",
      "version": "***REDACTED***",
      "permissions": [
        "menu:read",
        "menu:write"
      ]
    },
    "createdAt": "2026-10-05T01:06:45.570Z"
  },
  {
    "id": "f5db163c-5bf6-4df9-8db5-770a90cc1348",
    "companyId": "7068529b-8993-466d-bc59-885129d5f493",
    "actorType": "user",
    "actorId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "action": "store.content_synced",
    "entityType": "store_item",
    "entityId": "6a16232b-f430-4646-afba-02fbc9f3fe25",
    "agentId": null,
    "runId": null,
    "responsibleUserId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "details": {
      "agents": 0,
      "skills": 0,
      "itemKey": "core-qr-menu",
      "removed": 0,
      "routines": 0
    },
    "createdAt": "2026-10-05T01:06:45.502Z"
  },
  {
    "id": "800d0345-653c-4339-aba3-da73caca4044",
    "companyId": "7068529b-8993-466d-bc59-885129d5f493",
    "actorType": "user",
    "actorId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "action": "nextgent.business_linked",
    "entityType": "company",
    "entityId": "7068529b-8993-466d-bc59-885129d5f493",
    "agentId": null,
    "runId": null,
    "responsibleUserId": "user-ce473b60-f52a-409a-8fce-3a7db624e594",
    "details": {
      "created": true,
      "entitySlug": "proof-diner"
    },
    "createdAt": "2026-10-05T01:06:45.150Z"
  }
]
```
Paperclip activity rows with action nextgent.conversation:
```json
[
  {
    "id": "a994d594-54ba-4269-a86b-7a772ea3782a",
    "companyId": "7068529b-8993-466d-bc59-885129d5f493",
    "actorType": "system",
    "actorId": "nextgent",
    "action": "nextgent.conversation",
    "entityType": "nextgent_conversation",
    "entityId": "308d3c07-6cad-4e97-a362-1857087c1a75",
    "agentId": null,
    "runId": null,
    "responsibleUserId": null,
    "details": {
      "mode": "business",
      "turns": 3,
      "channel": "sms",
      "endedAt": "2026-10-05T01:06:45.604Z",
      "outcome": "booked",
      "threadId": "thread-1",
      "startedAt": "2026-10-05T01:01:45.594Z",
      "conversationId": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5"
    },
    "createdAt": "2026-10-05T01:06:45.667Z"
  }
]
```
- PASS: activity has exactly one nextgent.conversation entry
- PASS: details is exactly {conversationId, channel, mode, threadId, startedAt, endedAt, turns, outcome} with turns 3
- PASS: nothing of the transcript and no phone number anywhere in the activity JSON
Paperclip Postgres: activity_log rows (action nextgent.conversation) for company A:
```json
[
  {
    "id": "a994d594-54ba-4269-a86b-7a772ea3782a",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "action": "nextgent.conversation",
    "entity_type": "nextgent_conversation",
    "entity_id": "308d3c07-6cad-4e97-a362-1857087c1a75",
    "details": {
      "mode": "business",
      "turns": 3,
      "channel": "sms",
      "endedAt": "2026-10-05T01:06:45.604Z",
      "outcome": "booked",
      "threadId": "thread-1",
      "startedAt": "2026-10-05T01:01:45.594Z",
      "conversationId": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5"
    },
    "created_at": "2026-10-05 01:06:45.667217+00"
  }
]
```
- PASS: the stored activity_log row carries the same reference and nothing else

## Step 4: gcr owner routes with a Paperclip business token (DECISIONS #36): list without bodies or numbers, detail with the transcript, bogus id 404

`POST {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/business-token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T01:11:45.000Z"
}
```
- PASS: business token issued for company A (JWT)
`GET {gcr}/api/owner/conversations` (gcr-api-clean, Bearer token) → **200**
response:
```json
{
  "conversations": [
    {
      "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
      "channel": "sms",
      "mode": "business",
      "started_at": "2026-10-05T01:01:45.594Z",
      "ended_at": "2026-10-05T01:06:45.604Z",
      "outcome": "booked",
      "turns": 3
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```
- PASS: list 200 with one conversation, total 1
- PASS: list row is {id, channel, mode, started_at, ended_at, outcome, turns} for the conversation
- PASS: list carries no bodies and no numbers
`GET {gcr}/api/owner/conversations/bb481ee3-4bf8-410f-acf5-a73a0714b6c5` (gcr-api-clean, Bearer token) → **200**
response:
```json
{
  "conversation": {
    "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
    "channel": "sms",
    "mode": "business",
    "started_at": "2026-10-05T01:01:45.594Z",
    "ended_at": "2026-10-05T01:06:45.604Z",
    "outcome": "booked",
    "turns": 3,
    "from": "+15550123456",
    "to": "+15550200000",
    "status": "closed",
    "transcript": [
      {
        "role": "caller",
        "text": "Hi, this is a customer at +15550123456, do you have gluten-free pancakes?",
        "at": "2026-10-05T01:01:45.594Z"
      },
      {
        "role": "agent",
        "text": "Yes, we do. Would you like to book a table?",
        "at": "2026-10-05T01:02:45.594Z"
      },
      {
        "role": "caller",
        "text": "Yes please, 7pm for two. My number is 555-012-3456.",
        "at": "2026-10-05T01:03:45.594Z"
      }
    ],
    "tool_calls": []
  }
}
```
- PASS: detail 200 with the 3-turn transcript, from/to, status, tool_calls
`GET {gcr}/api/owner/conversations/b86b4673-407b-477c-a4ef-de8a2ce149d1` (gcr-api-clean, Bearer token) → **404**
response:
```json
{
  "error": "No such conversation."
}
```
- PASS: a bogus id → 404
`GET {gcr}/api/owner/conversations/not-a-uuid` (gcr-api-clean, Bearer token) → **404**
response:
```json
{
  "error": "No such conversation."
}
```
- PASS: a non-uuid id → 404

## Step 5: Signing and slug checks still hold: unsigned 401, replayed nonce 401, company B cannot read company A's conversations

`GET {gcr}/api/nextgent/business-kinds` (gcr-api-clean) → **401**
response:
```json
{
  "error": "Missing or malformed signature."
}
```
- PASS: unsigned GET /api/nextgent/business-kinds → 401
signed with gcr's lib/serviceSigning.signHeaders (shared secret from the environment): ```json
{
  "x-nextgent-timestamp": "1791162405",
  "x-nextgent-nonce": "b34bf5ef56ed0b612cba78bbe2bac211",
  "x-nextgent-signature": "69be8caf6da809bb…"
}
```
`GET {gcr}/api/nextgent/business-kinds` (gcr-api-clean, headers: x-nextgent-timestamp, x-nextgent-nonce, x-nextgent-signature) → **200**
response:
```json
[
  {
    "key": "plumber",
    "count": 1,
    "companyIds": [
      "4f3951f6-a3c5-49b2-a61b-53b9dbdd4b5c"
    ]
  },
  {
    "key": "restaurant",
    "count": 1,
    "companyIds": [
      "7068529b-8993-466d-bc59-885129d5f493"
    ]
  }
]
```
- PASS: the fresh signed request → 200 with the kinds
`GET {gcr}/api/nextgent/business-kinds` (gcr-api-clean, headers: x-nextgent-timestamp, x-nextgent-nonce, x-nextgent-signature) → **401**
response:
```json
{
  "error": "Replayed request (nonce already seen)."
}
```
- PASS: the same request again (same nonce, same signature) → 401 replayed
`GET {gcr}/api/nextgent/business-kinds` (gcr-api-clean, headers: x-nextgent-timestamp, x-nextgent-nonce, x-nextgent-signature) → **401**
response:
```json
{
  "error": "Signature is too old."
}
```
- PASS: a 400 s old signature → 401 too old
`GET {gcr}/api/nextgent/business-kinds` (gcr-api-clean, headers: x-nextgent-timestamp, x-nextgent-nonce, x-nextgent-signature) → **401**
response:
```json
{
  "error": "Bad signature."
}
```
- PASS: a signature for another path presented here → 401 bad signature
`POST {paperclip}/api/nextgent/conversations` (Paperclip as owner A) → **401**
request body:
```json
{
  "companyId": "7068529b-8993-466d-bc59-885129d5f493",
  "channel": "sms",
  "turns": 1
}
```
response:
```json
{
  "error": "Invalid or missing NEXT GENT signature",
  "reason": "missing"
}
```
- PASS: Paperclip refuses an unsigned POST /api/nextgent/conversations with 401
`POST {paperclip}/api/companies/4f3951f6-a3c5-49b2-a61b-53b9dbdd4b5c/business-token` (Paperclip as ownerB) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T01:11:45.000Z"
}
```
- PASS: business token issued for company B
`GET {gcr}/api/owner/conversations` (gcr-api-clean, Bearer token) → **200**
response:
```json
{
  "conversations": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```
- PASS: B's list is empty (its business has no conversations)
`GET {gcr}/api/owner/conversations/bb481ee3-4bf8-410f-acf5-a73a0714b6c5` (gcr-api-clean, Bearer token) → **404**
response:
```json
{
  "error": "No such conversation."
}
```
- PASS: B reading A's conversation id → 404
`GET {gcr}/api/owner/conversations/bb481ee3-4bf8-410f-acf5-a73a0714b6c5?business=proof-diner&slug=proof-diner` (gcr-api-clean, Bearer token) → **404**
response:
```json
{
  "error": "No such conversation."
}
```
- PASS: B naming A's slug in the query is ignored (still 404, not an admin)
`GET {gcr}/api/owner/conversations` (gcr-api-clean) → **401**
response:
```json
{
  "error": "Not signed in."
}
```
- PASS: no token → 401
`GET {paperclip}/api/companies/7068529b-8993-466d-bc59-885129d5f493/activity?limit=5` (Paperclip as ownerB) → **403**
response:
```json
{
  "error": "User does not have access to this company"
}
```
- PASS: Paperclip: owner B cannot read company A's activity (403/404)
gcr memdb: live_conversations at the end (the transcript and numbers stayed here):
```json
[
  {
    "id": "bb481ee3-4bf8-410f-acf5-a73a0714b6c5",
    "channel": "sms",
    "mode": "business",
    "entity_slug": "proof-diner",
    "company_id": "7068529b-8993-466d-bc59-885129d5f493",
    "from_number": "+15550123456",
    "to_number": "+15550200000",
    "provider_ref": null,
    "transcript": "<3 turns>",
    "tool_calls": [],
    "status": "closed",
    "state": "answered",
    "started_at": "2026-10-05T01:01:45.594Z",
    "last_activity_at": "2026-10-05T01:06:45.604Z",
    "ended_at": "2026-10-05T01:06:45.604Z",
    "outcome": "booked",
    "recorded_at": "2026-10-05T01:06:45.677Z",
    "record_error": null
  }
]
```

## Summary

- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS

All steps passed.
