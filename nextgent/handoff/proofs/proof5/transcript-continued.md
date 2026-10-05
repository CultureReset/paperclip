# Proof 5 (continuation run): Step 5, apps in the store, over real HTTP (Paperclip ⇄ gcr-api-clean)

Run at 2026-10-05T02:22:40.862Z.

Paperclip at `http://127.0.0.1:4620` (real routes/store.ts + routes/nextgent.ts on embedded Postgres with all migrations), gcr-api-clean at `http://127.0.0.1:4630` (real routes/nextgent.js, business-data.js, app-data.js, owner.js, mcp.js, platform.js, gcr.js on scripts/lib/memdb.js with a stubbed PostgREST schema document). Shared NEXTGENT_SERVICE_SECRET. Read-only on all three repos; the manifests are the shipped `App-build-/apps/*/manifest.json`, loaded with the engine's `toStorePublication`.

Repo state at run time:
```
457b66c Store: permissions name a known business resource, contacts among them (DECISIONS #59)
---
f5fec8f Menu items carry an order and an availability; menu.items reads in that order (DECISIONS #65)
---
9bff702 Engine: leads and customers are the contacts resource (DECISIONS #59)
```

Paperclip company A: `c1bd877e-4b1a-4fff-a9de-331b714c6d80` (owner `user-ed2d589d-6b9a-42c6-9a0f-6b802ed28c4a`), created by direct insert into companies + an owner membership.

## Step 1: Link the company, seed the business, publish the six shipped apps through the gate, install them (DECISIONS #42, #44–#47, #55, #61)

`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/business-link` (Paperclip as owner A) → **201**
request body:
```json
{
  "create": {
    "name": "Proof Diner",
    "kind": "restaurant"
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
- PASS: gcr handed Paperclip a company-level business_mcp_token with the link (captured from the response; Paperclip stores it sealed)
gcr memdb: entity 'proof-diner' after seeding social_instagram, website_url, currency (is_active true: listed on GCR):
```json
[
  {
    "id": "id-1",
    "created_at": "2026-10-05T02:22:53.784Z",
    "slug": "proof-diner",
    "name": "Proof Diner",
    "entity_type": "restaurant",
    "phone": null,
    "website_url": "https://proofdiner.example",
    "is_active": true,
    "show_in_listings": false,
    "social_instagram": "https://instagram.com/proofdiner",
    "currency": "GBP",
    "timezone": "UTC"
  }
]
```
Seeded (memdb, as the business's own tables): 2 menu_sections, 3 menu_items (inserted 3,1,2 by sort_order), 2 entity_photos, 2 faqs.

### FAQ (`core-faq`): permissions ["business:read","business:write"], bindings {"faqs":"faqs.items read-write"}, events [], tables []
- PASS: FAQ: engine toStorePublication accepts the manifest (validateManifest)
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
  "id": "63d6120a-991f-4c72-b6b6-c281ad10875b",
  "key": "core-faq",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/63d6120a-991f-4c72-b6b6-c281ad10875b/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "business:read",
          "reason": "Shows the questions and answers the business keeps."
        },
        {
          "permission": "business:write",
          "reason": "Lets the owner edit the questions and answers from inside this app."
        }
      ]
    },
    "app": "<manifest core-faq@1.0.0, 1388 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/63d6120a-991f-4c72-b6b6-c281ad10875b/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: FAQ: item created, release 1.0.0 passed the gate (201), published

### Gallery (`core-gallery`): permissions ["business:read","business:write"], bindings {"media":"media.images read-write"}, events [], tables []
- PASS: Gallery: engine toStorePublication accepts the manifest (validateManifest)
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-gallery",
  "kind": "app",
  "name": "Gallery",
  "summary": "Photos of the work, the room, the product.",
  "description": "A grid of images with optional captions. Useful anywhere the thing you do is easier to show than to describe."
}
```
response (selected):
```json
{
  "id": "4086eb16-8e44-49af-b553-a42db51924c5",
  "key": "core-gallery",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/4086eb16-8e44-49af-b553-a42db51924c5/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "business:read",
          "reason": "Shows the photos the business keeps."
        },
        {
          "permission": "business:write",
          "reason": "Lets the owner add, caption and reorder photos from inside this app."
        }
      ]
    },
    "app": "<manifest core-gallery@1.0.0, 1519 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/4086eb16-8e44-49af-b553-a42db51924c5/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Gallery: item created, release 1.0.0 passed the gate (201), published

### Enquiry Form (`core-enquiry-form`): permissions ["contacts:read","contacts:write"], bindings {"leads":"leads.items read-write inbox"}, events ["core-enquiry-form.submitted"], tables []
- PASS: Enquiry Form: engine toStorePublication accepts the manifest (validateManifest)
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-enquiry-form",
  "kind": "app",
  "name": "Enquiry Form",
  "summary": "Catch the people who are ready to talk.",
  "description": "A short form on your page. Every enquiry lands in your app with a status you can work through, so nothing gets lost in a chat thread."
}
```
response (selected):
```json
{
  "id": "2395f1e8-2031-4ed5-9536-f4faaf374559",
  "key": "core-enquiry-form",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/2395f1e8-2031-4ed5-9536-f4faaf374559/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "contacts:read",
          "reason": "Shows the enquiries the business has received."
        },
        {
          "permission": "contacts:write",
          "reason": "Saves each enquiry a visitor sends as a lead of the business."
        }
      ]
    },
    "app": "<manifest core-enquiry-form@1.0.0, 2027 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/2395f1e8-2031-4ed5-9536-f4faaf374559/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Enquiry Form: item created, release 1.0.0 passed the gate (201), published

### Social Links (`core-social-links`): permissions ["business:read","business:write"], bindings {"links":"business.links read-write"}, events [], tables []
- PASS: Social Links: engine toStorePublication accepts the manifest (validateManifest)
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-social-links",
  "kind": "app",
  "name": "Social Links",
  "summary": "Every profile you keep, in one compact row.",
  "description": "All the places people can follow you, in a row that sits under your name rather than eating a whole section."
}
```
response (selected):
```json
{
  "id": "583249ff-c1a6-41d9-a0b3-c261da8d72d1",
  "key": "core-social-links",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/583249ff-c1a6-41d9-a0b3-c261da8d72d1/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "business:read",
          "reason": "Shows the social profiles and links the business keeps."
        },
        {
          "permission": "business:write",
          "reason": "Lets the owner add and reorder links from inside this app."
        }
      ]
    },
    "app": "<manifest core-social-links@1.0.0, 1391 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/583249ff-c1a6-41d9-a0b3-c261da8d72d1/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Social Links: item created, release 1.0.0 passed the gate (201), published

### QR Menu (`core-qr-menu`): permissions ["menu:read","menu:write","business:read"], bindings {"menu_sections":"menu.sections read-write","menu_items":"menu.items read-write","currency":"business.currency read"}, events [], tables []
- PASS: QR Menu: engine toStorePublication accepts the manifest (validateManifest)
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
  "id": "9ee39e04-7963-4b9c-970c-98251a72afca",
  "key": "core-qr-menu",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/9ee39e04-7963-4b9c-970c-98251a72afca/versions` (Paperclip as admin) → **201**
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
        },
        {
          "permission": "business:read",
          "reason": "Prices are shown in the currency the business set."
        }
      ]
    },
    "app": "<manifest core-qr-menu@1.0.0, 2526 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/9ee39e04-7963-4b9c-970c-98251a72afca/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: QR Menu: item created, release 1.0.0 passed the gate (201), published

### Song Requests (`core-song-requests`): permissions [], bindings {}, events ["core-song-requests.submitted"], tables ["requests"]
- PASS: Song Requests: engine toStorePublication accepts the manifest (validateManifest)
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "core-song-requests",
  "kind": "app",
  "name": "Song Requests",
  "summary": "Let the room send you tracks without shouting over the music.",
  "description": "Visitors scan a code and send a request. Every request lands in your queue where you can play it, skip it or hide it. The crowd never sees the queue."
}
```
response (selected):
```json
{
  "id": "3848965b-ab95-4463-bb10-a53f27114d4a",
  "key": "core-song-requests",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/3848965b-ab95-4463-bb10-a53f27114d4a/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": []
    },
    "app": "<manifest core-song-requests@1.0.0, 2216 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/3848965b-ab95-4463-bb10-a53f27114d4a/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Song Requests: item created, release 1.0.0 passed the gate (201), published
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/63d6120a-991f-4c72-b6b6-c281ad10875b/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "2580c4da-d70f-4eed-bc05-9580537fb858",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "641a628c-0ffc-4a87-b45b-5d5805a67ea3"
}
```
- PASS: core-faq: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/4086eb16-8e44-49af-b553-a42db51924c5/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "b29e34a0-9be9-41cd-9421-c0d707cd6187",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "63d7e764-838a-4ac2-832f-d0402daa822b"
}
```
- PASS: core-gallery: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/2395f1e8-2031-4ed5-9536-f4faaf374559/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "d26a9899-226a-422d-84cb-8a21058cc3c2",
  "enabled": true,
  "approvedPermissions": [
    "contacts:read",
    "contacts:write"
  ],
  "tokenSecretId": "cba785c5-12ae-4f6c-b8ac-c52b5b8dfe0c"
}
```
- PASS: core-enquiry-form: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/583249ff-c1a6-41d9-a0b3-c261da8d72d1/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "a599e374-50af-409e-a45b-53985fc0e871",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "73d8a8e6-cc2d-45ae-8023-3538c5f7e86f"
}
```
- PASS: core-social-links: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/9ee39e04-7963-4b9c-970c-98251a72afca/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "f8876bda-4fa1-4e87-bb61-b859c510a7e5",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "menu:read",
    "menu:write"
  ],
  "tokenSecretId": "568ea414-782e-43da-8c74-d1b8513f05a3"
}
```
- PASS: core-qr-menu: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/3848965b-ab95-4463-bb10-a53f27114d4a/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
  "enabled": true,
  "approvedPermissions": [],
  "tokenSecretId": "d0e8b242-82f8-4f81-b235-848f9196d952"
}
```
- PASS: core-song-requests: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
gcr memdb: nextgent_installs:
```json
[
  {
    "install_id": "2580c4da-d70f-4eed-bc05-9580537fb858",
    "entity_slug": "proof-diner",
    "item_key": "core-faq",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "business:read",
      "business:write"
    ],
    "status": "active"
  },
  {
    "install_id": "b29e34a0-9be9-41cd-9421-c0d707cd6187",
    "entity_slug": "proof-diner",
    "item_key": "core-gallery",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "business:read",
      "business:write"
    ],
    "status": "active"
  },
  {
    "install_id": "d26a9899-226a-422d-84cb-8a21058cc3c2",
    "entity_slug": "proof-diner",
    "item_key": "core-enquiry-form",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "contacts:read",
      "contacts:write"
    ],
    "status": "active"
  },
  {
    "install_id": "a599e374-50af-409e-a45b-53985fc0e871",
    "entity_slug": "proof-diner",
    "item_key": "core-social-links",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "business:read",
      "business:write"
    ],
    "status": "active"
  },
  {
    "install_id": "f8876bda-4fa1-4e87-bb61-b859c510a7e5",
    "entity_slug": "proof-diner",
    "item_key": "core-qr-menu",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [
      "business:read",
      "menu:read",
      "menu:write"
    ],
    "status": "active"
  },
  {
    "install_id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
    "entity_slug": "proof-diner",
    "item_key": "core-song-requests",
    "kind": "app",
    "version": "1.0.0",
    "permissions": [],
    "status": "active"
  }
]
```
gcr memdb: entity_modules (Paperclip's rows, manifests summarised):
```json
[
  {
    "id": "id-5",
    "install_id": "2580c4da-d70f-4eed-bc05-9580537fb858",
    "entity_slug": "proof-diner",
    "module_key": "core-faq",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-faq@1.0.0, bindings faqs, events ->",
    "showOnPublic": true
  },
  {
    "id": "id-8",
    "install_id": "b29e34a0-9be9-41cd-9421-c0d707cd6187",
    "entity_slug": "proof-diner",
    "module_key": "core-gallery",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-gallery@1.0.0, bindings media, events ->",
    "showOnPublic": true
  },
  {
    "id": "id-11",
    "install_id": "d26a9899-226a-422d-84cb-8a21058cc3c2",
    "entity_slug": "proof-diner",
    "module_key": "core-enquiry-form",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-enquiry-form@1.0.0, bindings leads, events core-enquiry-form.submitted>",
    "showOnPublic": true
  },
  {
    "id": "id-14",
    "install_id": "a599e374-50af-409e-a45b-53985fc0e871",
    "entity_slug": "proof-diner",
    "module_key": "core-social-links",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-social-links@1.0.0, bindings links, events ->",
    "showOnPublic": true
  },
  {
    "id": "id-17",
    "install_id": "f8876bda-4fa1-4e87-bb61-b859c510a7e5",
    "entity_slug": "proof-diner",
    "module_key": "core-qr-menu",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-qr-menu@1.0.0, bindings currency/menu_items/menu_sections, events ->",
    "showOnPublic": true
  },
  {
    "id": "id-20",
    "install_id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
    "entity_slug": "proof-diner",
    "module_key": "core-song-requests",
    "enabled": true,
    "version": "1.0.0",
    "managed_by": "paperclip",
    "manifest": "<manifest core-song-requests@1.0.0, bindings -, events core-song-requests.submitted>",
    "showOnPublic": true
  }
]
```
- PASS: gcr saw six signed POST /api/nextgent/installs, each carrying the whole manifest (app.bindings present)
- PASS: six nextgent_installs rows for the slug, all active, kind app, with the approved permissions
- PASS: six entity_modules rows managed_by paperclip for the slug, enabled, settings.manifest = the shipped manifest (id, bindings, events kept whole)
- PASS: the legacy row on another business is untouched
- PASS: one business_mcp_tokens row per install (hash only, install_id, permissions) plus the company-level one

## Step 2: Store listing for the company: item.app carries bindings; needsAccessTo lists the derived permissions, contacts:* for Enquiry Form (DECISIONS #59)

`GET {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store` (Paperclip as owner A) → **200**
response: <18156 bytes>
- PASS: listing 200 with the six apps installed

core-faq: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"faqs":{"access":"read-write","contract":"faqs.items"}}; installId 2580c4da-d70f-4eed-bc05-9580537fb858
- PASS: core-faq: item.app is the manifest with bindings as shipped
- PASS: core-faq: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-gallery: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"media":{"access":"read-write","contract":"media.images","fieldMap":{"image_url":"url"}}}; installId b29e34a0-9be9-41cd-9421-c0d707cd6187
- PASS: core-gallery: item.app is the manifest with bindings as shipped
- PASS: core-gallery: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-enquiry-form: needsAccessTo ["contacts:read","contacts:write [changes things]"]; app.bindings {"leads":{"inbox":true,"access":"read-write","contract":"leads.items"}}; installId d26a9899-226a-422d-84cb-8a21058cc3c2
- PASS: core-enquiry-form: item.app is the manifest with bindings as shipped
- PASS: core-enquiry-form: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-social-links: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"links":{"access":"read-write","contract":"business.links"}}; installId a599e374-50af-409e-a45b-53985fc0e871
- PASS: core-social-links: item.app is the manifest with bindings as shipped
- PASS: core-social-links: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-qr-menu: needsAccessTo ["menu:read","menu:write (optional) [changes things]","business:read"]; app.bindings {"currency":{"access":"read","contract":"business.currency"},"menu_items":{"access":"read-write","contract":"menu.items"},"menu_sections":{"access":"read-write","contract":"menu.sections"}}; installId f8876bda-4fa1-4e87-bb61-b859c510a7e5
- PASS: core-qr-menu: item.app is the manifest with bindings as shipped
- PASS: core-qr-menu: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-song-requests: needsAccessTo []; app.bindings null; installId f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe
- PASS: core-song-requests: item.app is the manifest with bindings as shipped
- PASS: core-song-requests: needsAccessTo = the manifest's permissions with resource/action split and reasons
- PASS: Enquiry Form needsAccessTo includes contacts:read and contacts:write (resource contacts), write flagged as changing things
- PASS: listing installIds match the install rows gcr holds

## Step 3: Each install's short-lived token reaches its bound business data through gcr /api/business/<contract> (DECISIONS #45, #56, #57, #59, #63, #65)

`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/2580c4da-d70f-4eed-bc05-9580537fb858/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-faq: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/b29e34a0-9be9-41cd-9421-c0d707cd6187/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-gallery: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/d26a9899-226a-422d-84cb-8a21058cc3c2/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-enquiry-form: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/a599e374-50af-409e-a45b-53985fc0e871/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-social-links: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/f8876bda-4fa1-4e87-bb61-b859c510a7e5/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-qr-menu: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/installs/f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:54.000Z"
}
```
- PASS: core-song-requests: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session

### FAQ → faqs.items (bound; no app table)
`GET {gcr}/api/business/faqs.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "faqs",
  "contract": "faqs.items",
  "rows": [
    {
      "id": "faq-1",
      "entity_slug": "proof-diner",
      "question": "Do you take bookings?",
      "answer": "Walk-ins only.",
      "sort_order": 0
    },
    {
      "id": "faq-2",
      "entity_slug": "proof-diner",
      "question": "Is there parking?",
      "answer": "Behind the building.",
      "sort_order": 1
    }
  ],
  "total": 2,
  "limit": 200,
  "offset": 0
}
```
- PASS: FAQ token reads faqs.items: 200, table faqs, contract faqs.items, the two seeded rows
`POST {gcr}/api/business/faqs.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **201**
request body:
```json
{
  "question": "Do you do takeaway?",
  "answer": "Yes, call ahead.",
  "entity_slug": "someone-else"
}
```
response:
```json
{
  "table": "faqs",
  "contract": "faqs.items",
  "row": {
    "id": "id-22",
    "created_at": "2026-10-05T02:22:54.961Z",
    "question": "Do you do takeaway?",
    "answer": "Yes, call ahead.",
    "entity_slug": "proof-diner"
  }
}
```
- PASS: FAQ token creates a faqs row: 201, entity_slug is the install's business (the body's slug was dropped)
- PASS: faqs now has 3 rows for the slug; app_records has none (business data, not app records)

### Gallery → media.images (entity_photos)
`GET {gcr}/api/business/media.images` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "entity_photos",
  "contract": "media.images",
  "rows": [
    {
      "id": "photo-1",
      "entity_slug": "proof-diner",
      "url": "https://img.example/room.jpg",
      "caption": "The room",
      "is_cover": true,
      "sort_order": 0
    },
    {
      "id": "photo-2",
      "entity_slug": "proof-diner",
      "url": "https://img.example/plate.jpg",
      "caption": "Gumbo night",
      "is_cover": false,
      "sort_order": 1
    }
  ],
  "total": 2,
  "limit": 200,
  "offset": 0
}
```
- PASS: Gallery token reads media.images: 200, table entity_photos, the two photos with url/caption/is_cover

### QR Menu → menu.sections, menu.items (ordered by sort_order), business.currency → { value }
`GET {gcr}/api/business/menu.sections` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "menu_sections",
  "contract": "menu.sections",
  "rows": [
    {
      "id": "sec-starters",
      "entity_slug": "proof-diner",
      "section_name": "Starters",
      "sort_order": 1
    },
    {
      "id": "sec-mains",
      "entity_slug": "proof-diner",
      "section_name": "Mains",
      "sort_order": 2
    }
  ],
  "total": 2,
  "limit": 200,
  "offset": 0
}
```
- PASS: menu.sections: 200, table menu_sections, two sections
`GET {gcr}/api/business/menu.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "menu_items",
  "contract": "menu.items",
  "rows": [
    {
      "id": "item-a",
      "entity_slug": "proof-diner",
      "item_name": "Boiled Peanuts",
      "description": "Cajun",
      "price": 4,
      "section_id": "sec-starters",
      "is_available": true,
      "sort_order": 1
    },
    {
      "id": "item-b",
      "entity_slug": "proof-diner",
      "item_name": "Hush Puppies",
      "description": null,
      "price": 6,
      "section_id": "sec-starters",
      "is_available": false,
      "sort_order": 2
    },
    {
      "id": "item-c",
      "entity_slug": "proof-diner",
      "item_name": "Gumbo",
      "description": "Dark roux, andouille",
      "price": 14.5,
      "section_id": "sec-mains",
      "is_available": true,
      "sort_order": 3
    }
  ],
  "total": 3,
  "limit": 200,
  "offset": 0
}
```
- PASS: menu.items: 200, table menu_items, three items in sort_order (1,2,3) although inserted 3,1,2
- PASS: menu.items rows carry is_available and section_id
`GET {gcr}/api/business/business.currency` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "entity",
  "contract": "business.currency",
  "value": "GBP"
}
```
- PASS: business.currency: 200 → { table entity, contract business.currency, value 'GBP' } (a scalar contract, DECISIONS #56)
`POST {gcr}/api/business/business.currency` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
request body:
```json
{
  "currency": "EUR"
}
```
response:
```json
{
  "error": "This connection is not allowed to write business.currency."
}
```
- PASS: business.currency is read-only through the contract: a write is refused (403)

### Social Links → business.links as rows { id, network, url }; a PATCH changes the entity column (DECISIONS #63, #67)
`GET {gcr}/api/business/business.links` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "entity",
  "contract": "business.links",
  "rows": [
    {
      "id": "website",
      "network": "website",
      "url": "https://proofdiner.example"
    },
    {
      "id": "instagram",
      "network": "instagram",
      "url": "https://instagram.com/proofdiner"
    }
  ],
  "total": 2,
  "limit": 200,
  "offset": 0
}
```
- PASS: business.links: 200, rows derived from the entity's set link columns: instagram and website, each { id, network, url }
`PATCH {gcr}/api/business/business.links/instagram` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
request body:
```json
{
  "url": "https://instagram.com/proofdiner.official"
}
```
response:
```json
{
  "table": "entity",
  "contract": "business.links",
  "row": {
    "id": "instagram",
    "network": "instagram",
    "url": "https://instagram.com/proofdiner.official"
  }
}
```
- PASS: PATCH business.links/instagram { url } → 200 with the row
- PASS: entity.social_instagram is the new url; website_url and the rest unchanged
`PATCH {gcr}/api/business/business.links/slug` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **404**
request body:
```json
{
  "url": "https://evil.example"
}
```
response:
```json
{
  "error": "That row is not there."
}
```
- PASS: a row id that names a non-link column (slug) → 404: a pivot row can never reach another column

### Enquiry Form → leads.items with contacts:write; a token without contacts is refused (DECISIONS #59)
`POST {gcr}/api/business/leads.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **201**
request body:
```json
{
  "name": "Pat Lee",
  "email": "pat@example.com",
  "phone": "+15550100200",
  "message": "Private room for 12?"
}
```
response:
```json
{
  "table": "entity_leads",
  "contract": "leads.items",
  "row": {
    "id": "id-23",
    "created_at": "2026-10-05T02:22:55.000Z",
    "name": "Pat Lee",
    "email": "pat@example.com",
    "phone": "+15550100200",
    "message": "Private room for 12?",
    "entity_slug": "proof-diner"
  }
}
```
- PASS: Enquiry Form token POSTs leads.items → 201, table entity_leads, row for the slug
`GET {gcr}/api/business/leads.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response:
```json
{
  "table": "entity_leads",
  "contract": "leads.items",
  "rows": [
    {
      "id": "id-23",
      "created_at": "2026-10-05T02:22:55.000Z",
      "name": "Pat Lee",
      "email": "pat@example.com",
      "phone": "+15550100200",
      "message": "Private room for 12?",
      "entity_slug": "proof-diner"
    }
  ],
  "total": 1,
  "limit": 200,
  "offset": 0
}
```
- PASS: Enquiry Form token reads leads.items (contacts:read) → the one lead
`GET {gcr}/api/business/leads.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
response:
```json
{
  "error": "This connection is not allowed to read leads.items."
}
```
- PASS: Gallery's token (business:read/write, no contacts) on leads.items → 403
`GET {gcr}/api/business/entity_leads` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
response:
```json
{
  "error": "This connection is not allowed to read entity_leads."
}
```
- PASS: Gallery's token on the raw table entity_leads → 403 (the table resolves to contacts through the registry, never business)
`POST {gcr}/api/business/entity_leads` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
request body:
```json
{
  "name": "x",
  "email": "x@example.com"
}
```
response:
```json
{
  "error": "This connection is not allowed to write entity_leads."
}
```
- PASS: Gallery's token writing entity_leads → 403
`GET {gcr}/api/business/customers.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
response:
```json
{
  "error": "This connection is not allowed to read customers.items."
}
```
- PASS: QR Menu's token (menu, business:read) on customers.items → 403
`GET {gcr}/api/business/faqs.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **403**
response:
```json
{
  "error": "This connection is not allowed to read faqs.items."
}
```
- PASS: Enquiry Form's token (contacts only) on faqs.items → 403: contacts does not imply business
- PASS: entity_leads holds exactly one row, for the slug

## Step 4: Public: a visitor's submission into the bound leads source and into the Song Requests app table; the Messages inbox; the declared events (DECISIONS #48, #55, #57, #60, #61)

`GET {gcr}/api/public/apps/d26a9899-226a-422d-84cb-8a21058cc3c2` (gcr-api-clean) → **200**
response: <2080 bytes>
- PASS: GET /api/public/apps/<enquiry install> → 200 with the manifest and public settings; no lead data on the public page (leads.items is a table of people)
`POST {gcr}/api/public/apps/d26a9899-226a-422d-84cb-8a21058cc3c2/enquiries` (gcr-api-clean) → **201**
request body:
```json
{
  "name": "Visitor Vee",
  "email": "vee@example.com",
  "message": "Do you cater weddings?",
  "status": "won",
  "entity_slug": "someone-else"
}
```
response:
```json
{
  "table": "enquiries",
  "row": {
    "id": "id-24",
    "created_at": "2026-10-05T02:22:55.027Z"
  }
}
```
- PASS: POST /api/public/apps/<enquiry install>/enquiries (the source key, resolved through the manifest's binding) → 201 with a receipt { id, created_at } only
gcr memdb: entity_leads:
```json
[
  {
    "id": "id-23",
    "created_at": "2026-10-05T02:22:55.000Z",
    "name": "Pat Lee",
    "email": "pat@example.com",
    "phone": "+15550100200",
    "message": "Private room for 12?",
    "entity_slug": "proof-diner"
  },
  {
    "id": "id-24",
    "created_at": "2026-10-05T02:22:55.027Z",
    "name": "Visitor Vee",
    "email": "vee@example.com",
    "message": "Do you cater weddings?",
    "entity_slug": "proof-diner"
  }
]
```
- PASS: entity_leads has the visitor's row for the slug; the owner-only 'status' and the body's slug were dropped
gcr memdb: message_threads:
```json
[
  {
    "id": "id-25",
    "created_at": "2026-10-05T02:22:55.029Z",
    "entity_slug": "proof-diner",
    "channel": "app",
    "customer_address": "vee@example.com",
    "mode": "agent",
    "last_message_at": "2026-10-05T02:22:55.029Z"
  }
]
```
gcr memdb: business_messages:
```json
[
  {
    "id": "id-26",
    "created_at": "2026-10-05T02:22:55.029Z",
    "entity_slug": "proof-diner",
    "thread_id": "id-25",
    "channel": "app",
    "direction": "in",
    "customer_address": "vee@example.com",
    "body": "Visitor Vee\nemail: vee@example.com\nmessage: Do you cater weddings?\nentity_slug: proof-diner",
    "status": "received",
    "author": "customer",
    "install_id": "d26a9899-226a-422d-84cb-8a21058cc3c2"
  }
]
```
- PASS: one business_messages row: channel app, direction in, install_id = the enquiry install, customer_address = the visitor's email, body carries the message
- PASS: its message_threads row: channel app, the slug, customer_address = the visitor's email
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/business-token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:27:55.000Z"
}
```
- PASS: Paperclip business token (JWT) issued for company A
`GET {gcr}/api/owner/messages/threads` (gcr-api-clean, Bearer JWT) → **200**
response:
```json
{
  "threads": [
    {
      "id": "id-25",
      "channel": "app",
      "contact": "vee@example.com",
      "last_message": "Visitor Vee\nemail: vee@example.com\nmessage: Do you cater weddings?\nentity_slug: proof-diner",
      "last_at": "2026-10-05T02:22:55.029Z",
      "unread": 1,
      "handled_by": "agent",
      "source": {
        "installId": "d26a9899-226a-422d-84cb-8a21058cc3c2",
        "appKey": "core-enquiry-form"
      }
    }
  ],
  "waiting_for_approval": 0
}
```
- PASS: GET /api/owner/messages/threads shows the thread: channel app, contact = the email, unread 1, source { installId, appKey: core-enquiry-form }
`GET {gcr}/api/owner/messages/threads/id-25` (gcr-api-clean, Bearer JWT) → **200**
response:
```json
{
  "thread": {
    "id": "id-25",
    "channel": "app",
    "contact": "vee@example.com",
    "handled_by": "agent",
    "source": {
      "installId": "d26a9899-226a-422d-84cb-8a21058cc3c2",
      "appKey": "core-enquiry-form"
    }
  },
  "messages": [
    {
      "id": "id-26",
      "direction": "in",
      "text": "Visitor Vee\nemail: vee@example.com\nmessage: Do you cater weddings?\nentity_slug: proof-diner",
      "at": "2026-10-05T02:22:55.029Z",
      "author": "customer",
      "status": "received"
    }
  ]
}
```
- PASS: thread detail: one inbound message with the submission body, source on the thread
gcr automation events emitted during the submission (lib/automationEngine.emitEvent, wrapped):
```json
[
  {
    "at": "2026-10-05T02:22:55.028Z",
    "event": "core-enquiry-form.submitted",
    "slug": "proof-diner",
    "payload": {
      "app": "core-enquiry-form",
      "installId": "d26a9899-226a-422d-84cb-8a21058cc3c2",
      "table": "enquiries",
      "record": {
        "id": "id-24",
        "created_at": "2026-10-05T02:22:55.027Z",
        "name": "Visitor Vee",
        "email": "vee@example.com",
        "message": "Do you cater weddings?",
        "entity_slug": "proof-diner"
      },
      "source": "visitor"
    },
    "result": {
      "ran": 0
    }
  }
]
```
- PASS: the declared event core-enquiry-form.submitted was emitted for the slug with { app, installId, table: enquiries, record, source: visitor }, exactly once
- PASS: the event payload's record carries no owner-only status value from the visitor
knownEvents(proof-diner) (lib/automationEngine.knownEvents = platform EVENTS + appEventsFor): ["intake.created","automation.installed","booking.created","booking.changed","booking.cancelled","booking.completed","payment.received","review.received","core-enquiry-form.submitted","core-song-requests.submitted"]
- PASS: knownEvents for the business includes core-enquiry-form.submitted and core-song-requests.submitted (the installed manifests are the registry)

### Song Requests → its own app table (public append, inbox default on)
`POST {gcr}/api/public/apps/f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe/requests` (gcr-api-clean) → **201**
request body:
```json
{
  "song": "Blue Monday",
  "artist": "New Order",
  "from_name": "Sam",
  "status": "played"
}
```
response:
```json
{
  "table": "requests",
  "row": {
    "id": "id-27",
    "created_at": "2026-10-05T02:22:55.130Z"
  }
}
```
- PASS: POST /api/public/apps/<song install>/requests → 201 receipt
gcr memdb: app_records:
```json
[
  {
    "id": "id-27",
    "created_at": "2026-10-05T02:22:55.130Z",
    "install_id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
    "entity_slug": "proof-diner",
    "app_table": "requests",
    "data": {
      "note": null,
      "song": "Blue Monday",
      "artist": "New Order",
      "status": "pending",
      "from_name": "Sam"
    },
    "source": "visitor"
  }
]
```
- PASS: app_records has the request: install_id, entity_slug, app_table requests, source visitor; owner-only status dropped (default pending)
- PASS: a second business_messages row: channel app, install_id = the song install, customer_address falls back to the first text field (the song) since there is no email/phone
`GET {gcr}/api/owner/messages/threads` (gcr-api-clean, Bearer JWT) → **200**
response: <649 bytes>
- PASS: the owner's threads now show a second app thread with source.appKey core-song-requests
gcr automation events emitted during the song request:
```json
[
  {
    "at": "2026-10-05T02:22:55.130Z",
    "event": "core-song-requests.submitted",
    "slug": "proof-diner",
    "payload": {
      "app": "core-song-requests",
      "installId": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
      "table": "requests",
      "record": {
        "note": null,
        "song": "Blue Monday",
        "artist": "New Order",
        "from_name": "Sam",
        "id": "id-27",
        "created_at": "2026-10-05T02:22:55.130Z",
        "updated_at": "2026-10-05T02:22:55.130Z"
      },
      "source": "visitor"
    },
    "result": {
      "ran": 0
    }
  }
]
```
- PASS: core-song-requests.submitted emitted once for the slug with table requests, source visitor, the record
`POST {gcr}/api/public/apps/f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe/nothing` (gcr-api-clean) → **404**
request body:
```json
{
  "x": 1
}
```
response:
```json
{
  "error": "Not a table of this app: nothing"
}
```
- PASS: a source key the manifest does not declare → 404

## Step 5: Agent face (DECISIONS #46): the business MCP lists installed apps' declared actions as app_<key>_<action> tools under the install's permissions

None of the six shipped manifests declares `actions` (checked: apps/*/manifest.json). To exercise the agent face this step publishes a proof-only seventh app, `proof-agent-faq`: the shipped FAQ manifest with its id/name/publisher changed and three actions added (list_faqs read, add_faq create, edit_faq update, all through the `faqs` binding). It goes through the same engine validator and the same Paperclip gate.
- PASS: Agent FAQ (proof): engine toStorePublication accepts the manifest (validateManifest)
`POST {paperclip}/api/store/admin/items` (Paperclip as admin) → **201**
request body:
```json
{
  "key": "proof-agent-faq",
  "kind": "app",
  "name": "Agent FAQ (proof)",
  "summary": "Answer the questions before they are asked.",
  "description": "A list of questions and answers that expand when tapped. Cuts down the same messages you answer every week."
}
```
response (selected):
```json
{
  "id": "e8fa83b4-aeba-40f2-a41a-1d68b4eeb576",
  "key": "proof-agent-faq",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/e8fa83b4-aeba-40f2-a41a-1d68b4eeb576/versions` (Paperclip as admin) → **201**
request body:
```json
{
  "version": "1.0.0",
  "payload": {
    "nextgent": {
      "kind": "app",
      "permissions": [
        {
          "permission": "business:read",
          "reason": "Shows the questions and answers the business keeps."
        },
        {
          "permission": "business:write",
          "reason": "Lets the owner edit the questions and answers from inside this app."
        }
      ]
    },
    "app": "<manifest proof-agent-faq@1.0.0, 1740 bytes>"
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
  "needsApprovalFor": []
}
```
`POST {paperclip}/api/store/admin/items/e8fa83b4-aeba-40f2-a41a-1d68b4eeb576/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Agent FAQ (proof): item created, release 1.0.0 passed the gate (201), published
`POST {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/e8fa83b4-aeba-40f2-a41a-1d68b4eeb576/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "fd5eaaa5-dfcb-4979-a49c-89b7aebbc0d3",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ]
}
```
- PASS: proof app installed with business:read, business:write
- PASS: its entity_modules row carries the manifest with actions

### With the company's business_mcp_token (from the link: every resource, read and write)
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer business_mcp_token (gcr_mcp_…)) → **200**
response: <1018 bytes>
- PASS: initialize → serverInfo and instructions
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer business_mcp_token (gcr_mcp_…)) → **200**
response: <5780 bytes>
tools/list → ["whoami","list_sections","describe_section","read_section","create_row","update_row","delete_row","app_proof-agent-faq_list_faqs","app_proof-agent-faq_add_faq","app_proof-agent-faq_edit_faq"]
- PASS: tools/list includes app_proof-agent-faq_list_faqs, _add_faq, _edit_faq beside the seven generic tools
- PASS: no app tools for the six shipped apps (they declare no actions)
- PASS: the read tool is annotated readOnlyHint and titled with the app's name
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer business_mcp_token (gcr_mcp_…)) → **200**
request body:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "app_proof-agent-faq_list_faqs",
    "arguments": {}
  }
}
```
response:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"app\": \"proof-agent-faq\",\n  \"action\": \"list_faqs\",\n  \"section\": \"faqs\",\n  \"contract\": \"faqs.items\",\n  \"rows\": [\n    {\n      \"id\": \"faq-1\",\n      \"entity_slug\": \"proof-diner\",\n      \"question\": \"Do you take bookings?\",\n      \"answer\": \"Walk-ins only.\",\n      \"sort_order\": 0\n    },\n    {\n      \"id\": \"faq-2\",\n      \"entity_slug\": \"proof-diner\",\n      \"question\": \"Is there parking?\",\n      \"answer\": \"Behind the building.\",\n      \"sort_order\": 1\n    },\n    {\n      \"id\": \"id-22\",\n      \"created_at\": \"2026-10-05T02:22:54.961Z\",\n      \"question\": \"Do you do takeaway?\",\n      \"answer\": \"Yes, call ahead.\",\n      \"entity_slug\": \"proof-diner\"\n    }\n  ],\n  \"returned\": 3,\n  \"total_matching\": 3,\n  \"limit\": 50,\n  \"offset\": 0\n}"
      }
    ],
    "structuredContent": {
      "app": "proof-agent-faq",
      "action": "list_faqs",
      "section": "faqs",
      "contract": "faqs.items",
      "rows": [
        {
          "id": "faq-1",
          "entity_slug": "proof-diner",
          "question": "Do you take bookings?",
          "answer": "Walk-ins only.",
          "sort_order": 0
        },
        {
          "id": "faq-2",
          "entity_slug": "proof-diner",
          "question": "Is there parking?",
          "answer": "Behind the building.",
          "sort_order": 1
        },
        {
          "id": "id-22",
          "created_at": "2026-10-05T02:22:54.961Z",
          "question": "Do you do takeaway?",
          "answer": "Yes, call ahead.",
          "entity_slug": "proof-diner"
        }
      ],
      "returned": 3,
      "total_matching": 3,
      "limit": 50,
      "offset": 0
    }
  }
}
```
- PASS: tools/call list_faqs → the faqs rows through the contract (section faqs, contract faqs.items), 3 rows, app and action named
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer business_mcp_token (gcr_mcp_…)) → **200**
request body:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "app_proof-agent-faq_add_faq",
    "arguments": {
      "values": {
        "question": "Dogs?",
        "answer": "On the patio, yes.",
        "entity_slug": "someone-else"
      }
    }
  }
}
```
response:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"app\": \"proof-agent-faq\",\n  \"action\": \"add_faq\",\n  \"section\": \"faqs\",\n  \"contract\": \"faqs.items\",\n  \"created\": {\n    \"id\": \"id-33\",\n    \"created_at\": \"2026-10-05T02:22:55.297Z\",\n    \"question\": \"Dogs?\",\n    \"answer\": \"On the patio, yes.\",\n    \"entity_slug\": \"proof-diner\"\n  }\n}"
      }
    ],
    "structuredContent": {
      "app": "proof-agent-faq",
      "action": "add_faq",
      "section": "faqs",
      "contract": "faqs.items",
      "created": {
        "id": "id-33",
        "created_at": "2026-10-05T02:22:55.297Z",
        "question": "Dogs?",
        "answer": "On the patio, yes.",
        "entity_slug": "proof-diner"
      }
    }
  }
}
```
- PASS: tools/call add_faq → a faqs row created for the business (the slug in values was dropped)
- PASS: faqs has 4 rows for the slug, none for anyone else

### With QR Menu's install token (menu:read, menu:write, business:read — no business:write)
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response: <4548 bytes>
tools/list → ["whoami","list_sections","describe_section","read_section","create_row","update_row","delete_row","app_proof-agent-faq_list_faqs"]
- PASS: the read action is listed (business:read), the write actions are not (no business:write)
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
request body:
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "app_proof-agent-faq_add_faq",
    "arguments": {
      "values": {
        "question": "x?",
        "answer": "y"
      }
    }
  }
}
```
response:
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "error": {
    "code": -32601,
    "message": "No tool called \"app_proof-agent-faq_add_faq\"."
  }
}
```
- PASS: calling add_faq with it → JSON-RPC error -32601 (no such tool for this caller)
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response: <1099 bytes>
- PASS: calling list_faqs with it works (2 rows asked for)

### With Enquiry Form's install token (contacts only)
`POST {gcr}/api/mcp` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response: <3901 bytes>
- PASS: no app tools at all for a token holding neither business:read nor business:write
- PASS: faqs still has 4 rows (the denied call wrote nothing)

## Step 6: Legacy safety: a legacy dashboard save (POST /api/platform/state) that omits these apps leaves every Paperclip row intact; GET /api/gcr/entity/:slug lists them with managed_by

The legacy dashboard signs in with an Express JWT (JWT_SECRET; middleware/auth.js authRequired); entity_owners maps its siteId to the slug.
`GET {gcr}/api/platform/state` (gcr-api-clean, Bearer JWT) → **200**
response:
```json
{
  "business": {
    "name": "Proof Diner",
    "slug": "proof-diner",
    "type": "restaurant",
    "tagline": "",
    "emoji": "🏪",
    "phone": "",
    "email": "",
    "accent": "#22c3a6",
    "hero": null,
    "logo": null,
    "website": "https://proofdiner.example",
    "instagram": "https://instagram.com/proofdiner.official",
    "facebook": null,
    "tiktok": null
  },
  "installed": {},
  "page_order": []
}
```
- PASS: GET /api/platform/state: the legacy view sees none of Paperclip's installs (installed {} , page_order [])
`POST {gcr}/api/platform/state` (gcr-api-clean, Bearer JWT) → **200**
request body:
```json
{
  "business": {
    "name": "Proof Diner",
    "tagline": "Gulf coast kitchen"
  },
  "installed": {
    "menu": {
      "enabled": true,
      "manifest": {
        "block": "menu",
        "dataKey": "menu_items"
      },
      "config": {
        "columns": 2
      }
    }
  },
  "page_order": [
    "menu"
  ]
}
```
response:
```json
{
  "success": true,
  "slug": "proof-diner"
}
```
- PASS: POST /api/platform/state → 200 { success, slug }
gcr memdb: entity_modules after the legacy save (summarised):
```json
[
  {
    "id": "legacy-1",
    "entity_slug": "other-shop",
    "module_key": "menu",
    "enabled": true,
    "managed_by": null,
    "install_id": null,
    "manifest": "menu"
  },
  {
    "id": "id-5",
    "entity_slug": "proof-diner",
    "module_key": "core-faq",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "2580c4da-d70f-4eed-bc05-9580537fb858",
    "manifest": "core-faq"
  },
  {
    "id": "id-8",
    "entity_slug": "proof-diner",
    "module_key": "core-gallery",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "b29e34a0-9be9-41cd-9421-c0d707cd6187",
    "manifest": "core-gallery"
  },
  {
    "id": "id-11",
    "entity_slug": "proof-diner",
    "module_key": "core-enquiry-form",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "d26a9899-226a-422d-84cb-8a21058cc3c2",
    "manifest": "core-enquiry-form"
  },
  {
    "id": "id-14",
    "entity_slug": "proof-diner",
    "module_key": "core-social-links",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "a599e374-50af-409e-a45b-53985fc0e871",
    "manifest": "core-social-links"
  },
  {
    "id": "id-17",
    "entity_slug": "proof-diner",
    "module_key": "core-qr-menu",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "f8876bda-4fa1-4e87-bb61-b859c510a7e5",
    "manifest": "core-qr-menu"
  },
  {
    "id": "id-20",
    "entity_slug": "proof-diner",
    "module_key": "core-song-requests",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
    "manifest": "core-song-requests"
  },
  {
    "id": "id-31",
    "entity_slug": "proof-diner",
    "module_key": "proof-agent-faq",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "fd5eaaa5-dfcb-4979-a49c-89b7aebbc0d3",
    "manifest": "proof-agent-faq"
  },
  {
    "id": "id-34",
    "entity_slug": "proof-diner",
    "module_key": "menu",
    "enabled": true,
    "managed_by": null,
    "install_id": null,
    "manifest": "menu"
  }
]
```
- PASS: all seven Paperclip rows are byte-for-byte unchanged (none deleted, disabled or rewritten)
- PASS: the legacy save added its own 'menu' row for the slug (managed_by null) and left the other business's legacy row alone
- PASS: the entity keeps its link columns and currency (the save sent none of them)
`POST {gcr}/api/platform/state` (gcr-api-clean, Bearer JWT) → **200**
request body:
```json
{
  "business": {
    "name": "Proof Diner"
  },
  "installed": {},
  "page_order": []
}
```
response:
```json
{
  "success": true,
  "slug": "proof-diner"
}
```
- PASS: a second save with installed {} deletes the legacy 'menu' row (its own) and still none of Paperclip's
`GET {gcr}/api/gcr/entity/proof-diner` (gcr-api-clean) → **200**
response: <17960 bytes>
GET /api/gcr/entity/:slug modules[]:
```json
[
  {
    "module_key": "core-faq",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "2580c4da-d70f-4eed-bc05-9580537fb858",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "core-gallery",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "b29e34a0-9be9-41cd-9421-c0d707cd6187",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "core-enquiry-form",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "d26a9899-226a-422d-84cb-8a21058cc3c2",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "core-social-links",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "a599e374-50af-409e-a45b-53985fc0e871",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "core-qr-menu",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "f8876bda-4fa1-4e87-bb61-b859c510a7e5",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "core-song-requests",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "f16ff26e-ddd8-4d9f-a849-aeae54c7ecfe",
    "version": "1.0.0",
    "render_mode": "inline"
  },
  {
    "module_key": "proof-agent-faq",
    "enabled": true,
    "managed_by": "paperclip",
    "install_id": "fd5eaaa5-dfcb-4979-a49c-89b7aebbc0d3",
    "version": "1.0.0",
    "render_mode": "inline"
  }
]
```
- PASS: modules[] lists the seven Paperclip rows with managed_by 'paperclip', install_id and version
- PASS: the public entity carries the three FAQ rows the apps wrote beside the seeded ones (faqs is the one FAQ table)
`GET {gcr}/api/public/business/proof-diner/apps` (gcr-api-clean) → **200**
response: <14339 bytes>
- PASS: GET /api/public/business/:slug/apps lists the seven enabled public apps with their manifests

## Step 7: Uninstall FAQ: the entity_modules row is switched off, never deleted; the faqs rows stay (DECISIONS #22, #44)

`DELETE {paperclip}/api/companies/c1bd877e-4b1a-4fff-a9de-331b714c6d80/store/63d6120a-991f-4c72-b6b6-c281ad10875b` (Paperclip as owner A) → **204**
response: <4 bytes, see assertions>
- PASS: DELETE the FAQ install → 200/204
- PASS: gcr saw the signed DELETE /api/nextgent/installs/<faq install>
gcr memdb: entity_modules (FAQ) after uninstall:
```json
{
  "id": "id-5",
  "created_at": "2026-10-05T02:22:54.269Z",
  "render_mode": "inline",
  "install_id": "2580c4da-d70f-4eed-bc05-9580537fb858",
  "enabled": false,
  "entity_slug": "proof-diner",
  "module_key": "core-faq",
  "company_id": "c1bd877e-4b1a-4fff-a9de-331b714c6d80",
  "managed_by": "paperclip",
  "settings": {
    "manifest": "<manifest core-faq>",
    "config": {},
    "showOnPublic": false
  },
  "updated_at": "2026-10-05T02:22:55.366Z",
  "version": "1.0.0"
}
```
- PASS: entity_modules row still present: enabled false, settings.showOnPublic false, manifest kept
- PASS: nextgent_installs row for FAQ is no longer active; its token row is revoked
- PASS: faqs rows untouched: same 4 rows as before
`GET {gcr}/api/business/faqs.items` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **401**
response:
```json
{
  "error": "That install has been removed."
}
```
- PASS: FAQ's install session token no longer works (401/404)
`GET {gcr}/api/public/apps/2580c4da-d70f-4eed-bc05-9580537fb858` (gcr-api-clean) → **404**
response:
```json
{
  "error": "No such app."
}
```
- PASS: the FAQ public page is gone (404)
`GET {gcr}/api/business/media.images` (gcr-api-clean, Bearer install session token (gcr_mcp_ist.…)) → **200**
response: <366 bytes>
- PASS: the other installs are unaffected (Gallery still reads media.images)
`GET {gcr}/api/public/business/proof-diner/apps` (gcr-api-clean) → **200**
response: <12743 bytes>
- PASS: the public apps list drops FAQ (six left)

## Step 8: Deferred probe: a visitor POSTing into a read-write bound source that has NO public form (FAQ entries, Gallery photos, QR Menu items)

`POST {gcr}/api/public/apps/b29e34a0-9be9-41cd-9421-c0d707cd6187/photos` (gcr-api-clean) → **201**
request body:
```json
{
  "url": "https://evil.example/x.jpg",
  "caption": "spam"
}
```
response:
```json
{
  "table": "photos",
  "row": {
    "id": "id-35",
    "created_at": "2026-10-05T02:22:55.419Z"
  }
}
```
- **FAIL**: a visitor cannot submit into Gallery's photos (bound read-write, owner collection view only, no inbox): expected 403/404
```json
{
  "table": "photos",
  "row": {
    "id": "id-35",
    "created_at": "2026-10-05T02:22:55.419Z"
  }
}
```
`POST {gcr}/api/public/apps/f8876bda-4fa1-4e87-bb61-b859c510a7e5/items` (gcr-api-clean) → **201**
request body:
```json
{
  "item_name": "Free beer",
  "price": 0
}
```
response:
```json
{
  "table": "items",
  "row": {
    "id": "id-36",
    "created_at": "2026-10-05T02:22:55.421Z"
  }
}
```
- **FAIL**: a visitor cannot submit into QR Menu's items (menu_items, bound read-write): expected 403/404
```json
{
  "table": "items",
  "row": {
    "id": "id-36",
    "created_at": "2026-10-05T02:22:55.421Z"
  }
}
```
rows after the probes: faqs 4 (was 4), entity_photos 3 (seeded 2), menu_items 4 (seeded 3)
- **FAIL**: no business rows were added by unauthenticated visitors
```json
{
  "photos": [
    "https://img.example/room.jpg",
    "https://img.example/plate.jpg",
    "https://evil.example/x.jpg"
  ],
  "menu": [
    "Gumbo",
    "Boiled Peanuts",
    "Hush Puppies",
    "Free beer"
  ]
}
```

## Summary

- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS
- Step 6: PASS
- Step 7: PASS
- Step 8: FAIL

**Stopped at step 8: a visitor cannot submit into Gallery's photos (bound read-write, owner collection view only, no inbox): expected 403/404**
