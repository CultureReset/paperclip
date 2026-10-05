# NEXT GENT build spec

Taken from ChatGPT's documents, in its own words. Nothing here is Claude's interpretation; each line cites its source. Where a source says one thing and the owner says another, the owner wins and it is listed in section 9 as a question.

Sources (saved word for word in `chatgpt-originals/`):

| Ref | File | What it is |
|---|---|---|
| ARCH | `chatgpt-original-15.md` | the reconciled architecture |
| FLOW | `chatgpt-original-16.md` | the Sandbar Grill walkthrough, steps 1–30 |
| CORR | `chatgpt-original-12.md` | corrections: devices, executor, simplicity, ten screens |
| REPOS | `chatgpt-original-10.md` | keep/merge decisions per repo |
| LEGO | `chatgpt-original-5.md` | repos as Lego blocks, and the build order |
| APPS | `chatgpt-original-32.md` | apps as capabilities, connectors, canonical data, page shell |

This replaces `SPEC-CHATGPT.md`, `CONTRACT.md` §14 and Claude's plans as the thing code is judged against. Those files stay as history.

---

## 1. Three sources of truth

> "Paperclip knows: 'What does this company's NEXT GENT account have and what can it do?' gcr-api-clean knows: 'What is The Sandbar Grill and what is true about the business?' nextgent-platform knows: 'How do I actually perform this action on the owner's real devices?' Boxes / Play-user / GCR / Plat-admin know: 'How should this information be presented to this particular person?'" (FLOW)

**1.1 Paperclip owns platform state** (ARCH): account, user, company/workspace, agents, workers, tasks, routines/automations, approvals, activity, costs, store catalog, store versions, company installations, update channel, update policy, permissions, "eventually: logical device association". **"Do not build another control plane."**

LEGO adds to Paperclip's list: Device, Computer, Android, Release, Execution, Receipt, Capabilities. And: **"Don't put restaurant menus, fishing species, happy-hour drinks and hundreds of GCR fields directly into Paperclip."**

**1.2 gcr-api-clean + the cyber check Supabase owns business state** (ARCH): business, parent business, child business, identity, hours, locations, contacts, services, menus, prices, availability, bookings, events, photos, reviews, staff, policies, FAQs, payments detected, integrations; plus the public MCP, the private/business MCP, GCR directory data, concierge data. **"This should not be recreated inside Paperclip."** LEGO: **"Make this the only server-side gateway to the Business Supabase."**

**1.3 The local runtime owns machine state** (ARCH): Android state, browser sessions, local files, local calendar cache, App Maps, local configuration, device state, execution journal, verification evidence. "That is not another cloud source of business truth."

APPS adds the fourth kind: **app-specific business data** (song_requests, crowdsource_sessions, merch products, gallery_items…) "still belongs to the business-data side rather than creating another platform… Otherwise you create two competing databases."

**Owner's rule, on top of this:** the two databases (Paperclip/Saas, cyber check) are separated on purpose. Platform things never go in the business database.

## 2. Eight areas, four surfaces

(ARCH)

| # | Area | Repo | Owns |
|---|---|---|---|
| 1 | Control plane | paperclip | companies, users, agents, tasks, routines, approvals, activity, skills, secrets, plugins, tool gateway, adapters |
| 2 | Store + release lifecycle | paperclip `nextgent/foundation` | store_items, store_item_versions, store_installs, store_install_resources, store_settings; stable/fast channels; automatic/manual updates; security/bugfix/enhancement advisories; required security updates |
| 3 | Business data | gcr-api-clean + cyber check | directory, profiles, availability, bookings, reviews, menus, imports, email parsing, FareHarbor, iCal, Google Business, public/private MCP, owner tools, public APIs, concierge data, parent/child |
| 4 | Declarative app engine | App-build- | "a declaration — a manifest — and one shared runtime renders every manifest." Keep: manifest spec, builder, validation, shared runtime, admin renderer, public renderer, layouts, templates. **Do not keep:** App-build login, account system, standalone store database. |
| 5 | Agents/workers | paperclip + adapters | "Paperclip owns the agent record and work." Worker = Hermes / OpenClaw / Codex / Claude / other adapter. "Jarvis remains the human-facing conversational identity/front door… Jarvis does not become the policy engine." One boss: Paperclip, not Hermes Kanban too. |
| 6 | Local execution | nextgent-platform | ALLOW/ASK/DENY, approvals, dispatch, Android control, SIM messaging, browser, Linux, fresh verification, execution journal, receipts, relay client, MCP capability tools. "Boxes does not own it. Jarvis does not own it. Paperclip does not tap the phone itself." |
| 7 | App Maps | nextgent-maps | data: `maps/environment/application/capability/version/map.yaml`. "Facebook changes its UI? Push: Map 1.2 → 1.3. You do not rebuild the executor." |
| 8 | Appliance distribution | nextgent-ghost-image | pinned repos/commits, install, health check, atomic switch, rollback, signed releases, trusted public keys, individual block updates |

**Two update systems, never combined** (ARCH): cloud/product updates through the Paperclip Store (apps, agents, automations, skills, connectors); local machine updates through nextgent-ghost-image (Boxes, nextgent-platform, Jarvis, App Maps, parsers, local services). **"Don't combine these into one giant updater."**

CORR adds the second axis: **customer-installable** things appear in the Store (apps, agents, automations); **platform-maintained** things (App Maps, parsers, schema improvements, executor fixes, platform/security/UI fixes) are pushed by the operator. "Customers shouldn't have to shop for these."

**Surfaces** are "presentations, not separate architectures" (ARCH):
- **Play-user:** customer web/mobile. Mobile = same account and state, optimized UI (CORR).
- **Boxes:** TV/computer. "It explicitly treats itself as the screen rather than another execution brain." "Boxes should never need a Supabase service key" (LEGO).
- **Plat-admin:** operator. "It aggregates the appropriate systems" and "doesn't mean Plat-admin stores everything" (FLOW 25).
- **GCR / gcr-unified:** public. "GCR does not need to go through Paperclip to retrieve public restaurant/charter/menu/etc. information."

## 3. The three duplicates ChatGPT found, and the ruling

(ARCH)

1. **Three app stores** (gcr-api-clean store, App-build module store, Paperclip store). Ruling: **Paperclip Store is the install/version/release authority.** gcr-api-clean store = "donor/migration source until feature parity and existing data are reconciled. Do not immediately delete it." App-build store: "remove the separate store/auth/database authority but keep its app-manifest/runtime/builder technology."
2. **Hermes Harness orchestration vs Paperclip.** Ruling: "Paperclip owns the work." Keep Hermes profiles, skills, tools and worker configurations only.
3. **The removed CyberCheck Business plugin** (commit 4e86d196, removed in 2432a487). Ruling: restore the idea — "company-specific business token, server-side secret, no business slug supplied by an agent" — as **internal platform infrastructure, not a customer Store item.** "Not another database. Not another business platform. A bridge."

## 4. The four integration jobs (then "everything after those four is feature work")

(ARCH, quoted)

1. "Merge/rebase the Paperclip nextgent/foundation Store work into the current Paperclip line. Play-user and Plat-admin already call those endpoints."
2. "Restore a secure Paperclip ↔ gcr-api-clean business bridge. The removed CyberCheck plugin already demonstrated almost exactly how to do it: company-specific business token, server-side secret, no business slug supplied by an agent. Make it internal infrastructure, not a customer Store item."
3. "Fold App-build's manifest/builder/renderers into the Paperclip Store model instead of operating its separate login/database/store. An installed App is a versioned declarative manifest plus business data—not another hosted codebase."
4. "Resolve device ownership without rewriting the working relay. Today gcr-api-clean/routes/nodes.js + ghost_nodes is the actual device relay/registry. Keep it working. If Paperclip is to own the logical Computers/Androids list, add that association at the control-plane level and reference the existing relay node; don't create another transport."

## 5. Devices and the executor (CORR, in detail)

**Paperclip device registry** = control-plane state, "rather than Paperclip actually controlling the hardware itself":

```
Company
 ├── Computer: device_id, version, capabilities, online/offline, last_seen
 └── Android:  device_id, paired computer, SIM status, capabilities, last_seen
```

Execution path: `Paperclip → task/command → relay → nextgent-platform → Android / Browser / Linux`.

> "Paperclip knows the devices. Relay reaches the devices. nextgent-platform operates the devices. Boxes displays the devices."

> "If the existing relay is currently in gcr-api-clean, you don't need to rewrite it just to satisfy architectural purity. Get the system working, then decide whether that relay eventually deserves to move out."

**Computer runtime can be physical or cloud. SIM identity remains physical Android.** The Android does not have to be attached to the same Linux box; a cloud VM can reach a physical Android through the secure relay.

**The executor is not coupled to gcr-api-clean.** "nextgent-platform is an executor. Ideally the instruction arrives with the information/capability needed to execute it." The intelligence side (Jarvis/agent + business MCP) works out what "Saturday availability = 3" means; the executor receives `ACTION update_google_business_attribute, business_id, target, value, capability, verification: read_back` and performs it. "There can absolutely be tools that allow an executor/agent to retrieve business data when necessary, but I wouldn't make the executor itself dependent upon the GCR database architecture."

## 6. Apps, connectors, data (APPS)

**6.1 Apps are capabilities, not industries or vendors.** One Availability app, one Menu app, one Listings app. "The app says: I need availability. The connector says: here is how to get availability from FareHarbor / Square / iCal / a spreadsheet / manual entry / device observation." "The app never needs to be rewritten." Separation: APP ↔ CAPABILITY ↔ DATA SOURCE / CONNECTOR.

**6.2 An installed app contributes two surfaces over one data binding:**

```
APP
├── Public experience
├── Owner/admin experience
├── Data it uses
├── Data it creates
├── Settings
└── Actions
```

"Not every app needs every piece. But that's the model." Same in ARCH ("Owner face, Public face, Agent face… All three are the same underlying capability. Not three apps.")

**6.3 Owner dashboard's app area builds itself from installed apps.** "The dashboard builds itself from the apps installed for that business." Sandbar installs Availability, Gallery, Reviews, Merch Store, Events → those appear in its back end; a musician installs Song Request, Crowdsource a Song, Shoutout Request → those appear instead.

Reconciled with CORR §8: the **ten core screens are fixed** (Home, Business, Apps, Agents, Automations, Calendar, Messages, Computer, Activity, Settings). "Play-user can absolutely hard-code that its primary navigation contains…" What is dynamic **inside** them: "installed apps, business sections, industry data, agent definitions, automation definitions, public app blocks."

**6.4 One canonical business-data system.** "Apps do not each invent their own copy of the business. They install onto a business, read the business data they need, and create only the app-specific data that belongs to that app." App-specific records (song_requests, crowdsource_*, shoutout_requests, merch products/orders/inventory, gallery_items…) live on the business-data side, scoped to the business/install. No database per app.

**6.5 Canonical identity + source identity for every record.** Internal id is the stable identity (menu_item_id, product_id, listing_id, event_id, booking_id, customer_id); SKUs, POS ids, Toast/Square ids, CSV row ids are external references mapped onto it. "You don't want your entire system depending on a vendor SKU."

**6.6 Provenance on imported/synced records:** source_type, source_id, external_record_id, source_updated_at, last_synced_at, created_by, updated_by, owner_override. "Then an old Google import doesn't suddenly overwrite the owner's correction." Re-sync updates instead of duplicating.

**6.7 The Store does not own app business data.** Paperclip is authoritative for installed, version, enabled, entitled. It publishes a lightweight runtime record to the business layer:

```
business_app_instances: business_id, installation_id, app_key, enabled,
                        public_enabled, render_mode, public_label, config
```

so the public page renders "without calling Paperclip every time a customer opens the page." **"That does not make CyberCheck a second Store."**

**6.8 Public page = assembly of installed modules.** Each line is an installed module; the owner reorders, hides, shows, renders as button / inline / own page. "The page builder does not copy those apps. It merely says: Render this installed application here." **The page shell owns:** branding, background, profile/header placement, section order, theme, spacing, navigation. **The Store owns:** Profile, Call, Book, Schedule, Social Links, Save Contact, Listings, Gallery, Reviews, Merch Store, Availability, Menu, Song Request, Crowdsource a Song, Shoutout Request, etc. "Move things up/down, turn things off, add another app."

**6.9 Agents don't get their own copy.** They read through the business MCP/API.

**6.10 A9ENT / MySet / prototypes:** "Use their page composition and conversion UX as a reference, strip out the real-estate lock-in, and make each page section/action independently installable." Owner's rule: reference only; never copy UI, wording or sample data; the real UI must be better.

## 7. Keep it simple (CORR, "Where I went too far")

- **No schema/definition registry service.** The business-data system holds dynamic schemas; an app package carries its own manifest. "Don't go build nextgent-schema-registry."
- **No package manager.** Initial distribution model: `item, type, version, requirements, permissions, enabled, installed_for, release`. Add rollback/compat/signatures/staged rollout "only when they become necessary".
- **Apps are not executable packages.** "QR Menu doesn't need its own independent backend service." A versioned definition interpreted by the platform. Not "Docker container / separate process / separate repo".
- **Agents are definitions:** Name, Worker, Instructions, Tools, Permissions, Model. "Paperclip/Hermes provides the actual runtime."
- **Automations are data:** `WHEN booking completed / WAIT 24 hours / DO send review request / USING Review Agent`. "A stored definition interpreted by the automation/orchestration system. It doesn't need its own codebase." FLOW 12: **"Paperclip stores/runs the routine. The Review Agent handles the task."**
- **No Kafka-style event system.** "Modules need a standardized way to react when something happens. Implementation can stay simple." Events like booking.created, payment.received, device.offline, execution.completed.
- **Business-within-business:** `business_id, parent_business_id, business_type` plus existing tables. "Don't build another ontology engine."
- **Store UX shows Apps / Agents / Automations together; internally they keep different lifecycle semantics** (REPOS). "The user doesn't need to care about the technical difference. The platform absolutely does."
- **Permission screen in plain words** (CORR): "This app needs Availability + Bookings" rather than `availability.read, booking.read…`. Detailed capabilities stay underneath.

## 8. Repos: what happens to each (LEGO, REPOS)

| Repo | Ruling |
|---|---|
| Boxes | Keep. Main local screen. Never holds a Supabase key. Asks the platform: who is logged in, what company, what apps/agents/automations, calendar, tasks, approvals, recent activity. |
| Linux- | Don't run. Feature-diff against Boxes; port what Boxes lacks; then archive. |
| nextgent-platform | Keep, separate from Boxes, on the same machine. "Boxes becomes the face. nextgent-platform becomes the hands." |
| paperclip | Keep. The control plane. Backend for Play-user, Plat-admin, Boxes, Jarvis, Hermes, workers, store/installations, automations. |
| Play-user | Keep. "NEXT GENT on the web." Platform calls → Paperclip; Business → gcr-api-clean. "One frontend can consume two internal services." |
| Plat-admin | Keep. Operator console: Customers, Companies, Users, Devices, Computers, Androids, Agents, Workers, Automations, Apps, Store, Releases, Tasks, Executions, Approvals, Receipts, Subscriptions, System; plus a Business Data area backed by gcr-api-clean. |
| Dashboards-users- | Keep its functionality under **Business** in Play-user. "Integrate its UX into Play-user; retire the standalone deployment only after feature parity is proven." Browser access goes through gcr-api-clean, never direct DB credentials. |
| Admin-dashboard-main | Keep its functionality under **Business Data** in Plat-admin (Directory, Menus, Events, Reviews, Content, Bookings, GCR, Concierge). Same retire-after-parity rule. |
| gcr-api-clean | Keep. "The authoritative service boundary for business information." |
| Just-do-it | "Treat Just-do-it as a newer data-model/reference implementation and compare it against the existing GCR data model. Then migrate the better pieces into the business-data system." Not just the email parser; not another production service. |
| gcr-unified | Keep. Public layer; reads gcr-api-clean. |
| App-build- | Keep the engine (manifest spec, builder, runtime, owner renderer, public renderer, layouts). Drop its login, Supabase, profiles, installs, store as authorities. |
| ang-cloud- | Harvest components into Boxes/Play-user; don't operate a third dashboard. |
| cybercheck-node | Feature-compare with Boxes + nextgent-platform; port unique pieces; archive. |
| cybercheck-cloud, ghost-os-platform | Reference/archive. |
| appstore, marketplace | Not part of this product. |

**ChatGPT's build order** (LEGO): first Paperclip + Play-user + Plat-admin with one account/company; second Boxes on the same company; third nextgent-platform beside Boxes, one action end to end (UI → Paperclip/Jarvis → executor → Android → verification → receipt → UI); fourth gcr-api-clean linked by a permanent company_id ↔ business_id association; fifth Dashboards-users- as Business in Play-user and Admin-dashboard-main as Business Data in Plat-admin; sixth App-build's engine so a store install appears in Play-user and Boxes; seventh feature-diff Linux-, ang-cloud-, cybercheck-node. "The biggest thing I would not do is start copying folders between all these repos."

**The horizontal key** (CORR): `company_id → business_id, computer_id, android_id, installed_app_ids, agent_ids, automation_ids`. "That's what makes the ten different-looking screens actually represent one account."

## 9. Flows the code must support (FLOW, numbered as ChatGPT did)

1 sign up → Paperclip user/company/membership. 2 find/claim/create business via gcr-api-clean search → `company_id ↔ business_id/slug` mapping. 3 business sections are discovered, not a hard-coded industry form ("Same engine. Different data."). 4 connect sources (Google Business, Yelp, FareHarbor, calendars, forwarded email, Venmo, Cash App) → parser/import → gcr-api-clean. 5 Business page displays business data; edits go Play-user → bridge/API → gcr-api-clean. 6 Store shows Apps/Agents/Automations. 7 install records company, item, version, update channel, automatic/manual; store detail says what it Needs / Does not need / Public surface optional. 8 an app is a manifest with owner face, public face, agent face. 9 installing an agent: Paperclip creates/manages it; Hermes is the worker. 10 Jarvis reads facts through business-data tools. 11 Jarvis delegates via a Paperclip task; "Paperclip retains the work record." 12 automations: Paperclip stores/runs the routine; device path via nextgent-platform when needed. 13 the local computer; "Paperclip knows: This device belongs to this company. The existing relay provides remote communication." 14 Boxes is a surface; actions go `Boxes → core / nextgent-platform → policy → ALLOW / ASK / DENY`. 15 Android action: capability → nextgent-platform → policy → App Map → androidd → phone. 16 ASK: owner's physical number gets "Reply YES 4821"; releases exactly that action. 17 fresh verification; "It shouldn't pretend success." 18 receipt (requested by, action, business, old, new, executor, verified, time) into Activity; visible in Play-user, Boxes, Plat-admin; attached to Paperclip work. 19 App Map update without rebuilding the executor. 20 system update: signed release → download changed block → install → health check → promote or rollback. 21 public page = business identity + installed app blocks; "The owner chooses what is public." 22 GCR directory on structured facts. 23 concierge searches business data directly; "does not need to ask each restaurant's agent every time." 24 parent/child businesses; query children. 25 Plat-admin aggregates. 26 one edit updates everywhere. 27 external-platform action through App Map → receipt → Paperclip Activity. 28 agent work with draft → approval → publish → verify → receipt. 29 automation flow: booking complete → Paperclip routine → WAIT → Review Agent → message capability → receipt. 30 role summary.

## 10. Owner's rules (binding, on top of everything above)

- Don't stack or duplicate pieces. Where code sits today doesn't mean it belongs there.
- Nothing hard-coded: industries, business names, categories, URLs, prices, plans, models, phone numbers, emails, providers, limits.
- Bookings, QR menus, song requests and link pages are apps, not built in.
- Emails are forwarded by the business, never caught or pulled.
- Agents run in the cloud.
- Businesses choose their agents and apps.
- Directory, concierge and phone assistant are separate interfaces over one business data/MCP.
- Reuse existing code; never drop a feature without a full replacement.
- Examples, prototypes, images and reference sites are for understanding only.
- Design decisions are the owner's. Builders stop and report "decision needed".
- Never delete anything; never lose work. No live DB changes, deploys or real secrets without the owner's OK. No PRs unless asked.
- Telephony: not Twilio.
- Apps vs modules naming: leave it.

## 11. Where ChatGPT and the owner differ, or ChatGPT left it open: OWNER DECIDES

| # | Question | What ChatGPT says | What the owner has said |
|---|---|---|---|
| 1 | **Jarvis: local computer or cloud?** | FLOW 13 and LEGO install Jarvis on the Sandbar computer; REPOS puts Jarvis under Paperclip in the cloud ("The box doesn't need to be where every agent lives"). | "Agents run in the cloud." |
| 2 | **Facebook / Google Business updates** | FLOW 15, 27: through App Maps on the physical Android ("There might not be an API you want to use"). | Not stated. |
| 3 | **Billing / subscriptions** | ARCH: Paperclip owns "costs"; Plat-admin lists "Subscriptions". Nothing more. | Not stated. |
| 4 | **Phone/text provider** | Not stated. | Not Twilio. |
| 5 | **Computer runtime: physical, cloud, or both offered** | CORR: "Computer runtime can be physical or cloud." | Not stated. |
| 6 | **Relay location long-term** | CORR: keep in gcr-api-clean for now; "decide whether that relay eventually deserves to move out." | Not stated. |
| 7 | **Dashboards-users- / Admin-dashboard-main**: embed as separate builds behind unified routing first, or move the React modules in now | LEGO: "Initially they can remain separate builds behind unified routing." | Not stated. |

Nothing in this table is built until the owner answers.

---

## 12. Addendum from ChatGPT's consolidation document (CONS = `chatgpt-originals/chatgpt-original-40-consolidate.md`)

Owner supplied this after the above. It corrects and sharpens, it does not contradict. Checked against the code on 2026-10-04:

1. **Installed-app runtime = `entity_modules`, which already exists** in gcr-api-clean `routes/platform.js` (entity_slug, module_key, enabled, settings{manifest, config, showOnPublic}, sort_order). CONS: "I do not need to invent another runtime-install table." → The branch's `business_app_instances` (added by Claude) is a duplicate of it and is consolidated INTO `entity_modules`. Verified: `routes/platform.js:10,109-113,605` use entity_modules today.
2. **Paperclip Store kinds.** CONS: final Store understands `app, agent, automation, connector, skill, layout, pack` (+ `plugin` for internal). Verified on branch: `STORE_ITEM_KINDS = plugin, pack, skill, automation, connector, agent, app, box-release`. → add `layout`; remove `box-release` (two update systems). A `pack` = "install these independent Store items together"; its contents stay separate apps.
3. **App-build- is the engine**, not a prototype: manifest contract, builder, shared admin + public renderers, page studio, layouts. Keep all of it; drop its login/account/store/Supabase as authorities.
4. **Manifest must distinguish data an app USES (bindings to shared business data, e.g. `menu.items`, `media.images`, `availability.read`) from data it OWNS (its own records, e.g. song `requests`).** Verified on branch: the engine manifest already has `ui.sources.<key>` with `from: "business"` (section + resource) vs `from: "app"` (own table). Same idea, different names; the contract names (`menu.items`…) are formalised in Phase 13.
5. **Connectors satisfy contracts.** App ≠ connector. Three modes: native (NEXT GENT owns the record), synced (external authoritative, normalised copy kept), live (query the connector when needed).
6. **Data contracts map onto existing gcr tables**, not a new canonical DB: `menu.items→menu_items`, `media.images→entity_photos`, `reviews.items→entity_reviews`, `events.items→entity_events`, `booking.records→bookings`, `availability.claims→booking_calendar`, `products.items→offerings kind=product`; anything else → `entity_sections`/`entity_section_items`. "Clean up and formalize the existing data contracts in routes/platform.js."
7. **External identity:** audit `platform_connections` and provider tables first; if nothing fits, one `entity_external_refs` (entity_type, entity_id, provider, connection_id, external_id, external_sku, last_synced_at). Never provider ids in app code.
8. **Renderer templates must be production quality**, public (profile, menu, storefront, gallery, availability, booking, listings, events, reviews, form, voting, links…) and admin (menu-editor, media-manager, product-manager, availability-calendar, booking-manager, requests-inbox, review-manager…). "So QR Menu does not look like a generic database list."
9. **Layout is a Store kind separate from apps**: theme, header shape, block styles, default order, spacing, button shape. It never owns data.
10. **Uninstall never deletes business data** by default; it disables surfaces. Reinstall brings the capability back. **Update** changes the pinned manifest, not the data.
11. **gcr-api-clean `routes/mcp.js` is the AI-facing business door** (credential decides the business). "Do not create a second database MCP."
12. **Install flow (Store → business → where is your data? (reuse compatible data if present; else connect/import/manual) → design → preview → publish)** = Paperclip store_install → bridge → entity_modules → data binding → public + admin surfaces.
13. **Agent / automation / app are three Store artifacts** that talk through events (booking.completed → Review After Visit → Review Agent → Verified Reviews app).
14. **Jarvis has three doors:** Paperclip work tools, business MCP, nextgent-platform capability tools.
15. **Scout** = data acquisition connector/worker; **Match** = engine behind Verified Reviews; **Trailblaze** = Map authoring/testing tool, not production executor; **ang-contract/ang-core/ang-cloud** stay local; **ghost-image** stays the appliance installer. Android reality: `android.settings.open_display` is the first acceptance capability; `android.sms.send` is still draft.
16. **Paperclip NEXT GENT README is wrong** ("Paperclip is the product… does not use gcr-api-clean") and is rewritten when the bridge lands.

**One difference to note (owner decides, see DECISIONS #20):** CONS §7 says Play-user talks only to Paperclip and business data is "exposed through Paperclip"; LEGO §5 says Play-user talks platform→Paperclip and business→gcr-api-clean directly. The branch does the latter with a Paperclip-issued short-lived business token (no CyberCheck credential in the browser), which satisfies CONS's security goal.

**CONS build order (20 phases)** — adopted as the detailed sequence inside PLAN-EXACT steps 3–8: 1 lock authorities + fix READMEs · 2 merge Paperclip Store · 3 Store kinds app/agent/layout · 4 Paperclip↔CyberCheck bridge · 5 freeze duplicate stores (don't delete) · 6 extract App-build runtime · 7 manifest bindings vs owns + surface templates · 8 store_install → entity_modules · 9 public templates (Profile, Actions, Social Links, Gallery, QR Menu, Listings, Availability) · 10 admin templates (profile-editor, media-manager, menu-editor, listing-manager, availability-calendar) · 11 Play-user: installed apps supply admin screens · 12 gcr-unified: public page stacks installed surfaces · 13 data contracts · 14 reuse ingestion (Scout, email, iCal, POS, CRM, CSV) · 15 interactive apps · 16 agents/automations in Store · 17 Jarvis tools · 18 Android acceptance · 19 keep nodes.js relay · 20 appliance, then pilot.
