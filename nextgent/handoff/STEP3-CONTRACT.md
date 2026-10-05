# Step 3 contract: one install path, one projection, one renderer

Scope: CONS phases 2, 3, 8 (+ the pieces of 11/12 needed to prove it). Source of mismatches: `review/09-step3-scoping.md` (items 1–16). Every builder implements exactly these names; nothing else is invented.

## A. Paperclip Store (authority)

**Kinds:** `plugin, pack, skill, automation, connector, agent, app, layout`. `box-release` is removed everywhere it appears (schema check constraint via a new additive migration, `STORE_ITEM_KINDS`, `parseBoxReleasePayload`, dispatch, test, docs). The UI kind list (`ui/src/api/store.ts`, `Store.tsx`, `StoreAdmin.tsx`) is brought up to the same list.

**App manifest validation on `addVersion` (kind `app`):** until `@nextgent/app-engine` is installable in Paperclip (DECISIONS #7/#23), a minimal server-side gate in `store-content.ts`: `payload.app` must be an object with `schema_version`, `id === item.key`, `version === the version string` (valid semver), `runtime.type === "engine"`, `ui` object, `permissions` array; `payload.nextgent.kind === "app"`. Reject with the field path. Mark the gate with a comment pointing at the engine validator as the full rule set.

**`listForCompany` adds per item:** `installId` (store_installs.id or null), `installEnabled` (store_installs.enabled), `versionId`, `app` (the installed version's `payload.app`, or the latest version's when not installed; null for non-apps), `price: {amountCents, currency, interval, model}` from the item columns, `approvedPermissions`. Nothing existing is renamed.

**Install route body** gains `channel?: "stable"|"fast"` (already typed in the route; make the sheet send it).

**Bridge calls to gcr (`nextgent-store.ts` → `POST /api/nextgent/installs`)** for kind `app` (and `layout`) always happen, nextgent section or not; the body adds `app` (the manifest), `enabled` (boolean), and on update `version` + `app` are re-sent even when permissions did not change (`moveInstall`). `enable()`/disable push `PATCH /api/nextgent/installs/:id` with `{enabled}`. `uninstall` → gcr `DELETE /api/nextgent/installs/:id` keeps meaning "disable the projection, keep data" (DECISIONS #22).

## B. gcr-api-clean (business-side projection) — `entity_modules` only

`sql/nextgent_entity_modules.sql` (additive; replaces `business_app_instances` in `sql/ORDER.md`; `nextgent_apps.sql` keeps `app_records` and drops its `business_app_instances` DDL into a `-- superseded` comment, no DROP TABLE):

```
alter table entity_modules
  add column if not exists managed_by   text,          -- 'paperclip' | null (owner/legacy)
  add column if not exists install_id   text unique,   -- Paperclip store_installs.id
  add column if not exists company_id   text,
  add column if not exists version      text,
  add column if not exists render_mode  text check (render_mode in ('inline','button','page','action')) default 'inline',
  add column if not exists public_label text,
  add column if not exists updated_at   timestamptz default now();
create index if not exists entity_modules_install_id_idx on entity_modules (install_id);
```

Mapping (one row per install): `module_key = app key`, `enabled`, `sort_order = position`, `settings.manifest = engine manifest`, `settings.config = app settings`, `settings.showOnPublic = public flag` (single public flag; no `public_enabled` column), `managed_by = 'paperclip'`.

`lib/appInstances.js` is rewritten to read/write `entity_modules` (same exported function names: `project`, `remove` (= enabled false, showOnPublic false, never deletes), `saveSettings`, `liveInstance`, `publicViews`). `routes/app-data.js` and `/api/public/apps/:installId` use it unchanged in behaviour, plus `/api/public/apps/:installId` now also returns `manifest`.

Legacy readers protected: `routes/platform.js` `loadInstalled` skips rows with `managed_by = 'paperclip'`; `POST /state` never deletes or upserts rows with `managed_by = 'paperclip'` (filter in both the read-back and the delete). `routes/gcr.js` `modules[]` keeps returning all rows (it already exposes `settings`), adding `managed_by`, `render_mode`, `public_label`, `install_id`, `version`.

**New routes:**
- `GET /api/public/business/:slug/apps` → `[{installId, appKey, version, renderMode, publicLabel, position, enabled, publicEnabled, config, manifest}]` for rows `managed_by='paperclip' and enabled and settings.showOnPublic`, ordered by sort_order. This is what gcr-unified already calls.
- Owner (ownerAuth, `req.entitySlug`): `GET /api/owner/apps` (all paperclip rows, same shape), `PATCH /api/owner/apps/:installId` with any of `{renderMode, publicLabel, position, publicEnabled}` → writes `render_mode`, `public_label`, `sort_order`, `settings.showOnPublic`. Reorder = one PATCH per changed row or `PUT /api/owner/apps/order` with `[installId…]`. `enabled` is NOT owner-writable here (Paperclip owns it).
- Paperclip-signed `PATCH /api/nextgent/installs/:id` accepts `{enabled, version, app}`.

`scripts/test-app-data.js` moves to the new table shape; add tests for the public list route, owner PATCH/order, legacy `/state` not touching paperclip rows.

## C. App-build- engine

`store.js` `toStorePublication` keeps `optional` on permissions. `packages/engine/package.json` is made publishable as `@nextgent/app-engine` (`files`, `exports`, `types`, `repository`, no `private`); add a `prepack` check. Publishing itself waits for the owner's npm token (DECISIONS #23).

## D. Play-user

Install sheet sends `channel` (tabs reuse the existing channel labels already used in the installed sheet; no new wording). `appOf()` reads `item.app` and `item.installId` (now provided); the fallback text "The store hasn't sent this app's screen yet" is unreachable once A lands — keep it as the error state. Apps → Open renders `<EngineApp surface="owner">` as today. Public switch (`item.public`) is replaced by the owner apps route: toggle → `PATCH /biz/owner/apps/:installId {publicEnabled}`; show/hide and order live in Business → Public page later (Step 8), not now.

## E. gcr-unified

No route change: `GET /api/public/business/:slug/apps` now exists. Remove the "PROPOSED" marker; keep the fallback to `business.modules` for businesses with no paperclip rows. `renderMode: 'action'` is now valid.

## F. Order of landing (to keep every repo green)

1. gcr B (additive; old table untouched until the switch inside appInstances.js) and engine C — independent.
2. Paperclip A (sends the new fields; gcr already accepts them).
3. Play-user D and gcr-unified E (consume).
4. Proof: a scripted walk in the scratchpad against stub servers (gcr + Paperclip test harnesses already exist) — install an app from the Paperclip store for a company → gcr `entity_modules` row with manifest → `GET /api/public/business/:slug/apps` returns it → Play-user `appOf()` returns manifest + installId → owner PATCH hides it → public list omits it → uninstall → row disabled, `app_records` intact.
