# Proof 5: Step 5, apps in the store, over real HTTP (Paperclip ⇄ gcr-api-clean)

Run at 2026-10-05T02:20:55.670Z.

Paperclip at `http://127.0.0.1:4620` (real routes/store.ts + routes/nextgent.ts on embedded Postgres with all migrations), gcr-api-clean at `http://127.0.0.1:4630` (real routes/nextgent.js, business-data.js, app-data.js, owner.js, mcp.js, platform.js, gcr.js on scripts/lib/memdb.js with a stubbed PostgREST schema document). Shared NEXTGENT_SERVICE_SECRET. Read-only on all three repos; the manifests are the shipped `App-build-/apps/*/manifest.json`, loaded with the engine's `toStorePublication`.

Repo state at run time:
```
457b66c Store: permissions name a known business resource, contacts among them (DECISIONS #59)
---
f5fec8f Menu items carry an order and an availability; menu.items reads in that order (DECISIONS #65)
---
9bff702 Engine: leads and customers are the contacts resource (DECISIONS #59)
```

Paperclip company A: `998e820c-c873-4356-b0ee-165aa89768c1` (owner `user-3ca55289-29c2-4705-b81c-08dabe9b5ffa`), created by direct insert into companies + an owner membership.

## Step 1: Link the company, seed the business, publish the six shipped apps through the gate, install them (DECISIONS #42, #44–#47, #55, #61)

`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/business-link` (Paperclip as owner A) → **201**
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
    "created_at": "2026-10-05T02:21:07.106Z",
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
  "id": "01e1b04d-fa23-4b42-9281-c0001b34104f",
  "key": "core-faq",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/01e1b04d-fa23-4b42-9281-c0001b34104f/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/01e1b04d-fa23-4b42-9281-c0001b34104f/publish` (Paperclip as admin) → **200**
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
  "id": "25067b38-9f36-490f-aafe-cc8302a362f9",
  "key": "core-gallery",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/25067b38-9f36-490f-aafe-cc8302a362f9/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/25067b38-9f36-490f-aafe-cc8302a362f9/publish` (Paperclip as admin) → **200**
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
  "id": "f5f3d284-d2e1-407c-86a3-e7ecd437e32d",
  "key": "core-enquiry-form",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/f5f3d284-d2e1-407c-86a3-e7ecd437e32d/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/f5f3d284-d2e1-407c-86a3-e7ecd437e32d/publish` (Paperclip as admin) → **200**
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
  "id": "c866458c-29d6-4cb3-b163-ddca582d5eb8",
  "key": "core-social-links",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/c866458c-29d6-4cb3-b163-ddca582d5eb8/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/c866458c-29d6-4cb3-b163-ddca582d5eb8/publish` (Paperclip as admin) → **200**
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
  "id": "aa6f6c8a-c5ea-4cfd-a91a-cf07dddc3451",
  "key": "core-qr-menu",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/aa6f6c8a-c5ea-4cfd-a91a-cf07dddc3451/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/aa6f6c8a-c5ea-4cfd-a91a-cf07dddc3451/publish` (Paperclip as admin) → **200**
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
  "id": "09584048-40b2-47de-a15f-c7273288b0b6",
  "key": "core-song-requests",
  "kind": "app",
  "status": "draft"
}
```
`POST {paperclip}/api/store/admin/items/09584048-40b2-47de-a15f-c7273288b0b6/versions` (Paperclip as admin) → **201**
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
`POST {paperclip}/api/store/admin/items/09584048-40b2-47de-a15f-c7273288b0b6/publish` (Paperclip as admin) → **200**
response (selected):
```json
{
  "status": "published"
}
```
- PASS: Song Requests: item created, release 1.0.0 passed the gate (201), published
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/01e1b04d-fa23-4b42-9281-c0001b34104f/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "3cb2f690-9918-48bb-8ac1-8e9a45d82974",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "77952434-dfcf-4b03-be63-77d641d4a987"
}
```
- PASS: core-faq: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/25067b38-9f36-490f-aafe-cc8302a362f9/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "a4eb03dd-ba5b-4a3d-985f-7d41ef46cf69",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "ba7d0446-4910-40ac-bdc5-b0f47e2e6f28"
}
```
- PASS: core-gallery: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/f5f3d284-d2e1-407c-86a3-e7ecd437e32d/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
  "enabled": true,
  "approvedPermissions": [
    "contacts:read",
    "contacts:write"
  ],
  "tokenSecretId": "1fa2615b-398b-4f2f-a6d7-aee256072fae"
}
```
- PASS: core-enquiry-form: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/c866458c-29d6-4cb3-b163-ddca582d5eb8/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "2c497e8b-dd54-401a-9454-f93de8facbb7",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "business:write"
  ],
  "tokenSecretId": "da37ac34-c3d0-4828-bcba-0fb63ecb1fa1"
}
```
- PASS: core-social-links: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/aa6f6c8a-c5ea-4cfd-a91a-cf07dddc3451/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "00f6e559-b0dc-4ee4-a137-f00fa50b1e0d",
  "enabled": true,
  "approvedPermissions": [
    "business:read",
    "menu:read",
    "menu:write"
  ],
  "tokenSecretId": "62a7e24d-07e8-44d2-ac9e-c372d3d60845"
}
```
- PASS: core-qr-menu: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store/09584048-40b2-47de-a15f-c7273288b0b6/install` (Paperclip as owner A) → **201**
request body:
```json
{}
```
response (selected):
```json
{
  "id": "efbdcd3c-99c1-4d05-9461-78c32a368ca0",
  "enabled": true,
  "approvedPermissions": [],
  "tokenSecretId": "67643ad5-d469-439e-a63f-7b1fafc934e3"
}
```
- PASS: core-song-requests: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions
gcr memdb: nextgent_installs:
```json
[
  {
    "install_id": "3cb2f690-9918-48bb-8ac1-8e9a45d82974",
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
    "install_id": "a4eb03dd-ba5b-4a3d-985f-7d41ef46cf69",
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
    "install_id": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
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
    "install_id": "2c497e8b-dd54-401a-9454-f93de8facbb7",
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
    "install_id": "00f6e559-b0dc-4ee4-a137-f00fa50b1e0d",
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
    "install_id": "efbdcd3c-99c1-4d05-9461-78c32a368ca0",
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
    "install_id": "3cb2f690-9918-48bb-8ac1-8e9a45d82974",
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
    "install_id": "a4eb03dd-ba5b-4a3d-985f-7d41ef46cf69",
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
    "install_id": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
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
    "install_id": "2c497e8b-dd54-401a-9454-f93de8facbb7",
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
    "install_id": "00f6e559-b0dc-4ee4-a137-f00fa50b1e0d",
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
    "install_id": "efbdcd3c-99c1-4d05-9461-78c32a368ca0",
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

`GET {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/store` (Paperclip as owner A) → **200**
response: <18156 bytes>
- PASS: listing 200 with the six apps installed

core-faq: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"faqs":{"access":"read-write","contract":"faqs.items"}}; installId 3cb2f690-9918-48bb-8ac1-8e9a45d82974
- PASS: core-faq: item.app is the manifest with bindings as shipped
- PASS: core-faq: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-gallery: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"media":{"access":"read-write","contract":"media.images","fieldMap":{"image_url":"url"}}}; installId a4eb03dd-ba5b-4a3d-985f-7d41ef46cf69
- PASS: core-gallery: item.app is the manifest with bindings as shipped
- PASS: core-gallery: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-enquiry-form: needsAccessTo ["contacts:read","contacts:write [changes things]"]; app.bindings {"leads":{"inbox":true,"access":"read-write","contract":"leads.items"}}; installId 38a7a498-3d09-41c4-91dc-0f7ab7979418
- PASS: core-enquiry-form: item.app is the manifest with bindings as shipped
- PASS: core-enquiry-form: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-social-links: needsAccessTo ["business:read","business:write [changes things]"]; app.bindings {"links":{"access":"read-write","contract":"business.links"}}; installId 2c497e8b-dd54-401a-9454-f93de8facbb7
- PASS: core-social-links: item.app is the manifest with bindings as shipped
- PASS: core-social-links: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-qr-menu: needsAccessTo ["menu:read","menu:write (optional) [changes things]","business:read"]; app.bindings {"currency":{"access":"read","contract":"business.currency"},"menu_items":{"access":"read-write","contract":"menu.items"},"menu_sections":{"access":"read-write","contract":"menu.sections"}}; installId 00f6e559-b0dc-4ee4-a137-f00fa50b1e0d
- PASS: core-qr-menu: item.app is the manifest with bindings as shipped
- PASS: core-qr-menu: needsAccessTo = the manifest's permissions with resource/action split and reasons

core-song-requests: needsAccessTo []; app.bindings null; installId efbdcd3c-99c1-4d05-9461-78c32a368ca0
- PASS: core-song-requests: item.app is the manifest with bindings as shipped
- PASS: core-song-requests: needsAccessTo = the manifest's permissions with resource/action split and reasons
- PASS: Enquiry Form needsAccessTo includes contacts:read and contacts:write (resource contacts), write flagged as changing things
- PASS: listing installIds match the install rows gcr holds

## Step 3: Each install's short-lived token reaches its bound business data through gcr /api/business/<contract> (DECISIONS #45, #56, #57, #59, #63, #65)

`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/3cb2f690-9918-48bb-8ac1-8e9a45d82974/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
}
```
- PASS: core-faq: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/a4eb03dd-ba5b-4a3d-985f-7d41ef46cf69/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
}
```
- PASS: core-gallery: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/38a7a498-3d09-41c4-91dc-0f7ab7979418/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
}
```
- PASS: core-enquiry-form: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/2c497e8b-dd54-401a-9454-f93de8facbb7/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
}
```
- PASS: core-social-links: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/00f6e559-b0dc-4ee4-a137-f00fa50b1e0d/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
}
```
- PASS: core-qr-menu: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/installs/efbdcd3c-99c1-4d05-9461-78c32a368ca0/token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
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
    "created_at": "2026-10-05T02:21:08.131Z",
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
    "created_at": "2026-10-05T02:21:08.165Z",
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
      "created_at": "2026-10-05T02:21:08.165Z",
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

`GET {gcr}/api/public/apps/38a7a498-3d09-41c4-91dc-0f7ab7979418` (gcr-api-clean) → **200**
response: <2080 bytes>
- PASS: GET /api/public/apps/<enquiry install> → 200 with the manifest and public settings; no lead data on the public page (leads.items is a table of people)
`POST {gcr}/api/public/apps/38a7a498-3d09-41c4-91dc-0f7ab7979418/enquiries` (gcr-api-clean) → **201**
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
    "created_at": "2026-10-05T02:21:08.190Z"
  }
}
```
- PASS: POST /api/public/apps/<enquiry install>/enquiries (the source key, resolved through the manifest's binding) → 201 with a receipt { id, created_at } only
gcr memdb: entity_leads:
```json
[
  {
    "id": "id-23",
    "created_at": "2026-10-05T02:21:08.165Z",
    "name": "Pat Lee",
    "email": "pat@example.com",
    "phone": "+15550100200",
    "message": "Private room for 12?",
    "entity_slug": "proof-diner"
  },
  {
    "id": "id-24",
    "created_at": "2026-10-05T02:21:08.190Z",
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
    "created_at": "2026-10-05T02:21:08.192Z",
    "entity_slug": "proof-diner",
    "channel": "app",
    "customer_address": "vee@example.com",
    "mode": "agent",
    "last_message_at": "2026-10-05T02:21:08.192Z"
  }
]
```
gcr memdb: business_messages:
```json
[
  {
    "id": "id-26",
    "created_at": "2026-10-05T02:21:08.192Z",
    "entity_slug": "proof-diner",
    "thread_id": "id-25",
    "channel": "app",
    "direction": "in",
    "customer_address": "vee@example.com",
    "body": "Visitor Vee\nemail: vee@example.com\nmessage: Do you cater weddings?\nentity_slug: proof-diner",
    "status": "received",
    "author": "customer",
    "install_id": "38a7a498-3d09-41c4-91dc-0f7ab7979418"
  }
]
```
- PASS: one business_messages row: channel app, direction in, install_id = the enquiry install, customer_address = the visitor's email, body carries the message
- PASS: its message_threads row: channel app, the slug, customer_address = the visitor's email
`POST {paperclip}/api/companies/998e820c-c873-4356-b0ee-165aa89768c1/business-token` (Paperclip as owner A) → **200**
response (selected):
```json
{
  "expiresAt": "2026-10-05T02:26:08.000Z"
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
      "last_at": "2026-10-05T02:21:08.192Z",
      "unread": 1,
      "handled_by": "agent",
      "source": {
        "installId": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
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
      "installId": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
      "appKey": "core-enquiry-form"
    }
  },
  "messages": [
    {
      "id": "id-26",
      "direction": "in",
      "text": "Visitor Vee\nemail: vee@example.com\nmessage: Do you cater weddings?\nentity_slug: proof-diner",
      "at": "2026-10-05T02:21:08.192Z",
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
    "at": "2026-10-05T02:21:08.191Z",
    "event": "core-enquiry-form.submitted",
    "slug": "proof-diner",
    "payload": {
      "app": "core-enquiry-form",
      "installId": "38a7a498-3d09-41c4-91dc-0f7ab7979418",
      "table": "enquiries",
      "record": {
        "id": "id-24",
        "created_at": "2026-10-05T02:21:08.190Z",
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
`POST {gcr}/api/public/apps/efbdcd3c-99c1-4d05-9461-78c32a368ca0/requests` (gcr-api-clean) → **201**
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
    "created_at": "2026-10-05T02:21:08.290Z"
  }
}
```
- PASS: POST /api/public/apps/<song install>/requests → 201 receipt
gcr memdb: app_records:
```json
[
  {
    "id": "id-27",
    "created_at": "2026-10-05T02:21:08.290Z",
    "install_id": "efbdcd3c-99c1-4d05-9461-78c32a368ca0",
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
    "at": "2026-10-05T02:21:08.290Z",
    "event": "core-song-requests.submitted",
    "slug": "proof-diner",
    "payload": {
      "app": "core-song-requests",
      "installId": "efbdcd3c-99c1-4d05-9461-78c32a368ca0",
      "table": "requests",
      "record": {
        "note": null,
        "song": "Blue Monday",
        "artist": "New Order",
        "from_name": "Sam",
        "id": "id-27",
        "created_at": "2026-10-05T02:21:08.290Z",
        "updated_at": "2026-10-05T02:21:08.290Z"
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
`POST {gcr}/api/public/apps/efbdcd3c-99c1-4d05-9461-78c32a368ca0/nothing` (gcr-api-clean) → **404**
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
`POST {gcr}/api/public/apps/3cb2f690-9918-48bb-8ac1-8e9a45d82974/entries` (gcr-api-clean) → **201**
request body:
```json
{
  "question": "spam?",
  "answer": "spam"
}
```
response:
```json
{
  "table": "entries",
  "row": {
    "id": "id-30",
    "created_at": "2026-10-05T02:21:08.314Z"
  }
}
```
- **FAIL**: a visitor cannot submit into FAQ's entries (bound read-write but the binding is not a public form and inbox is not set): 404 — not a public submission
```json
{
  "table": "entries",
  "row": {
    "id": "id-30",
    "created_at": "2026-10-05T02:21:08.314Z"
  }
}
```

## Summary

- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: FAIL

**Stopped at step 4: a visitor cannot submit into FAQ's entries (bound read-write but the binding is not a public form and inbox is not set): 404 — not a public submission**

## Defect (stopped here, repos not patched)

**Unauthenticated public write through any read-write binding.** `POST /api/public/apps/<install>/<sourceKey>` accepts a visitor's body for every `ui.sources[key]` with `from: business` whose binding is `access: read-write`, whether or not the manifest exposes a public form over it or marks the binding `inbox: true`. With the shipped manifests a visitor (no token) added a `faqs` row through FAQ (`entries`, 201 above); the continuation run (`transcript-continued.md`, step 8) also added an `entity_photos` row through Gallery (`photos`) and a `menu_items` row through QR Menu (`items`).

- `/home/user/gcr-api-clean/lib/appInstances.js:392-399` `boundSubmission` — the only tests are `source.from === 'business'`, a `binding` and `access === 'read-write'`.
- `/home/user/gcr-api-clean/routes/app-data.js:355-356` — `bound` from that function is enough to reach `insertBound` (line 366); `publicFormsFor` (line 360) is consulted only for `openWhen`, never as a precondition.
- Intended rule: DECISIONS #57 (a visitor may submit into a read-write bound source *that is a public form*, enquiry → leads.items) and the engine's `inboxBindings` (`/home/user/App-build-/packages/engine/src/manifest.js:859-862`, `inbox: true` on a read-write binding). A fix would require a public `form` view over the source (`appInstances.publicFormsFor(manifest, key).length > 0`), or `binding.inbox === true`, before `boundSubmission` returns.

Steps 5–7 (agent face, legacy safety, uninstall) were exercised in `transcript-continued.md` with the probe moved to the end; all passed.
