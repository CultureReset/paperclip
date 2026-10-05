# Scoping report: install, projection and render path (read-only)

I only read files and changed nothing. Citations are file:line.

---

## 1. Paperclip store

**Kinds**
- The canonical list is `plugin, pack, skill, automation, connector, agent, app, box-release`:
  - DB check constraint: `/home/user/paperclip/packages/db/src/schema/store.ts:40-43`
  - service constant `STORE_ITEM_KINDS`: `/home/user/paperclip/server/src/services/store.ts:24`
  - route zod check: `/home/user/paperclip/server/src/routes/store.ts:45`
- Other enums:
  - channels `stable|fast` (store.ts:26)
  - advisory types `security|bugfix|enhancement` (store.ts:28)
  - approval modes `automatic|manual` (store.ts:30)
  - deploy actions `apply|force` (store.ts:99)
  - audiences `all|companies|channel|kind` (store.ts:106)
- The NEXT GENT section kind is only `agent|app|automation` (`/home/user/paperclip/server/src/services/store-content.ts:31`).
- **The UI is out of date.** `/home/user/paperclip/ui/src/api/store.ts:3` has `StoreItemKind = "plugin"|"pack"|"skill"|"automation"|"connector"` (no `agent`, `app` or `box-release`). StoreAdmin builds its kind dropdown from `STORE_KIND_LABELS` (`ui/src/pages/Store.tsx:14`, `ui/src/pages/StoreAdmin.tsx:27`).

**Tables** (`packages/db/src/schema/store.ts`)
- `store_items` (10-50): id, key, kind, name, summary, description, iconUrl, pluginKey, priceAmountCents, priceCurrency, priceInterval, priceModel, status (`draft|published|retired`), latestVersionId.
- `store_item_versions` (52-82): itemId, version (free text, unique per item; no semver check), channel, advisoryType, required, changelog, `payload` jsonb.
- `store_installs` (84-119): id, companyId, itemId, versionId, channel, approvalMode, installedByUserId, approvedPermissions jsonb, tokenSecretId, enabled. Unique on (companyId, itemId).
- `store_install_resources` (126-151).
- `store_deployments` (169-193).

**What `listForCompany` returns per item** (`services/store.ts:510-563`)
- Fields: `id` (this is the **item** id), key, kind, name, summary, description, iconUrl, status, latestVersion, installed (bool), enabled, installedVersion, channel, approvalMode, updateAvailable, updateAdvisory, updateChangelog, needsApproval, updateNewPermissions, needsAccessTo, `contents{skills,agents,routines,menu}`.
- It does **not** return: the install id, `payload.app` / any manifest, price, publisher, versionId, approvedPermissions.

**What install, update and remove record**
- **Install** (`store.ts:565-598`):
  - Inserts a `store_installs` row with: id (randomUUID), companyId, itemId, versionId = newest version on the channel, channel (default `stable`), approvalMode (default `automatic`), installedByUserId.
  - `bringUp` (161-180), then `bridge.activate`, sets `approvedPermissions` (`nextgent-store.ts:276-279`).
  - Returns the install row plus `charge` and `charged`.
  - The route body accepts `{channel?, approvalMode?, declinedPermissions?}` (`routes/store.ts:106-113`).
- **Changing subscription**: `PATCH /companies/:id/store/:itemId` takes `{channel?, approvalMode?}` (`routes/store.ts:272-276`, `store.ts:614-624`).
- **Update**: `POST …/update` with `{approvePermissions?}`. It runs `moveInstall` (213-236), which only sets `versionId`. It calls gcr **only when the permission set changes** (224-226).
- **Enable**: `enable` (787-804).
- **Remove**: `uninstall` (806-816) runs `bridge.deactivate`, then `DELETE /api/nextgent/installs/:id`, then deletes the row.

**How the `app` kind's payload is stored and validated**
- For any kind other than plugin or box-release, `addVersion` calls `parseStorePayload` (`store.ts:411-416`).
- The schema field `app: z.record(z.string(), z.unknown()).nullish()` (`store-content.ts:55-56`) is stored whole. There is **no manifest validation** (no ui, runtime or semver check).
- The only extra check: an `app` item's release must declare `nextgent.kind === "app"` if it has a nextgent section (`store.ts:417-420`).

**What Paperclip sends to gcr on install**
- `gcrClient.install` → `POST /api/nextgent/installs` (`nextgent-gcr-client.ts:125-128`).
- Body type: `GcrInstallRequest` (`nextgent-gcr-client.ts:35-45`).
- The body is built in `nextgent-store.ts:286-296`: `{companyId, installId, itemKey, kind, version, permissions, optionalPermissions, routine?}`.
- **It never sends `app` (the manifest), `enabled`, `capabilities` or `instructions`.**
- It returns early with no gcr call when the payload has no `nextgent` section (`nextgent-store.ts:280`).
- The token it gets back is stored as a company secret (`205-215`).
- Other gcr calls:
  - entitlement: `GET /api/nextgent/entitlement` (client :148)
  - price: `PUT /api/nextgent/items/:key/price` (:147)
  - install session token: `POST /api/nextgent/installs/:id/session` (:138), exposed as `POST /api/companies/:companyId/installs/:installId/token` (`server/src/routes/nextgent.ts:171-193`)

**Everything `box-release` touches**
- Schema check constraint: `schema/store.ts:42`.
- Migration `0290_outgoing_ronan.sql:29` (the same migration adds `store_deployments` and the price columns). Migration `0291_secret_omega_sentinel.sql` adds `store_installs.enabled` and `nextgent_business_links.business_kind`. Neither is box-specific.
- Service:
  - `store.ts:24`
  - `parseBoxReleasePayload` (`store.ts:47-58`), which requires `{plan: object, signature: string}`
  - the dispatch at `store.ts:414-415`
  - `itemHasContent` returns false for it (`store-content.ts:146-152`)
- Test: `server/src/__tests__/nextgent-integration.test.ts:697-706`.
- Docs: `docs/api/nextgent.md:263, 298-300`.
- **Not present:** no route for computers to fetch a plan, no UI (the UI kind list lacks it), no special handling in `listForCompany` or deploy.
- gcr-api-clean's old store spells it `box_release` (`routes/store.js:42`). Paperclip spells it `box-release`.

---

## 2. gcr-api-clean: `entity_modules` and `business_app_instances`

### `entity_modules`
- No DDL for it exists in any repo; it is a pre-existing live table.
- Columns in use: `id, entity_slug, module_key, enabled, settings (jsonb), sort_order`.
- The platform-install convention keeps the install snapshot in `settings`: `{manifest, config, showOnPublic}` (`routes/platform.js:10-12`). `settings.list` is a separate convention for text-built automations.

**Readers**
- `platform.js:112-131` `loadInstalled(slug)`. It skips rows without `settings.manifest` and returns `installed[module_key] = {enabled, showOnPublic, manifest, config}` plus `page_order` by sort_order. It is used by:
  - `GET /state` (512-522, owner)
  - `GET /records` (657-685)
  - `GET /page/:slug/availability` (1001-1005)
  - `POST /records/:dk/:id/status` (1043)
  - **`GET /page/:slug` (1413-1525, the public page)**. It builds blocks from `manifest.block`, `dataKey`, `publicData`, `checkout`, `cart`, `section`, `fields`, `setup`, `provides`.
  - `POST /page/:slug/submit/:appId` (1559-1566)
  - around 1743 (manage)
  - waiver-info / waiver-sign (1874-1899)
  - cron reminders (1934)
  - `runAutomations` (466-507), which reads `manifest.type==='automation'`.
- `platform.js:2087-2101` `loadUserAutomations` / `saveUserAutomations` (module_key `automations`, `settings.list`).
- `routes/gcr.js:115`, 267-272, 467-468: `GET /api/gcr/entity/:slug` returns `modules[]` `{module_key, enabled, sort_order, settings}` and `module_keys`, and gates packs on them.
- `routes/business-profile.js:140-197`: admin profile `modules`.

**Writer**
- `POST /state` (`platform.js:605-627`). It upserts by `module_key` only rows that have `settings.manifest`, sets `{enabled, settings:{manifest,config,showOnPublic}, sort_order}`, and deletes managed rows that are missing from the payload.
- This is the old modular-dashboard and biz.html model. Its manifests are the old "69 file-based apps" shape (`block`, `dataKey`, `fields`), **not** the engine/v1 manifest.

### `business_app_instances`
- DDL: `sql/nextgent_apps.sql:24-43`. Columns:
  - `install_id` (PK, FK `nextgent_installs`)
  - `entity_slug, company_id, app_key, version`
  - `enabled` (default true), `public_enabled` (default true)
  - `render_mode` (check: `inline|button|page`, default inline)
  - `public_label, config jsonb, position int, manifest jsonb`
  - `created_at, updated_at`
- Also `app_records` (45-58). Applied as step 18a in `sql/ORDER.md:50`.
- **Writer**: `lib/appInstances.js:32-50` `project()`. It writes install_id, company_id, entity_slug, app_key, version, manifest (only if sent), enabled (only if boolean). It never sets render_mode, public_label or position. It is called from:
  - `routes/nextgent.js:331-338` (update of an existing install)
  - `routes/nextgent.js:445-460` (new install)
- `appInstances.remove()` (57-75) sets `enabled=false, public_enabled=false` and deletes `app_records` if `manifest.data.delete_on_uninstall`. Called from `nextgent.js:528` (DELETE) and :573 (unlink).
- `saveSettings` (130-146) writes `config`.
- **Readers**:
  - `appInstances.liveInstance` (81-94), which joins `nextgent_installs` (must be active and `kind==='app'`)
  - `routes/app-data.js`:
    - `installCaller` (45-62): install token → `/api/app-data/*` and `/api/app-install` (188-208, returns `{installId,itemKey,version,settings,granted}`)
    - `publicRouter` `GET /api/public/apps/:installId` (233-268, returns `{settings, data}`, **no manifest**) and `POST /:installId/:table` (270-292)
  - Mounts: `server.js:247, 288-289`.
- `lib/businessTables.js:90-91` only excludes these tables from generic sections (`PLATFORM_TABLES`).
- `scripts/test-app-data.js:33, 143-145, 212-219, 226` checks the projection in memory.
- **Nothing lists `business_app_instances` by slug.** There is no "apps for this business" route.

**What Paperclip's install endpoint writes in gcr** (`routes/nextgent.js:252-487`)
- `nextgent_installs` row: install_id, company_id, entity_slug, item_key, kind, version, permissions, routine_*, status, capabilities, instructions.
- For apps, `project(...)` with `manifest: b.app` (checked by `checkAppTables`, size cap 279-284).
- A token for non-automation kinds (`mintToken`).
- A billing charge and, optionally, a phone number.
- Entitlement is `entitlementFor` (210-232). It reads gcr's **own** store/billing tables (`billingStripe.itemByKey`, plans and grants via `lib/entitlements.js`).

### Field mapping, for folding `business_app_instances` into `entity_modules`

| business_app_instances | entity_modules |
|---|---|
| entity_slug | entity_slug |
| app_key | module_key |
| enabled | enabled |
| position | sort_order |
| manifest | settings.manifest |
| config | settings.config |
| public_enabled | settings.showOnPublic |

No `entity_modules` column exists for these, so they would need new `settings.*` keys (or new columns): `install_id`, `company_id`, `version`, `render_mode`, `public_label`.

Collision risks:
- `loadInstalled` treats any row with `settings.manifest` as an old-style block app. `/page/:slug` filters on `manifest.block`, so engine manifests (which have `ui`, not `block`) would be dropped silently.
- `POST /state` **deletes** managed rows it was not sent. It would delete Paperclip-projected rows unless they are marked and excluded.

---

## 3. Play-user

**`appOf(item)`** (`/home/user/Play-user/src/lib/storeItems.js:65-69`)
- Manifest: the first of `item.app ?? item.manifest ?? item.payload.app`, accepted only if it has a truthy `.ui`.
- Install id: `item.installId ?? item.install.id`.

**The renderer is at `/home/user/Play-user/src/components/InstalledApp.jsx`** (not under `screens/`)
- Needs both `manifest` and `installId` (lines 15-34). Otherwise it shows "no install id in the store list".
- Token: `getInstallToken(companyId, installId)` → Paperclip `POST /companies/:id/installs/:installId/token` (`src/lib/installToken.js`, `src/lib/paperclip.js:191-192`).
- Draws with `createGcrAdapter({baseUrl:'/biz', getToken})` and `<EngineApp surface="owner">`. `/biz` proxies to gcr `/api` (`vite.config.js:13`, `api/biz/[...path].js`).
- Rendered from `Apps.jsx:352` when `item.installed && !isSwitchedOff(item)`. Navigation uses the **item** id (`Apps.jsx:314`). `opensAsApp` = `kind==='app' || appOf(item).manifest` (288).

Other fields read (storeItems.js):
- `needsAccessTo`, `updateNewPermissions`, `needsApproval`, `installed`, `enabled`, `updateAvailable`
- price from `pricing|price|charge|priceCents` (not in the list; it comes from consent)
- `publisher`, `installedVersion`, `latestVersion`, `status`, `channel`, `approvalMode` (Apps.jsx:251, 400-407)

**Install sheet** (`Apps.jsx:212-283`)
- Sends `store.install(companyId, item.id, {approvalMode: mode, declinedPermissions})` (236).
- Update-mode tabs are `automatic` / `manual` (275).
- **No channel is sent at install**, so it defaults to stable. Channel and mode are changed later through `setSubscription` PATCH (400-407).
- The API client documents `channel?` (`paperclip.js:165-182`).

---

## 4. App-build- engine (`/home/user/App-build-/packages/engine/src`)

**`toStorePublication`** (`store.js:30-56`)
- Runs `validateManifest` with item `{key: m.id, kind: 'app', name, publisher}` and semver `m.version`.
- Item: `{key: m.id, kind, name, summary?, description?, iconUrl? (if http icon)}`.
- Version: `{version: m.version, payload: {nextgent: {kind:'app', permissions: m.permissions.map(p => ({permission: p.id, reason: p.reason}))}, app: m}, channel?, advisoryType?, required?, changelog?}`.
- **It drops `optional`** from permissions (line 52), although the manifest allows `optional` (`manifest.js:193`).
- `publishToStore` (66-111) POSTs `/api/store/admin/items`, falls back to the existing item on 409, then posts `/versions`.

**`createGcrAdapter`** (`adapter.js:154+`)
- Has no notion of install id. It sends `Authorization: Bearer <getToken()>` and gcr resolves the install from the token.
- Routes (`DEFAULT_ROUTES` 17-30), relative to baseUrl:
  - `/business/{section}`, `/business/{section}/{id}` (routes/business-data.js)
  - `/app-data/{table}`, `/app-data/{table}/{id}`
  - `/app-install`, `/app-install/settings`
- `createPublicAdapter` (272+) takes `installId` and uses `/public/apps/{installId}` and `/public/apps/{installId}/{table}`.

**Manifest base**
- Yes: app-manifest v1 from cybercheck-cloud (`manifest.js:1-18`). The contract file is at `/home/user/culturereset/cybercheck-cloud/contract/app-manifest.v1.json`.
- Two deliberate departures: `runtime.type:"engine"` and the top-level `ui`. Permissions use `resource:action` instead of v1's dotted form.
- **Used from v1:**
  - required `schema_version, id, name, version, publisher, runtime`
  - `surfaces` (kind `public` drives public views: gcr `appInstances.publicViews` 153-161, engine `render.js:25, 474`)
  - `permissions{id, reason, optional}`
  - `data{namespace, delete_on_uninstall, tables}` (gcr `checkAppTables`, `remove`)
  - `config` (settings keys: `store-rules.js` / gcr `lib/storeManifest.js:31-39`)
- **Only validated, not consumed:** `requires`, `capabilities`, `events`, `pricing`, `categories`, `homepage`, `icon`.
- `store-rules.js` is generated from gcr `lib/storeManifest.js` (`prepareVersion`: semver, id==item key, runtime required). **Paperclip runs none of these rules.**

---

## 5. gcr-unified public business page

- React pages `BusinessDetail` (`src/pages/BusinessDetail.jsx:114, 285-288, 872, 961-964`), `LinksPage` (60) and `ModulePage` (`/:business/:app`, App.jsx:220) use `usePageModules(slug)` from `src/components/public/PageModules.jsx`.
- That calls `fetchPageModules` → **`GET /api/public/business/:slug/apps`**, which is marked "PROPOSED" (`src/services/publicApi.js:69-78`). **The route does not exist in gcr-api-clean.**
- Rows are normalised to `{installId, appKey, version, renderMode, publicLabel, position, enabled, publicEnabled, config, manifest}`, kept only if enabled and publicEnabled, and sorted by position (`src/utils/modules.js`).
- Each module is drawn with `createPublicAdapter({baseUrl: API_BASE+'/api', installId})` and `<EngineApp surface="public">`. The manifest is taken from the list row because `/public/apps/:id` returns none.
- `renderMode` values used are `inline|button|page|action` (PageModules.jsx:1-11, `ActionRow`). **`action` is not allowed by the SQL check** (`nextgent_apps.sql:41`).
- When the route is missing (404), the page falls back to built-in sections gated by `business.modules` from `GET /api/gcr/entity/:slug`, i.e. `entity_modules` (`LinksPage.jsx:97-115`, `moduleOn(key)`).
- The legacy static `public/biz.html` still uses `GET /api/platform/page/:slug` and `/submit/:appId` (biz.html:11, 341, 448), i.e. the `entity_modules` `settings.manifest.block` model.

---

## 6. Old gcr-api-clean store (`routes/store.js`): what Paperclip lacks

- **Entitlement:** `access` = `free|plan|grant` per item; plans `store_plan_items` (340-393); per-business grants with expiry and revoke (397-440); `ent.decide` / `decideMany` (`lib/entitlements.js:39, 134`). Gcr's `/api/nextgent/entitlement` still uses this. Paperclip only proxies the answer and has no admin UI or routes for plans or grants.
- **Version history and semver:** integer `version` plus `semver` and the whole `manifest`, checked by `prepareVersion` (148-171). Paperclip versions are free text and app manifests are not validated.
- **Staged rollout:** `released_version` on the item and per-install `offered_version`. Actions are `release` (everyone entitled sees it) and `offer` (early access for an audience), plus `install` and `force` (178-317). `availableVersion` = max(released, offered) (`entitlements.js:48`). Paperclip has channels (stable/fast) plus `apply|force` plus `installMissing`, with no per-business offer/early-access and no "release" step separate from adding a version.
- **Permission changes:** `granted_permissions`; force turns into offer when new permissions are needed (208-210); owner `accept_permissions` (591-594). Paperclip covers this (`needs_approval`, `approvePermissions`, required vs optional).
- **Rollback:** force to an older version is allowed (`row.version === target` only skips an equal version). Paperclip `force` works by version string too.
- **Per-business admin view:** `GET /businesses/:slug` with entitlement and install per item (444-464); `PUT /businesses/:slug/plan` (466-477).
- **Owner install config:** `PATCH /:itemId/config`, filtered to the manifest's `configKeys` (639-656). Owner disable/enable keeps the install (634-635). Paperclip has only `enable` for pushed installs, with no owner disable.
- **Other item fields:** `access, category, publisher, icon` (ITEM_FIELDS :44). Paperclip has none of category, publisher or access.
- **Different kind set:** `app, module, map, parser, automation, box_release, integration` (:42).

---

## Mismatches the build must close

1. **Play-user can't open an app:** it needs `installId` (`item.installId` or `item.install.id`) and a manifest with `.ui` (`item.app`, `item.manifest` or `item.payload.app`). `listForCompany` (`store.ts:537-561`) sends neither: `id` is the item id, and no payload is included.
2. **gcr never gets the manifest:** Paperclip's `gcr.install` body omits `app` (and `enabled`), so the projection's `manifest` is never filled from Paperclip (`nextgent-store.ts:286-296` against gcr `nextgent.js:279-285`).
3. **Updates don't reach gcr:** `moveInstall` only calls gcr when permissions change, so a version bump never updates the projection's version or manifest (`store.ts:222-234`).
4. **No nextgent section means no gcr registration at all** (`nextgent-store.ts:280`), even for kind `app`.
5. **Enable state isn't sent:** switching off or on (`enabled=false` pushes, `enable()`) is not sent to gcr's projection.
6. **The projection is the wrong table:** it writes `business_app_instances`; the target is `entity_modules`. There:
   - `loadInstalled` / `/page/:slug` expect the old `manifest.block` shape and would drop engine manifests.
   - `POST /state` deletes any `settings.manifest` row it was not sent, so it would wipe Paperclip rows.
   - Needed keys with no column: install_id, company_id, version, render_mode, public_label, public_enabled.
7. **`/public/apps/:installId` and `liveInstance` read only `business_app_instances`** (joined to `nextgent_installs`). They would need repointing to `entity_modules`.
8. **gcr-unified calls a route that doesn't exist:** `GET /api/public/business/:slug/apps`. Rows must carry `installId, appKey, renderMode, publicLabel, position, enabled, publicEnabled, manifest`.
9. **`render_mode` values disagree:** gcr-unified uses `action`; the SQL check allows only `inline|button|page`. Nothing writes render_mode, public_label or position (no owner route), and nothing writes `public_enabled` except uninstall.
10. **Optional permissions are lost at publish:** the engine's `toStorePublication` drops `optional` (`store.js:52`), so Paperclip treats every app permission as required.
11. **Paperclip doesn't validate app manifests:** `payload.app` is accepted as any record (`store-content.ts:56`). There are no v1 checks, no `runtime`, no `ui`, no id==key or semver rule (gcr `storeManifest.prepareVersion` / engine `validateManifest`). gcr re-checks only `checkAppTables` and size.
12. **Play-user never sends channel at install:** the sheet sends `approvalMode` and `declinedPermissions` only (`Apps.jsx:236`), so every install starts on stable.
13. **Paperclip's admin UI only knows 5 kinds:** `ui/src/api/store.ts:3` has no `agent`, `app` or `box-release`.
14. **`box-release` stops at the store:** there is no fetch route for computers and no UI, and the spelling differs from gcr (`box-release` vs `box_release`).
15. **Store features exist only in gcr:** plans, grants, `access` free/plan/grant, `released`/`offered` staged rollout, per-business admin view and plan assignment, owner config/disable, semver and manifest per version. Paperclip has none of them and still relies on gcr's `store_items` (by key) for entitlement and prices.
16. **No listing by business:** nothing in gcr lists apps for one business across either table.
