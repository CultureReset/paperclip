# Proof 3: STEP3-CONTRACT §F.4 over real HTTP (Paperclip ⇄ gcr-api-clean)

Run at 2026-10-05T00:24:16.703Z.

Paperclip at `http://127.0.0.1:4600` (real routes/store.ts + routes/nextgent.ts on embedded Postgres with migrations), gcr-api-clean at `http://127.0.0.1:4610` (real routes on scripts/lib/memdb.js). Shared NEXTGENT_SERVICE_SECRET; Paperclip's PAPERCLIP_PUBLIC_URL is gcr's PAPERCLIP_ISSUER and its JWKS URL.

Repo state at run time:
```
5dc2531 Store bridge: a layout's manifest travels as `layout`, never as `app`
---
c8aa85a A layout install is projected to entity_modules, not an app (DECISIONS #31)
---
a01299a Engine: publishable as @nextgent/app-engine, with a prepack check
```

Paperclip company: `db8eabcd-f1df-43f2-aaf7-b59663a00937` (owner user `user-487e76f3-c297-4041-b75a-8c0d48dc2860`), created by direct insert into companies + an owner membership (the way server/src/__tests__ seed one).

## Step 1: Create the business and link it (Paperclip bridge: POST /api/companies/:id/business-link {create})

`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/business-link` (Paperclip as owner) → **201**
request body:
```json
{
  "create": {
    "name": "Proof Cafe",
    "kind": "cafe"
  }
}
```
response:
```json
{
  "entitySlug": "proof-cafe",
  "forwardingAddress": "gcr-proof-cafe@parse.example.test"
}
```
- PASS: link answered 201 with the slug gcr-api-clean created
`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/business-link` (Paperclip as owner) → **200**
response:
```json
{
  "linked": true,
  "entitySlug": "proof-cafe",
  "forwardingAddress": "gcr-proof-cafe@parse.example.test",
  "linkedAt": "2026-10-05T00:24:28.024Z"
}
```
- PASS: Paperclip records the link
gcr memdb: entity:
```json
[
  {
    "id": "id-1",
    "created_at": "2026-10-05T00:24:27.986Z",
    "slug": "proof-cafe",
    "name": "Proof Cafe",
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
    "created_at": "2026-10-05T00:24:27.987Z",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "entity_slug": "proof-cafe",
    "linked_by": "paperclip:link"
  }
]
```
gcr memdb: business_mcp_tokens (hashes only):
```json
[
  {
    "id": "id-3",
    "created_at": "2026-10-05T00:24:27.987Z",
    "entity_slug": "proof-cafe",
    "label": "company:db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "scope": "write",
    "token_hash": "70243eb019b4…",
    "token_hint": "WGllb4",
    "created_by": null,
    "permissions": [
      "business:read",
      "business:write",
      "menu:read",
      "menu:write",
      "availability:read",
      "availability:write",
      "bookings:read",
      "bookings:write",
      "events:read",
      "events:write",
      "reviews:read",
      "reviews:write",
      "transactions:read",
      "transactions:write",
      "messages:read",
      "messages:write"
    ],
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937"
  }
]
```
- PASS: gcr has the entity row and the company_links row
- PASS: gcr minted the company-level business token (one business_mcp_tokens row, company_id set, no install_id)
- PASS: the link call reached gcr signed (x-nextgent-* headers)

## Step 2: Publish the QR Menu app (shipped manifest apps/qr-menu/manifest.json through the engine's toStorePublication) via the admin store routes

- PASS: engine toStorePublication accepts the shipped manifest
Publication item: {"key":"core-qr-menu","kind":"app","name":"QR Menu","summary":"A live menu customers scan at the table.","description":"Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone."}; version.payload.nextgent: {"kind":"app","permissions":[{"permission":"menu:read","reason":"Shows your menu sections, items and prices on the QR page."},{"permission":"menu:write","reason":"Lets you edit menu items from inside this app.","optional":true}]}
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
  "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
  "key": "core-qr-menu",
  "kind": "app",
  "name": "QR Menu",
  "status": "draft"
}
```
- PASS: item created (201, kind app)
`POST {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/versions` (Paperclip as admin) → **400**
request body:
```json
{
  "version": "9.9.9",
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
response:
```json
{
  "error": "App release is not valid: payload.app.version must equal the release version \"9.9.9\""
}
```
- PASS: gate rejects a release whose manifest version differs, naming the field path
`POST {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/versions` (Paperclip as admin) → **400**
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
    "app": "<manifest core-qr-menu@1.0.0, 1136 bytes>"
  },
  "channel": "stable",
  "changelog": "First release"
}
```
response:
```json
{
  "error": "App release is not valid: payload.app.ui must be an object"
}
```
- PASS: gate rejects a manifest without a ui object (payload.app.ui)
`POST {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/versions` (Paperclip as admin) → **201**
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
  "pendingFor": 0,
  "needsApprovalFor": [],
  "failedFor": []
}
```
- PASS: version 1.0.0 passes the gate (201)
`PUT {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/price` (Paperclip as admin) → **200**
request body:
```json
{
  "amountCents": 0,
  "currency": "usd",
  "model": "free"
}
```
response:
```json
{
  "itemId": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
  "itemKey": "core-qr-menu",
  "price": {
    "amountCents": 0,
    "currency": "usd",
    "interval": null,
    "model": "free"
  },
  "billing": {
    "itemKey": "core-qr-menu",
    "amountCents": 0,
    "currency": "usd",
    "interval": null,
    "model": "free",
    "stripePriceId": null
  }
}
```
- PASS: price set and forwarded to gcr billing
`POST {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
  "status": "published",
  "latestVersionId": "faa2c48f-7024-44b6-9631-0e7888058404"
}
```
- PASS: published
gcr memdb: billing_item_prices:
```json
[
  {
    "id": "id-4",
    "created_at": "2026-10-05T00:24:28.097Z",
    "item_key": "core-qr-menu",
    "amount_cents": 0,
    "currency": "usd",
    "interval": null,
    "model": "free",
    "stripe_product_id": null,
    "stripe_price_id": null,
    "updated_at": "2026-10-05T00:24:28.097Z"
  }
]
```

## Step 3: Install for the company on the fast channel (POST /api/companies/:id/store/:itemId/install {channel: fast})

`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/a5e8891d-635c-43a4-b0de-ade2dba5285b/install` (Paperclip as owner) → **201**
request body:
```json
{
  "channel": "fast"
}
```
response (selected):
```json
{
  "id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "companyId": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
  "itemId": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
  "channel": "fast",
  "approvalMode": "automatic",
  "enabled": true,
  "approvedPermissions": [
    "menu:read",
    "menu:write"
  ],
  "tokenSecretId": "88fd83d9-f83a-49e2-ba71-abbe688bf4fa",
  "charge": {
    "priceCents": 0,
    "interval": null
  },
  "charged": false
}
```
- PASS: install answered 201
- PASS: install is on channel fast, enabled, with the manifest's permissions approved (menu:read + optional menu:write) and a token secret stored
gcr inbound /api/nextgent calls during install:
```json
[
  {
    "at": "2026-10-05T00:24:28.123Z",
    "method": "GET",
    "path": "/api/nextgent/entitlement?companyId=db8eabcd-f1df-43f2-aaf7-b59663a00937&itemKey=core-qr-menu",
    "signed": true,
    "body": null
  },
  {
    "at": "2026-10-05T00:24:28.157Z",
    "method": "POST",
    "path": "/api/nextgent/installs",
    "signed": true,
    "body": {
      "companyId": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
      "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
      "itemKey": "core-qr-menu",
      "kind": "app",
      "version": "1.0.0",
      "permissions": [
        "menu:read",
        "menu:write"
      ],
      "optionalPermissions": [
        "menu:write"
      ],
      "app": "<manifest core-qr-menu@1.0.0>",
      "enabled": true
    }
  }
]
```
- PASS: gcr received a signed POST /api/nextgent/installs carrying app (the manifest) and enabled
- PASS: entitlement was asked first (GET /api/nextgent/entitlement)
gcr memdb: nextgent_installs:
```json
[
  {
    "id": "id-5",
    "created_at": "2026-10-05T00:24:28.159Z",
    "install_id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "entity_slug": "proof-cafe",
    "item_key": "core-qr-menu",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "menu:read",
      "menu:write"
    ],
    "routine_webhook_url": null,
    "routine_webhook_secret": null,
    "status": "active"
  }
]
```
gcr memdb: entity_modules:
```json
[
  {
    "id": "legacy-1",
    "entity_slug": "other-shop",
    "module_key": "menu",
    "enabled": true,
    "settings": {
      "manifest": "<manifest undefined@undefined>",
      "config": {},
      "showOnPublic": true
    },
    "sort_order": 0
  },
  {
    "id": "id-6",
    "created_at": "2026-10-05T00:24:28.160Z",
    "render_mode": "inline",
    "install_id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "enabled": true,
    "entity_slug": "proof-cafe",
    "module_key": "core-qr-menu",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-qr-menu@1.0.0>",
      "config": {},
      "showOnPublic": true
    },
    "updated_at": "2026-10-05T00:24:28.160Z",
    "version": "1.0.0"
  }
]
```
- PASS: entity_modules has one row for the install: managed_by paperclip, module_key = app key, company_id, version 1.0.0, enabled, settings.manifest = the manifest, settings.showOnPublic true, render_mode inline
- PASS: nextgent_installs row is active, kind app, permissions as approved
- PASS: gcr minted an install token (business_mcp_tokens row with install_id)
- PASS: the legacy row on another business is untouched

## Step 4: GET /api/companies/:id/store carries installId, app.ui, installEnabled, price

`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store` (Paperclip as owner) → **200**
response:
```json
[
  {
    "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
    "key": "core-qr-menu",
    "kind": "app",
    "name": "QR Menu",
    "summary": "A live menu customers scan at the table.",
    "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.0.0",
    "installed": true,
    "enabled": true,
    "installedVersion": "1.0.0",
    "channel": "fast",
    "approvalMode": "automatic",
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [
      {
        "permission": "menu:read",
        "resource": "menu",
        "action": "read",
        "reason": "Shows your menu sections, items and prices on the QR page.",
        "optional": false,
        "changesThings": false
      },
      {
        "permission": "menu:write",
        "resource": "menu",
        "action": "write",
        "reason": "Lets you edit menu items from inside this app.",
        "optional": true,
        "changesThings": true
      }
    ],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "installEnabled": true,
    "versionId": "faa2c48f-7024-44b6-9631-0e7888058404",
    "app": {
      "id": "core-qr-menu",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "items"
            },
            {
              "type": "collection",
              "source": "sections"
            },
            {
              "type": "settings"
            }
          ],
          "public": [
            {
              "type": "list",
              "style": "list",
              "fields": {
                "body": "description",
                "title": "item_name",
                "value": "price"
              },
              "source": "items"
            },
            {
              "text": {
                "setting": "footer_note"
              },
              "type": "text",
              "heading": ""
            }
          ]
        },
        "format": {
          "currency": {
            "setting": "currency"
          }
        },
        "sources": {
          "items": {
            "from": "business",
            "group": "section_id",
            "label": "Menu items",
            "order": "sort_order",
            "title": "item_name",
            "fields": [
              {
                "key": "item_name",
                "type": "text",
                "label": "Name",
                "required": true,
                "maxLength": 120
              },
              {
                "key": "description",
                "type": "longtext",
                "label": "Description",
                "maxLength": 400
              },
              {
                "key": "price",
                "min": 0,
                "type": "money",
                "label": "Price"
              },
              {
                "key": "section_id",
                "type": "select",
                "label": "Section",
                "optionsFrom": {
                  "label": "section_name",
                  "source": "sections"
                }
              },
              {
                "key": "is_available",
                "type": "boolean",
                "label": "Available",
                "default": true
              }
            ],
            "section": "menu_items",
            "resource": "menu",
            "sortable": true,
            "subtitle": "price",
            "visibleWhen": "is_available",
            "labelSingular": "Menu item"
          },
          "sections": {
            "from": "business",
            "label": "Menu sections",
            "order": "sort_order",
            "title": "section_name",
            "fields": [
              {
                "key": "section_name",
                "type": "text",
                "label": "Section",
                "required": true,
                "maxLength": 80
              }
            ],
            "section": "menu_sections",
            "resource": "menu",
            "sortable": true,
            "labelSingular": "Section"
          }
        }
      },
      "icon": "🍽️",
      "name": "QR Menu",
      "config": [
        {
          "key": "currency",
          "help": "A currency code (USD, EUR) or the symbol to show before prices.",
          "type": "text",
          "label": "Currency"
        },
        {
          "key": "footer_note",
          "help": "Shown under the menu, e.g. an allergy notice.",
          "type": "text",
          "label": "Footer note"
        }
      ],
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "A live menu customers scan at the table.",
      "version": "1.0.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Menu",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
      "permissions": [
        {
          "id": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "id": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ],
      "schema_version": 1
    },
    "price": {
      "amountCents": 0,
      "currency": "usd",
      "interval": null,
      "model": "free"
    },
    "approvedPermissions": [
      "menu:read",
      "menu:write"
    ]
  }
]
```
listing entry (selected):
```json
{
  "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
  "key": "core-qr-menu",
  "kind": "app",
  "installed": true,
  "enabled": true,
  "installedVersion": "1.0.0",
  "latestVersion": "1.0.0",
  "channel": "fast",
  "approvalMode": "automatic",
  "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "installEnabled": true,
  "versionId": "faa2c48f-7024-44b6-9631-0e7888058404",
  "app": "<manifest core-qr-menu@1.0.0, ui: object>",
  "price": {
    "amountCents": 0,
    "currency": "usd",
    "interval": null,
    "model": "free"
  },
  "approvedPermissions": [
    "menu:read",
    "menu:write"
  ],
  "needsAccessTo": [
    {
      "permission": "menu:read",
      "resource": "menu",
      "action": "read",
      "reason": "Shows your menu sections, items and prices on the QR page.",
      "optional": false,
      "changesThings": false
    },
    {
      "permission": "menu:write",
      "resource": "menu",
      "action": "write",
      "reason": "Lets you edit menu items from inside this app.",
      "optional": true,
      "changesThings": true
    }
  ],
  "updateAvailable": false
}
```
- PASS: installId is the store_installs id
- PASS: app is the installed manifest with a ui object (what Play-user appOf() reads)
- PASS: installEnabled true, installedVersion 1.0.0, channel fast
- PASS: price {amountCents, currency, interval, model}
- PASS: approvedPermissions listed

## Step 5: POST /api/companies/:id/installs/:installId/token → short-lived install session token from gcr

`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/installs/2a558ebf-9c83-4ba3-85f8-717a84756d00/token` (Paperclip as owner) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T00:29:28.000Z"
}
```
- PASS: 200 with a token and an expiresAt
token prefix: `gcr_mcp_ist.…`, expires in ~300 s
- PASS: expiresAt is set, in the future and at most 300 s away
- PASS: it is gcr's install session token form (gcr_mcp_ist.)
`GET {gcr}/api/app-install` (gcr-api-clean) → **200**
response:
```json
{
  "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "itemKey": "core-qr-menu",
  "version": "1.0.0",
  "settings": {},
  "granted": [
    "menu:read",
    "menu:write"
  ]
}
```
- PASS: the token works against gcr /api/app-install for this install

## Step 6: gcr GET /api/public/business/:slug/apps → one row with installId, manifest, publicEnabled true

`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu",
    "version": "1.0.0",
    "renderMode": "inline",
    "publicLabel": null,
    "position": null,
    "enabled": true,
    "publicEnabled": true,
    "config": {},
    "manifest": "<manifest core-qr-menu@1.0.0, ui: object>"
  }
]
```
- PASS: one row
- PASS: row: installId, appKey core-qr-menu, version 1.0.0, manifest with ui, publicEnabled true, enabled true, renderMode inline
- PASS: row has exactly the contract's shape
`GET {gcr}/api/public/business/no-such-business/apps` (gcr-api-clean) → **404**
response:
```json
{
  "error": "No such business."
}
```
- PASS: an unknown slug is a JSON 404

## Step 7: Owner PATCH on gcr with a Paperclip business token (the Play-user path): publicEnabled false hides it from the public list only

`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/business-token` (Paperclip as owner) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T00:29:28.000Z"
}
```
- PASS: business token issued (JWT, expiresAt set)
`GET {gcr}/api/owner/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu",
    "version": "1.0.0",
    "renderMode": "inline",
    "publicLabel": null,
    "position": null,
    "enabled": true,
    "publicEnabled": true,
    "config": {},
    "manifest": "<manifest core-qr-menu@1.0.0, ui: object>"
  }
]
```
- PASS: gcr verified the JWT against Paperclip's JWKS over HTTP and resolved the business: owner list has the row
`PATCH {gcr}/api/owner/apps/2a558ebf-9c83-4ba3-85f8-717a84756d00` (gcr-api-clean) → **400**
request body:
```json
{
  "enabled": false
}
```
response:
```json
{
  "error": "Nothing to change."
}
```
- PASS: enabled is not owner-writable (PATCH {enabled:false} → 400, nothing to change)
`PATCH {gcr}/api/owner/apps/2a558ebf-9c83-4ba3-85f8-717a84756d00` (gcr-api-clean) → **200**
request body:
```json
{
  "publicEnabled": false
}
```
response (selected):
```json
{
  "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "appKey": "core-qr-menu",
  "version": "1.0.0",
  "renderMode": "inline",
  "publicLabel": null,
  "position": null,
  "enabled": true,
  "publicEnabled": false,
  "config": {},
  "manifest": "<manifest core-qr-menu@1.0.0, ui: object>"
}
```
- PASS: PATCH {publicEnabled:false} → 200, row publicEnabled false, enabled still true
`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response:
```json
[]
```
- PASS: public list is now empty
`GET {gcr}/api/owner/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu",
    "version": "1.0.0",
    "renderMode": "inline",
    "publicLabel": null,
    "position": null,
    "enabled": true,
    "publicEnabled": false,
    "config": {},
    "manifest": "<manifest core-qr-menu@1.0.0, ui: object>"
  }
]
```
- PASS: owner list still shows it, publicEnabled false
gcr memdb: entity_modules:
```json
[
  {
    "id": "id-6",
    "created_at": "2026-10-05T00:24:28.160Z",
    "render_mode": "inline",
    "install_id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "enabled": true,
    "entity_slug": "proof-cafe",
    "module_key": "core-qr-menu",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-qr-menu@1.0.0>",
      "config": {},
      "showOnPublic": false
    },
    "updated_at": "2026-10-05T00:24:28.309Z",
    "version": "1.0.0"
  }
]
```
- PASS: memdb: settings.showOnPublic false, enabled true
`PATCH {gcr}/api/owner/apps/2a558ebf-9c83-4ba3-85f8-717a84756d00` (gcr-api-clean) → **200**
request body:
```json
{
  "publicEnabled": true,
  "renderMode": "button",
  "publicLabel": "Our menu"
}
```
response (selected):
```json
{
  "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "appKey": "core-qr-menu",
  "version": "1.0.0",
  "renderMode": "button",
  "publicLabel": "Our menu",
  "position": null,
  "enabled": true,
  "publicEnabled": true,
  "config": {},
  "manifest": "<manifest core-qr-menu@1.0.0, ui: object>"
}
```
- PASS: PATCH {publicEnabled:true, renderMode:button, publicLabel} → public again with the owner's render fields
`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "renderMode": "button",
    "publicLabel": "Our menu",
    "publicEnabled": true
  }
]
```
- PASS: public list has it back with renderMode button and the label

## Step 8: Publish 1.1.0 and update the install → gcr row moves to 1.1.0 through PATCH /api/nextgent/installs/:id

`PATCH {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/a5e8891d-635c-43a4-b0de-ade2dba5285b` (Paperclip as owner) → **200**
request body:
```json
{
  "approvalMode": "manual"
}
```
response (selected):
```json
{
  "id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "channel": "fast",
  "approvalMode": "manual"
}
```
- PASS: install set to manual updates (so the release is not auto-applied and the explicit update path is exercised)
- PASS: engine accepts the 1.1.0 manifest
`POST {paperclip}/api/store/admin/items/a5e8891d-635c-43a4-b0de-ade2dba5285b/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.1.0",
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
    "app": "<manifest core-qr-menu@1.1.0, 2446 bytes>"
  },
  "channel": "fast",
  "changelog": "Proof release 1.1.0"
}
```
response (selected):
```json
{
  "appliedTo": 0,
  "pendingFor": 1,
  "needsApprovalFor": [],
  "failedFor": []
}
```
- PASS: 1.1.0 added on the fast channel; the manual install is pending (not auto-applied)
`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store` (Paperclip as owner) → **200**
response:
```json
[
  {
    "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
    "key": "core-qr-menu",
    "kind": "app",
    "name": "QR Menu",
    "summary": "A live menu customers scan at the table.",
    "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.1.0",
    "installed": true,
    "enabled": true,
    "installedVersion": "1.0.0",
    "channel": "fast",
    "approvalMode": "manual",
    "updateAvailable": true,
    "updateAdvisory": "enhancement",
    "updateChangelog": "Proof release 1.1.0",
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [
      {
        "permission": "menu:read",
        "resource": "menu",
        "action": "read",
        "reason": "Shows your menu sections, items and prices on the QR page.",
        "optional": false,
        "changesThings": false
      },
      {
        "permission": "menu:write",
        "resource": "menu",
        "action": "write",
        "reason": "Lets you edit menu items from inside this app.",
        "optional": true,
        "changesThings": true
      }
    ],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "installEnabled": true,
    "versionId": "faa2c48f-7024-44b6-9631-0e7888058404",
    "app": {
      "id": "core-qr-menu",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "items"
            },
            {
              "type": "collection",
              "source": "sections"
            },
            {
              "type": "settings"
            }
          ],
          "public": [
            {
              "type": "list",
              "style": "list",
              "fields": {
                "body": "description",
                "title": "item_name",
                "value": "price"
              },
              "source": "items"
            },
            {
              "text": {
                "setting": "footer_note"
              },
              "type": "text",
              "heading": ""
            }
          ]
        },
        "format": {
          "currency": {
            "setting": "currency"
          }
        },
        "sources": {
          "items": {
            "from": "business",
            "group": "section_id",
            "label": "Menu items",
            "order": "sort_order",
            "title": "item_name",
            "fields": [
              {
                "key": "item_name",
                "type": "text",
                "label": "Name",
                "required": true,
                "maxLength": 120
              },
              {
                "key": "description",
                "type": "longtext",
                "label": "Description",
                "maxLength": 400
              },
              {
                "key": "price",
                "min": 0,
                "type": "money",
                "label": "Price"
              },
              {
                "key": "section_id",
                "type": "select",
                "label": "Section",
                "optionsFrom": {
                  "label": "section_name",
                  "source": "sections"
                }
              },
              {
                "key": "is_available",
                "type": "boolean",
                "label": "Available",
                "default": true
              }
            ],
            "section": "menu_items",
            "resource": "menu",
            "sortable": true,
            "subtitle": "price",
            "visibleWhen": "is_available",
            "labelSingular": "Menu item"
          },
          "sections": {
            "from": "business",
            "label": "Menu sections",
            "order": "sort_order",
            "title": "section_name",
            "fields": [
              {
                "key": "section_name",
                "type": "text",
                "label": "Section",
                "required": true,
                "maxLength": 80
              }
            ],
            "section": "menu_sections",
            "resource": "menu",
            "sortable": true,
            "labelSingular": "Section"
          }
        }
      },
      "icon": "🍽️",
      "name": "QR Menu",
      "config": [
        {
          "key": "currency",
          "help": "A currency code (USD, EUR) or the symbol to show before prices.",
          "type": "text",
          "label": "Currency"
        },
        {
          "key": "footer_note",
          "help": "Shown under the menu, e.g. an allergy notice.",
          "type": "text",
          "label": "Footer note"
        }
      ],
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "A live menu customers scan at the table.",
      "version": "1.0.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Menu",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
      "permissions": [
        {
          "id": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "id": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ],
      "schema_version": 1
    },
    "price": {
      "amountCents": 0,
      "currency": "usd",
      "interval": null,
      "model": "free"
    },
    "approvedPermissions": [
      "menu:read",
      "menu:write"
    ]
  }
]
```
listing entry (selected):
```json
{
  "installedVersion": "1.0.0",
  "latestVersion": "1.1.0",
  "updateAvailable": true,
  "updateChangelog": "Proof release 1.1.0",
  "needsApproval": false,
  "updateNewPermissions": [],
  "app": "<manifest core-qr-menu@1.0.0, ui: object>"
}
```
- PASS: listing shows the update available (1.0.0 → 1.1.0), no new permissions, app still the installed 1.0.0 manifest
`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/a5e8891d-635c-43a4-b0de-ade2dba5285b/update` (Paperclip as owner) → **200**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
  "versionId": "68abcda2-c1b4-48f9-be4f-98e4cf2cbbe8",
  "enabled": true,
  "approvedPermissions": [
    "menu:read",
    "menu:write"
  ]
}
```
- PASS: update → 200
gcr inbound calls during update:
```json
[
  {
    "at": "2026-10-05T00:24:28.364Z",
    "method": "PATCH",
    "path": "/api/nextgent/installs/2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "signed": true,
    "body": {
      "version": "1.1.0",
      "app": "<manifest core-qr-menu@1.1.0>"
    }
  }
]
```
- PASS: gcr received a signed PATCH /api/nextgent/installs/:id with version 1.1.0 and the 1.1.0 manifest (same scope → PATCH, not re-register)
gcr memdb: entity_modules (the install):
```json
[
  {
    "id": "id-6",
    "created_at": "2026-10-05T00:24:28.160Z",
    "render_mode": "button",
    "install_id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "enabled": true,
    "entity_slug": "proof-cafe",
    "module_key": "core-qr-menu",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-qr-menu@1.1.0>",
      "config": {},
      "showOnPublic": true
    },
    "updated_at": "2026-10-05T00:24:28.365Z",
    "version": "1.1.0",
    "public_label": "Our menu"
  }
]
```
- PASS: entity_modules row: version 1.1.0, settings.manifest.version 1.1.0, enabled true, owner fields kept (button / Our menu / showOnPublic true)
- PASS: nextgent_installs row moved to 1.1.0
`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store` (Paperclip as owner) → **200**
response:
```json
[
  {
    "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
    "key": "core-qr-menu",
    "kind": "app",
    "name": "QR Menu",
    "summary": "A live menu customers scan at the table.",
    "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.1.0",
    "installed": true,
    "enabled": true,
    "installedVersion": "1.1.0",
    "channel": "fast",
    "approvalMode": "manual",
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [
      {
        "permission": "menu:read",
        "resource": "menu",
        "action": "read",
        "reason": "Shows your menu sections, items and prices on the QR page.",
        "optional": false,
        "changesThings": false
      },
      {
        "permission": "menu:write",
        "resource": "menu",
        "action": "write",
        "reason": "Lets you edit menu items from inside this app.",
        "optional": true,
        "changesThings": true
      }
    ],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "installEnabled": true,
    "versionId": "68abcda2-c1b4-48f9-be4f-98e4cf2cbbe8",
    "app": {
      "id": "core-qr-menu",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "items"
            },
            {
              "type": "collection",
              "source": "sections"
            },
            {
              "type": "settings"
            }
          ],
          "public": [
            {
              "type": "list",
              "style": "list",
              "fields": {
                "body": "description",
                "title": "item_name",
                "value": "price"
              },
              "source": "items"
            },
            {
              "text": {
                "setting": "footer_note"
              },
              "type": "text",
              "heading": ""
            }
          ]
        },
        "format": {
          "currency": {
            "setting": "currency"
          }
        },
        "sources": {
          "items": {
            "from": "business",
            "group": "section_id",
            "label": "Menu items",
            "order": "sort_order",
            "title": "item_name",
            "fields": [
              {
                "key": "item_name",
                "type": "text",
                "label": "Name",
                "required": true,
                "maxLength": 120
              },
              {
                "key": "description",
                "type": "longtext",
                "label": "Description",
                "maxLength": 400
              },
              {
                "key": "price",
                "min": 0,
                "type": "money",
                "label": "Price"
              },
              {
                "key": "section_id",
                "type": "select",
                "label": "Section",
                "optionsFrom": {
                  "label": "section_name",
                  "source": "sections"
                }
              },
              {
                "key": "is_available",
                "type": "boolean",
                "label": "Available",
                "default": true
              }
            ],
            "section": "menu_items",
            "resource": "menu",
            "sortable": true,
            "subtitle": "price",
            "visibleWhen": "is_available",
            "labelSingular": "Menu item"
          },
          "sections": {
            "from": "business",
            "label": "Menu sections",
            "order": "sort_order",
            "title": "section_name",
            "fields": [
              {
                "key": "section_name",
                "type": "text",
                "label": "Section",
                "required": true,
                "maxLength": 80
              }
            ],
            "section": "menu_sections",
            "resource": "menu",
            "sortable": true,
            "labelSingular": "Section"
          }
        }
      },
      "icon": "🍽️",
      "name": "QR Menu",
      "config": [
        {
          "key": "currency",
          "help": "A currency code (USD, EUR) or the symbol to show before prices.",
          "type": "text",
          "label": "Currency"
        },
        {
          "key": "footer_note",
          "help": "Shown under the menu, e.g. an allergy notice.",
          "type": "text",
          "label": "Footer note"
        }
      ],
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "A live menu customers scan at the table (1.1.0).",
      "version": "1.1.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Menu",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
      "permissions": [
        {
          "id": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "id": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ],
      "schema_version": 1
    },
    "price": {
      "amountCents": 0,
      "currency": "usd",
      "interval": null,
      "model": "free"
    },
    "approvedPermissions": [
      "menu:read",
      "menu:write"
    ]
  }
]
```
- PASS: listing: installedVersion 1.1.0, app 1.1.0, no update pending

## Step 9: Disable / enable: Paperclip has no owner disable route; the one disabled state is an admin push with enabled:false, then the owner's POST …/enable

routes/store.ts at this head exposes install, enable, update, PATCH (channel/approvalMode) and DELETE for a company; there is no owner disable route. A disabled install is reached through the admin deploy with `installMissing: true, enabled: false` (a push switched off). This step uses a second shipped app, FAQ (apps/faq/manifest.json, which has an app table `entries` for step 10).
- PASS: engine accepts the FAQ manifest
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-faq",
  "kind": "app",
  "name": "FAQ",
  "summary": "Answer the questions before they are asked.",
  "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week."
}
```
response (selected):
```json
{
  "id": "485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e",
  "key": "core-faq",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": []
    },
    "app": "<manifest core-faq@1.0.0, 1493 bytes>"
  },
  "channel": "stable"
}
```
response (selected):
```json
{
  "appliedTo": 0,
  "pendingFor": 0
}
```
`POST {paperclip}/api/store/admin/items/485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: FAQ published
`POST {paperclip}/api/store/admin/items/485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e/deploy` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "action": "apply",
  "audience": {
    "mode": "companies",
    "companyIds": [
      "db8eabcd-f1df-43f2-aaf7-b59663a00937"
    ]
  },
  "installMissing": true,
  "enabled": false
}
```
response (selected):
```json
{
  "targeted": 1,
  "apply": 0,
  "install": 1,
  "installSwitchedOff": 1,
  "skip": 0,
  "failedFor": [],
  "companies": [
    {
      "companyId": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
      "outcome": "install",
      "reason": null,
      "enabled": false
    }
  ]
}
```
- PASS: admin push installs it switched off (install 1, installSwitchedOff 1)
Paperclip store_installs for FAQ:
```json
{
  "id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
  "enabled": false,
  "approvedPermissions": null,
  "tokenSecretId": null,
  "channel": "stable"
}
```
- PASS: store_installs row exists with enabled false and nothing registered upstream yet (approvedPermissions null, no token)
- PASS: a switched-off push tells gcr nothing (no /api/nextgent/installs call yet)
`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store` (Paperclip as owner) → **200**
response:
```json
[
  {
    "id": "485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e",
    "key": "core-faq",
    "kind": "app",
    "name": "FAQ",
    "summary": "Answer the questions before they are asked.",
    "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.0.0",
    "installed": true,
    "enabled": false,
    "installedVersion": "1.0.0",
    "channel": "stable",
    "approvalMode": "automatic",
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "installEnabled": false,
    "versionId": "e0047b7c-b2df-4157-a80a-28bc324bf731",
    "app": {
      "id": "core-faq",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "entries"
            }
          ],
          "public": [
            {
              "type": "details",
              "style": "accordion",
              "fields": {
                "body": "answer",
                "summary": "question"
              },
              "source": "entries"
            }
          ]
        },
        "sources": {
          "entries": {
            "from": "app",
            "label": "Questions",
            "order": "sort_order",
            "table": "entries",
            "title": "question",
            "fields": [
              {
                "key": "question",
                "type": "text",
                "label": "Question",
                "required": true,
                "maxLength": 160
              },
              {
                "key": "answer",
                "type": "longtext",
                "label": "Answer",
                "required": true,
                "maxLength": 1200
              },
              {
                "key": "visible",
                "type": "boolean",
                "label": "Visible",
                "default": true
              }
            ],
            "sortable": true,
            "visibleWhen": "visible",
            "labelSingular": "Question"
          }
        }
      },
      "data": {
        "tables": {
          "entries": {
            "public": "read",
            "columns": {
              "answer": {
                "type": "text",
                "required": true,
                "max_length": 1200
              },
              "visible": {
                "type": "boolean",
                "default": true
              },
              "question": {
                "type": "text",
                "required": true,
                "max_length": 160
              },
              "sort_order": {
                "type": "integer"
              }
            }
          }
        },
        "namespace": "faq"
      },
      "icon": "❓",
      "name": "FAQ",
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "Answer the questions before they are asked.",
      "version": "1.0.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Questions",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week.",
      "permissions": [],
      "schema_version": 1
    },
    "price": null,
    "approvedPermissions": []
  },
  {
    "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
    "key": "core-qr-menu",
    "kind": "app",
    "name": "QR Menu",
    "summary": "A live menu customers scan at the table.",
    "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.1.0",
    "installed": true,
    "enabled": true,
    "installedVersion": "1.1.0",
    "channel": "fast",
    "approvalMode": "manual",
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [
      {
        "permission": "menu:read",
        "resource": "menu",
        "action": "read",
        "reason": "Shows your menu sections, items and prices on the QR page.",
        "optional": false,
        "changesThings": false
      },
      {
        "permission": "menu:write",
        "resource": "menu",
        "action": "write",
        "reason": "Lets you edit menu items from inside this app.",
        "optional": true,
        "changesThings": true
      }
    ],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "installEnabled": true,
    "versionId": "68abcda2-c1b4-48f9-be4f-98e4cf2cbbe8",
    "app": {
      "id": "core-qr-menu",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "items"
            },
            {
              "type": "collection",
              "source": "sections"
            },
            {
              "type": "settings"
            }
          ],
          "public": [
            {
              "type": "list",
              "style": "list",
              "fields": {
                "body": "description",
                "title": "item_name",
                "value": "price"
              },
              "source": "items"
            },
            {
              "text": {
                "setting": "footer_note"
              },
              "type": "text",
              "heading": ""
            }
          ]
        },
        "format": {
          "currency": {
            "setting": "currency"
          }
        },
        "sources": {
          "items": {
            "from": "business",
            "group": "section_id",
            "label": "Menu items",
            "order": "sort_order",
            "title": "item_name",
            "fields": [
              {
                "key": "item_name",
                "type": "text",
                "label": "Name",
                "required": true,
                "maxLength": 120
              },
              {
                "key": "description",
                "type": "longtext",
                "label": "Description",
                "maxLength": 400
              },
              {
                "key": "price",
                "min": 0,
                "type": "money",
                "label": "Price"
              },
              {
                "key": "section_id",
                "type": "select",
                "label": "Section",
                "optionsFrom": {
                  "label": "section_name",
                  "source": "sections"
                }
              },
              {
                "key": "is_available",
                "type": "boolean",
                "label": "Available",
                "default": true
              }
            ],
            "section": "menu_items",
            "resource": "menu",
            "sortable": true,
            "subtitle": "price",
            "visibleWhen": "is_available",
            "labelSingular": "Menu item"
          },
          "sections": {
            "from": "business",
            "label": "Menu sections",
            "order": "sort_order",
            "title": "section_name",
            "fields": [
              {
                "key": "section_name",
                "type": "text",
                "label": "Section",
                "required": true,
                "maxLength": 80
              }
            ],
            "section": "menu_sections",
            "resource": "menu",
            "sortable": true,
            "labelSingular": "Section"
          }
        }
      },
      "icon": "🍽️",
      "name": "QR Menu",
      "config": [
        {
          "key": "currency",
          "help": "A currency code (USD, EUR) or the symbol to show before prices.",
          "type": "text",
          "label": "Currency"
        },
        {
          "key": "footer_note",
          "help": "Shown under the menu, e.g. an allergy notice.",
          "type": "text",
          "label": "Footer note"
        }
      ],
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "A live menu customers scan at the table (1.1.0).",
      "version": "1.1.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Menu",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
      "permissions": [
        {
          "id": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "id": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ],
      "schema_version": 1
    },
    "price": {
      "amountCents": 0,
      "currency": "usd",
      "interval": null,
      "model": "free"
    },
    "approvedPermissions": [
      "menu:read",
      "menu:write"
    ]
  }
]
```
- PASS: listing: installed true, enabled false, installEnabled false, installId set
`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/installs/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f/token` (Paperclip as owner) → **409**
response:
```json
{
  "error": "This install is switched off"
}
```
- PASS: no install token while switched off (409)
`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e/enable` (Paperclip as owner) → **200**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
  "enabled": true,
  "approvedPermissions": [],
  "tokenSecretId": "65acc21c-f165-407d-b389-724b2358b454",
  "charged": false
}
```
- PASS: owner enable → 200, enabled true, token stored
gcr inbound calls during enable:
```json
[
  {
    "at": "2026-10-05T00:24:28.443Z",
    "method": "GET",
    "path": "/api/nextgent/entitlement?companyId=db8eabcd-f1df-43f2-aaf7-b59663a00937&itemKey=core-faq",
    "signed": true,
    "body": null
  },
  {
    "at": "2026-10-05T00:24:28.452Z",
    "method": "POST",
    "path": "/api/nextgent/installs",
    "signed": true,
    "body": {
      "companyId": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
      "installId": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
      "itemKey": "core-faq",
      "kind": "app",
      "version": "1.0.0",
      "permissions": [],
      "optionalPermissions": [],
      "app": "<manifest core-faq@1.0.0>",
      "enabled": false
    }
  },
  {
    "at": "2026-10-05T00:24:28.491Z",
    "method": "PATCH",
    "path": "/api/nextgent/installs/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "signed": true,
    "body": {
      "enabled": true
    }
  }
]
```
- PASS: gcr got the registration as it was (POST …/installs with enabled:false and the manifest) then PATCH {enabled:true}
gcr memdb: entity_modules (FAQ):
```json
[
  {
    "id": "id-9",
    "created_at": "2026-10-05T00:24:28.453Z",
    "render_mode": "inline",
    "install_id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "enabled": true,
    "entity_slug": "proof-cafe",
    "module_key": "core-faq",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-faq@1.0.0>",
      "config": {},
      "showOnPublic": true
    },
    "updated_at": "2026-10-05T00:24:28.491Z",
    "version": "1.0.0"
  }
]
```
- PASS: entity_modules row for FAQ: enabled true after the PATCH, manifest core-faq, managed_by paperclip
`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "appKey": "core-faq",
    "enabled": true,
    "publicEnabled": true,
    "position": null
  },
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu",
    "enabled": true,
    "publicEnabled": true,
    "position": null
  }
]
```
- PASS: public list now has both apps

## Step 10: Seed an app record with the install token, then uninstall → gcr row disabled and hidden but kept, app_records untouched

`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/installs/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f/token` (Paperclip as owner) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T00:29:28.000Z"
}
```
- PASS: FAQ install token issued
`POST {gcr}/api/app-data/entries` (gcr-api-clean) → **201**
request body:
```json
{
  "question": "Do you take cards?",
  "answer": "Yes, all major cards.",
  "sort_order": 1
}
```
response:
```json
{
  "table": "entries",
  "row": {
    "answer": "Yes, all major cards.",
    "visible": true,
    "question": "Do you take cards?",
    "sort_order": 1,
    "id": "id-11",
    "created_at": "2026-10-05T00:24:28.513Z",
    "updated_at": "2026-10-05T00:24:28.513Z"
  }
}
```
- PASS: record created through /api/app-data/entries (201)
`GET {gcr}/api/app-data/entries` (gcr-api-clean) → **200**
response (selected):
```json
{
  "table": "entries",
  "total": 1
}
```
- PASS: the install reads its own record back
`GET {gcr}/api/public/apps/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f` (gcr-api-clean) → **200**
response (selected):
```json
{
  "settings": {},
  "manifest": "<manifest core-faq@1.0.0, ui: object>"
}
```
- PASS: public /api/public/apps/:installId serves the record and now the manifest
gcr memdb: app_records before uninstall:
```json
[
  {
    "id": "id-11",
    "created_at": "2026-10-05T00:24:28.513Z",
    "install_id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "entity_slug": "proof-cafe",
    "app_table": "entries",
    "data": {
      "answer": "Yes, all major cards.",
      "visible": true,
      "question": "Do you take cards?",
      "sort_order": 1
    },
    "source": "owner"
  }
]
```
`DELETE {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e` (Paperclip as owner) → **204**
- PASS: uninstall → 204
gcr inbound calls during uninstall:
```json
[
  {
    "at": "2026-10-05T00:24:28.530Z",
    "method": "DELETE",
    "path": "/api/nextgent/installs/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "signed": true,
    "body": null
  }
]
```
- PASS: gcr received a signed DELETE /api/nextgent/installs/:id
gcr memdb: entity_modules (FAQ) after uninstall:
```json
[
  {
    "id": "id-9",
    "created_at": "2026-10-05T00:24:28.453Z",
    "render_mode": "inline",
    "install_id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "enabled": false,
    "entity_slug": "proof-cafe",
    "module_key": "core-faq",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-faq@1.0.0>",
      "config": {},
      "showOnPublic": false
    },
    "updated_at": "2026-10-05T00:24:28.531Z",
    "version": "1.0.0"
  }
]
```
gcr memdb: app_records after uninstall:
```json
[
  {
    "id": "id-11",
    "created_at": "2026-10-05T00:24:28.513Z",
    "install_id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "entity_slug": "proof-cafe",
    "app_table": "entries",
    "data": {
      "answer": "Yes, all major cards.",
      "visible": true,
      "question": "Do you take cards?",
      "sort_order": 1
    },
    "source": "owner"
  }
]
```
- PASS: entity_modules row still present: enabled false, settings.showOnPublic false, manifest kept
- PASS: app_records untouched (the seeded record is still there)
- PASS: nextgent_installs row marked removed, install token revoked
`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu"
  }
]
```
- PASS: public list drops the uninstalled app (QR Menu remains)
`GET {gcr}/api/owner/apps` (gcr-api-clean) → **200**
response (selected):
```json
[
  {
    "installId": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "appKey": "core-faq",
    "enabled": false,
    "publicEnabled": false
  },
  {
    "installId": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "appKey": "core-qr-menu",
    "enabled": true,
    "publicEnabled": true
  }
]
```
- PASS: owner list still lists the row, enabled false / publicEnabled false
`GET {gcr}/api/app-install` (gcr-api-clean) → **401**
response:
```json
{
  "error": "That install has been removed."
}
```
- PASS: the old install session token no longer works
`POST {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/installs/4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f/token` (Paperclip as owner) → **404**
response:
```json
{
  "error": "Install not found"
}
```
- PASS: Paperclip no longer issues a token for it (404)
- PASS: Paperclip store_installs row deleted
`DELETE {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store/a5e8891d-635c-43a4-b0de-ade2dba5285b` (Paperclip as owner) → **204**
- PASS: QR Menu uninstall → 204
gcr memdb: entity_modules after both uninstalls:
```json
[
  {
    "id": "legacy-1",
    "entity_slug": "other-shop",
    "module_key": "menu",
    "enabled": true,
    "settings": {
      "manifest": "<manifest undefined@undefined>",
      "config": {},
      "showOnPublic": true
    },
    "sort_order": 0
  },
  {
    "id": "id-6",
    "created_at": "2026-10-05T00:24:28.160Z",
    "render_mode": "button",
    "install_id": "2a558ebf-9c83-4ba3-85f8-717a84756d00",
    "enabled": false,
    "entity_slug": "proof-cafe",
    "module_key": "core-qr-menu",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-qr-menu@1.1.0>",
      "config": {},
      "showOnPublic": false
    },
    "updated_at": "2026-10-05T00:24:28.575Z",
    "version": "1.1.0",
    "public_label": "Our menu"
  },
  {
    "id": "id-9",
    "created_at": "2026-10-05T00:24:28.453Z",
    "render_mode": "inline",
    "install_id": "4c76eb52-34b9-4fb0-a31b-9b1e6f5a6b8f",
    "enabled": false,
    "entity_slug": "proof-cafe",
    "module_key": "core-faq",
    "company_id": "db8eabcd-f1df-43f2-aaf7-b59663a00937",
    "managed_by": "paperclip",
    "settings": {
      "manifest": "<manifest core-faq@1.0.0>",
      "config": {},
      "showOnPublic": false
    },
    "updated_at": "2026-10-05T00:24:28.531Z",
    "version": "1.0.0"
  }
]
```
- PASS: QR Menu entity_modules row kept: enabled false, showOnPublic false, version 1.1.0 and the owner's render fields kept
- PASS: app_records still 1 (nothing deleted on either uninstall)
`GET {gcr}/api/public/business/proof-cafe/apps` (gcr-api-clean) → **200**
response:
```json
[]
```
- PASS: public list empty
`GET {paperclip}/api/companies/db8eabcd-f1df-43f2-aaf7-b59663a00937/store` (Paperclip as owner) → **200**
response:
```json
[
  {
    "id": "485c2e1f-d1eb-4dd9-8f8e-9fe2accb4a5e",
    "key": "core-faq",
    "kind": "app",
    "name": "FAQ",
    "summary": "Answer the questions before they are asked.",
    "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.0.0",
    "installed": false,
    "enabled": null,
    "installedVersion": null,
    "channel": null,
    "approvalMode": null,
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": null,
    "installEnabled": null,
    "versionId": "e0047b7c-b2df-4157-a80a-28bc324bf731",
    "app": {
      "id": "core-faq",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "entries"
            }
          ],
          "public": [
            {
              "type": "details",
              "style": "accordion",
              "fields": {
                "body": "answer",
                "summary": "question"
              },
              "source": "entries"
            }
          ]
        },
        "sources": {
          "entries": {
            "from": "app",
            "label": "Questions",
            "order": "sort_order",
            "table": "entries",
            "title": "question",
            "fields": [
              {
                "key": "question",
                "type": "text",
                "label": "Question",
                "required": true,
                "maxLength": 160
              },
              {
                "key": "answer",
                "type": "longtext",
                "label": "Answer",
                "required": true,
                "maxLength": 1200
              },
              {
                "key": "visible",
                "type": "boolean",
                "label": "Visible",
                "default": true
              }
            ],
            "sortable": true,
            "visibleWhen": "visible",
            "labelSingular": "Question"
          }
        }
      },
      "data": {
        "tables": {
          "entries": {
            "public": "read",
            "columns": {
              "answer": {
                "type": "text",
                "required": true,
                "max_length": 1200
              },
              "visible": {
                "type": "boolean",
                "default": true
              },
              "question": {
                "type": "text",
                "required": true,
                "max_length": 160
              },
              "sort_order": {
                "type": "integer"
              }
            }
          }
        },
        "namespace": "faq"
      },
      "icon": "❓",
      "name": "FAQ",
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "Answer the questions before they are asked.",
      "version": "1.0.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Questions",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week.",
      "permissions": [],
      "schema_version": 1
    },
    "price": null,
    "approvedPermissions": []
  },
  {
    "id": "a5e8891d-635c-43a4-b0de-ade2dba5285b",
    "key": "core-qr-menu",
    "kind": "app",
    "name": "QR Menu",
    "summary": "A live menu customers scan at the table.",
    "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
    "iconUrl": null,
    "status": "published",
    "latestVersion": "1.0.0",
    "installed": false,
    "enabled": null,
    "installedVersion": null,
    "channel": null,
    "approvalMode": null,
    "updateAvailable": false,
    "updateAdvisory": null,
    "updateChangelog": null,
    "needsApproval": false,
    "updateNewPermissions": [],
    "needsAccessTo": [
      {
        "permission": "menu:read",
        "resource": "menu",
        "action": "read",
        "reason": "Shows your menu sections, items and prices on the QR page.",
        "optional": false,
        "changesThings": false
      },
      {
        "permission": "menu:write",
        "resource": "menu",
        "action": "write",
        "reason": "Lets you edit menu items from inside this app.",
        "optional": true,
        "changesThings": true
      }
    ],
    "contents": {
      "skills": 0,
      "agents": 0,
      "routines": 0,
      "menu": []
    },
    "installId": null,
    "installEnabled": null,
    "versionId": "faa2c48f-7024-44b6-9631-0e7888058404",
    "app": {
      "id": "core-qr-menu",
      "ui": {
        "views": {
          "owner": [
            {
              "type": "collection",
              "source": "items"
            },
            {
              "type": "collection",
              "source": "sections"
            },
            {
              "type": "settings"
            }
          ],
          "public": [
            {
              "type": "list",
              "style": "list",
              "fields": {
                "body": "description",
                "title": "item_name",
                "value": "price"
              },
              "source": "items"
            },
            {
              "text": {
                "setting": "footer_note"
              },
              "type": "text",
              "heading": ""
            }
          ]
        },
        "format": {
          "currency": {
            "setting": "currency"
          }
        },
        "sources": {
          "items": {
            "from": "business",
            "group": "section_id",
            "label": "Menu items",
            "order": "sort_order",
            "title": "item_name",
            "fields": [
              {
                "key": "item_name",
                "type": "text",
                "label": "Name",
                "required": true,
                "maxLength": 120
              },
              {
                "key": "description",
                "type": "longtext",
                "label": "Description",
                "maxLength": 400
              },
              {
                "key": "price",
                "min": 0,
                "type": "money",
                "label": "Price"
              },
              {
                "key": "section_id",
                "type": "select",
                "label": "Section",
                "optionsFrom": {
                  "label": "section_name",
                  "source": "sections"
                }
              },
              {
                "key": "is_available",
                "type": "boolean",
                "label": "Available",
                "default": true
              }
            ],
            "section": "menu_items",
            "resource": "menu",
            "sortable": true,
            "subtitle": "price",
            "visibleWhen": "is_available",
            "labelSingular": "Menu item"
          },
          "sections": {
            "from": "business",
            "label": "Menu sections",
            "order": "sort_order",
            "title": "section_name",
            "fields": [
              {
                "key": "section_name",
                "type": "text",
                "label": "Section",
                "required": true,
                "maxLength": 80
              }
            ],
            "section": "menu_sections",
            "resource": "menu",
            "sortable": true,
            "labelSingular": "Section"
          }
        }
      },
      "icon": "🍽️",
      "name": "QR Menu",
      "config": [
        {
          "key": "currency",
          "help": "A currency code (USD, EUR) or the symbol to show before prices.",
          "type": "text",
          "label": "Currency"
        },
        {
          "key": "footer_note",
          "help": "Shown under the menu, e.g. an allergy notice.",
          "type": "text",
          "label": "Footer note"
        }
      ],
      "pricing": {
        "model": "free"
      },
      "runtime": {
        "type": "engine",
        "engine": "1"
      },
      "summary": "A live menu customers scan at the table.",
      "version": "1.0.0",
      "requires": {
        "platform": "1"
      },
      "surfaces": [
        {
          "id": "owner",
          "kind": "dashboard",
          "path": "/owner",
          "title": "Manage",
          "display_modes": [
            "page"
          ]
        },
        {
          "id": "public",
          "kind": "public",
          "path": "/public",
          "title": "Menu",
          "display_modes": [
            "inline",
            "card",
            "page"
          ]
        }
      ],
      "publisher": "core",
      "description": "Shows the menu the business already keeps — change a price once under Business and the QR menu, the public page and every other screen show it. Customers scan a code and read it on their phone.",
      "permissions": [
        {
          "id": "menu:read",
          "reason": "Shows your menu sections, items and prices on the QR page."
        },
        {
          "id": "menu:write",
          "reason": "Lets you edit menu items from inside this app.",
          "optional": true
        }
      ],
      "schema_version": 1
    },
    "price": {
      "amountCents": 0,
      "currency": "usd",
      "interval": null,
      "model": "free"
    },
    "approvedPermissions": []
  }
]
```
- PASS: Paperclip listing: both items back to not installed (installId null)

## Summary

- Step 1: PASS — path: Paperclip bridge route → gcr POST /api/nextgent/link {create}
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS
- Step 6: PASS
- Step 7: PASS
- Step 8: PASS
- Step 9: PASS — disable: no route; disabled state proven via admin push enabled:false → enable pushes PATCH {enabled:true}
- Step 10: PASS

All steps passed.
