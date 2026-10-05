#!/usr/bin/env node
// PROOF DRIVER: walks STEP3-CONTRACT.md §F.4 over real HTTP between the two
// servers started by run.sh (Paperclip on PC_URL, gcr-api-clean on GCR_URL),
// asserting at each step and writing transcript.md next to this file.
// Stops at the first failing step and reports it.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toStorePublication } from "/home/user/App-build-/packages/engine/src/store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PC = (process.env.PC_URL || "http://127.0.0.1:4600").replace(/\/+$/, "");
const GCR = (process.env.GCR_URL || "http://127.0.0.1:4610").replace(/\/+$/, "");
const APPS = "/home/user/App-build-/apps";

const lines = [];
const log = (s = "") => { lines.push(s); console.log(s); };
const json = (v) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";
const git = (dir) => execSync(`git -C ${dir} log --oneline -1 && git -C ${dir} status --short | head -20`, { encoding: "utf8" }).trim();

let step = 0;
let failed = null;
const results = [];
function section(title) { step += 1; log(`\n## Step ${step}: ${title}\n`); }
function check(label, cond, detail) {
  if (cond) { log(`- PASS: ${label}`); return true; }
  log(`- **FAIL**: ${label}${detail !== undefined ? "\n" + json(detail) : ""}`);
  failed = failed || { step, label, detail };
  return false;
}
function finishStep(ok, note) { results.push({ step, ok, note }); }

/** One HTTP call, logged: method, URL, body, status, and the fields the step cares about. */
async function call(base, method, p, { body, headers = {}, actor, show } = {}) {
  const url = `${base}${p}`;
  const init = { method, headers: { accept: "application/json", ...headers } };
  if (actor) init.headers["x-proof-actor"] = actor;
  if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 400) }; }
  const who = base === PC ? `Paperclip${actor ? ` as ${actor}` : " as owner"}` : "gcr-api-clean";
  log(`\`${method} ${url.replace(PC, "{paperclip}").replace(GCR, "{gcr}")}\` (${who}) → **${res.status}**`);
  if (body !== undefined) log("request body:\n" + json(summarizeBody(body)));
  if (show) log("response (selected):\n" + json(pick(parsed, show)));
  else if (parsed !== null && (Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length) <= 12) log("response:\n" + json(parsed));
  return { status: res.status, body: parsed, headers: res.headers };
}
function summarizeBody(b) {
  if (b && typeof b === "object" && b.payload?.app) return { ...b, payload: { ...b.payload, app: `<manifest ${b.payload.app.id}@${b.payload.app.version}, ${JSON.stringify(b.payload.app).length} bytes>` } };
  return b;
}
function pick(obj, keys) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((o) => pick(o, keys));
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, k === "app" || k === "manifest" ? (obj[k] ? `<manifest ${obj[k].id}@${obj[k].version}, ui: ${typeof obj[k].ui}>` : obj[k]) : obj[k]]));
}
async function tables(...names) {
  const r = await fetch(`${GCR}/__proof/tables?names=${names.join(",")}`);
  return r.json();
}
function rowDump(title, rows) {
  const slim = (r) => ({ ...r, settings: r.settings ? { ...r.settings, manifest: r.settings.manifest ? `<manifest ${r.settings.manifest.id}@${r.settings.manifest.version}>` : r.settings.manifest } : r.settings });
  log(`${title}:\n` + json(Array.isArray(rows) ? rows.map(slim) : rows));
}
async function gcrCalls() { return (await fetch(`${GCR}/__proof/calls`)).json(); }
const manifestOf = (dir) => JSON.parse(readFileSync(path.join(APPS, dir, "manifest.json"), "utf8"));
const rowFor = (rows, installId) => rows.find((r) => r.install_id === installId);

async function waitReady() {
  for (let i = 0; i < 600; i += 1) {
    try {
      const a = await fetch(`${PC}/__proof/ready`);
      const b = await fetch(`${GCR}/__proof/ready`);
      if (a.ok && b.ok) return a.json();
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("servers did not come up");
}

async function main() {
  log("# Proof 3: STEP3-CONTRACT §F.4 over real HTTP (Paperclip ⇄ gcr-api-clean)\n");
  log(`Run at ${new Date().toISOString()}.`);
  log(`\nPaperclip at \`${PC}\` (real routes/store.ts + routes/nextgent.ts on embedded Postgres with migrations), gcr-api-clean at \`${GCR}\` (real routes on scripts/lib/memdb.js). Shared NEXTGENT_SERVICE_SECRET; Paperclip's PAPERCLIP_PUBLIC_URL is gcr's PAPERCLIP_ISSUER and its JWKS URL.\n`);
  log("Repo state at run time:\n```\n" + git("/home/user/paperclip") + "\n---\n" + git("/home/user/gcr-api-clean") + "\n---\n" + git("/home/user/App-build-") + "\n```");

  const ready = await waitReady();
  const companyId = ready.companyId;
  log(`\nPaperclip company: \`${companyId}\` (owner user \`${ready.ownerUserId}\`), created by direct insert into companies + an owner membership (the way server/src/__tests__ seed one).`);

  // ── 1. link ───────────────────────────────────────────────────────────
  section("Create the business and link it (Paperclip bridge: POST /api/companies/:id/business-link {create})");
  const link = await call(PC, "POST", `/api/companies/${companyId}/business-link`, { body: { create: { name: "Proof Cafe", kind: "cafe" } } });
  check("link answered 201 with the slug gcr-api-clean created", link.status === 201 && typeof link.body?.entitySlug === "string", link.body);
  const slug = link.body?.entitySlug;
  const linked = await call(PC, "GET", `/api/companies/${companyId}/business-link`);
  check("Paperclip records the link", linked.body?.linked === true && linked.body.entitySlug === slug, linked.body);
  let t = await tables("entity", "company_links", "business_mcp_tokens");
  rowDump("gcr memdb: entity", t.entity);
  rowDump("gcr memdb: company_links", t.company_links);
  rowDump("gcr memdb: business_mcp_tokens (hashes only)", t.business_mcp_tokens.map((r) => ({ ...r, token_hash: r.token_hash ? r.token_hash.slice(0, 12) + "…" : r.token_hash })));
  check("gcr has the entity row and the company_links row", t.entity.some((e) => e.slug === slug) && t.company_links.some((l) => l.company_id === companyId && l.entity_slug === slug));
  check("gcr minted the company-level business token (one business_mcp_tokens row, company_id set, no install_id)", t.business_mcp_tokens.filter((r) => r.company_id === companyId && !r.install_id).length === 1);
  const calls1 = await gcrCalls();
  check("the link call reached gcr signed (x-nextgent-* headers)", calls1.some((c) => c.method === "POST" && c.path === "/api/nextgent/link" && c.signed));
  finishStep(!failed, "path: Paperclip bridge route → gcr POST /api/nextgent/link {create}");
  if (failed) return;

  // ── 2. publish ────────────────────────────────────────────────────────
  section("Publish the QR Menu app (shipped manifest apps/qr-menu/manifest.json through the engine's toStorePublication) via the admin store routes");
  const qr = manifestOf("qr-menu");
  const pub = toStorePublication(qr, { channel: "stable", changelog: "First release" });
  check("engine toStorePublication accepts the shipped manifest", pub.ok === true, pub.errors);
  if (failed) return;
  log(`Publication item: ${JSON.stringify(pub.item)}; version.payload.nextgent: ${JSON.stringify(pub.version.payload.nextgent)}`);
  const item = await call(PC, "POST", "/api/store/admin/items", { body: pub.item, actor: "admin", show: ["id", "key", "kind", "name", "status"] });
  check("item created (201, kind app)", item.status === 201 && item.body?.kind === "app", item.body);
  const itemId = item.body?.id;
  // The gate, negative: a manifest whose version does not match the release.
  const badVersion = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: { ...pub.version, version: "9.9.9" }, actor: "admin" });
  check("gate rejects a release whose manifest version differs, naming the field path", badVersion.status === 400 && /payload\.app\.version/.test(JSON.stringify(badVersion.body)), badVersion.body);
  const badUi = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: { ...pub.version, payload: { ...pub.version.payload, app: { ...qr, ui: "nope" } } }, actor: "admin" });
  check("gate rejects a manifest without a ui object (payload.app.ui)", badUi.status === 400 && /payload\.app\.ui/.test(JSON.stringify(badUi.body)), badUi.body);
  const v1 = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: pub.version, actor: "admin", show: ["appliedTo", "pendingFor", "needsApprovalFor", "failedFor"] });
  check("version 1.0.0 passes the gate (201)", v1.status === 201, v1.body);
  const price = await call(PC, "PUT", `/api/store/admin/items/${itemId}/price`, { body: { amountCents: 0, currency: "usd", model: "free" }, actor: "admin" });
  check("price set and forwarded to gcr billing", price.status === 200 && price.body?.billing?.itemKey === "core-qr-menu", price.body);
  const published = await call(PC, "POST", `/api/store/admin/items/${itemId}/publish`, { actor: "admin", show: ["id", "status", "latestVersionId"] });
  check("published", published.status === 200 && published.body?.status === "published", published.body);
  t = await tables("billing_item_prices");
  rowDump("gcr memdb: billing_item_prices", t.billing_item_prices);
  finishStep(!failed);
  if (failed) return;

  // ── 3. install ────────────────────────────────────────────────────────
  section("Install for the company on the fast channel (POST /api/companies/:id/store/:itemId/install {channel: fast})");
  const callsBefore = (await gcrCalls()).length;
  const inst = await call(PC, "POST", `/api/companies/${companyId}/store/${itemId}/install`, { body: { channel: "fast" }, show: ["id", "companyId", "itemId", "channel", "approvalMode", "enabled", "approvedPermissions", "tokenSecretId", "charge", "charged"] });
  check("install answered 201", inst.status === 201 && typeof inst.body?.id === "string", inst.body);
  const installId = inst.body?.id;
  check("install is on channel fast, enabled, with the manifest's permissions approved (menu:read + optional menu:write) and a token secret stored", inst.body?.channel === "fast" && inst.body?.enabled === true && JSON.stringify(inst.body?.approvedPermissions) === JSON.stringify(["menu:read", "menu:write"]) && !!inst.body?.tokenSecretId, inst.body);
  const installCalls = (await gcrCalls()).slice(callsBefore);
  log("gcr inbound /api/nextgent calls during install:\n" + json(installCalls.map((c) => ({ ...c, body: c.body ? summarizeBody({ ...c.body, ...(c.body.app ? { app: `<manifest ${c.body.app.id}@${c.body.app.version}>` } : {}) }) : null }))));
  const installCall = installCalls.find((c) => c.method === "POST" && c.path === "/api/nextgent/installs");
  check("gcr received a signed POST /api/nextgent/installs carrying app (the manifest) and enabled", !!installCall && installCall.signed && installCall.body?.app?.id === "core-qr-menu" && installCall.body?.enabled === true && installCall.body?.installId === installId && installCall.body?.kind === "app" && installCall.body?.version === "1.0.0", installCall);
  check("entitlement was asked first (GET /api/nextgent/entitlement)", installCalls.some((c) => c.method === "GET" && c.path.startsWith("/api/nextgent/entitlement")));
  t = await tables("nextgent_installs", "entity_modules", "business_mcp_tokens");
  rowDump("gcr memdb: nextgent_installs", t.nextgent_installs);
  rowDump("gcr memdb: entity_modules", t.entity_modules);
  const em = rowFor(t.entity_modules, installId);
  check("entity_modules has one row for the install: managed_by paperclip, module_key = app key, company_id, version 1.0.0, enabled, settings.manifest = the manifest, settings.showOnPublic true, render_mode inline", !!em && em.managed_by === "paperclip" && em.module_key === "core-qr-menu" && em.company_id === companyId && em.entity_slug === slug && em.version === "1.0.0" && em.enabled === true && em.settings?.manifest?.id === "core-qr-menu" && em.settings?.manifest?.ui && em.settings?.showOnPublic === true && em.render_mode === "inline", em);
  check("nextgent_installs row is active, kind app, permissions as approved", t.nextgent_installs.some((r) => r.install_id === installId && r.status === "active" && r.kind === "app" && JSON.stringify(r.permissions) === JSON.stringify(["menu:read", "menu:write"])));
  check("gcr minted an install token (business_mcp_tokens row with install_id)", t.business_mcp_tokens.some((r) => r.install_id === installId && !r.revoked_at));
  check("the legacy row on another business is untouched", t.entity_modules.some((r) => r.id === "legacy-1" && r.managed_by === undefined && r.enabled === true));
  finishStep(!failed);
  if (failed) return;

  // ── 4. listing ────────────────────────────────────────────────────────
  section("GET /api/companies/:id/store carries installId, app.ui, installEnabled, price");
  const list = await call(PC, "GET", `/api/companies/${companyId}/store`);
  const entry = Array.isArray(list.body) ? list.body.find((i) => i.id === itemId) : null;
  log("listing entry (selected):\n" + json(pick(entry || {}, ["id", "key", "kind", "installed", "enabled", "installedVersion", "latestVersion", "channel", "approvalMode", "installId", "installEnabled", "versionId", "app", "price", "approvedPermissions", "needsAccessTo", "updateAvailable"])));
  check("installId is the store_installs id", entry?.installId === installId, entry);
  check("app is the installed manifest with a ui object (what Play-user appOf() reads)", entry?.app?.id === "core-qr-menu" && entry.app.version === "1.0.0" && typeof entry.app.ui === "object" && entry.app.ui !== null);
  check("installEnabled true, installedVersion 1.0.0, channel fast", entry?.installEnabled === true && entry?.installedVersion === "1.0.0" && entry?.channel === "fast");
  check("price {amountCents, currency, interval, model}", entry?.price && entry.price.amountCents === 0 && entry.price.currency === "usd" && "interval" in entry.price && entry.price.model === "free", entry?.price);
  check("approvedPermissions listed", JSON.stringify(entry?.approvedPermissions) === JSON.stringify(["menu:read", "menu:write"]));
  finishStep(!failed);
  if (failed) return;

  // ── 5. install token ──────────────────────────────────────────────────
  section("POST /api/companies/:id/installs/:installId/token → short-lived install session token from gcr");
  const tok = await call(PC, "POST", `/api/companies/${companyId}/installs/${installId}/token`, { show: ["expiresAt"] });
  check("200 with a token and an expiresAt", tok.status === 200 && typeof tok.body?.token === "string" && typeof tok.body?.expiresAt === "string", tok.body && { ...tok.body, token: "…" });
  const ttl = (new Date(tok.body?.expiresAt).getTime() - Date.now()) / 1000;
  log(`token prefix: \`${String(tok.body?.token).slice(0, 12)}…\`, expires in ~${Math.round(ttl)} s`);
  check("expiresAt is set, in the future and at most 300 s away", Number.isFinite(ttl) && ttl > 0 && ttl <= 300, { expiresAt: tok.body?.expiresAt });
  check("it is gcr's install session token form (gcr_mcp_ist.)", String(tok.body?.token).startsWith("gcr_mcp_ist."));
  const installToken = tok.body?.token;
  const me = await call(GCR, "GET", "/api/app-install", { headers: { authorization: `Bearer ${installToken}` } });
  check("the token works against gcr /api/app-install for this install", me.status === 200 && me.body?.installId === installId && me.body?.itemKey === "core-qr-menu" && me.body?.version === "1.0.0", me.body);
  finishStep(!failed);
  if (failed) return;

  // ── 6. public list ────────────────────────────────────────────────────
  section("gcr GET /api/public/business/:slug/apps → one row with installId, manifest, publicEnabled true");
  const pub1 = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { show: ["installId", "appKey", "version", "renderMode", "publicLabel", "position", "enabled", "publicEnabled", "config", "manifest"] });
  check("one row", pub1.status === 200 && Array.isArray(pub1.body) && pub1.body.length === 1, pub1.body);
  const row6 = pub1.body?.[0];
  check("row: installId, appKey core-qr-menu, version 1.0.0, manifest with ui, publicEnabled true, enabled true, renderMode inline", row6?.installId === installId && row6?.appKey === "core-qr-menu" && row6?.version === "1.0.0" && row6?.manifest?.ui && row6?.publicEnabled === true && row6?.enabled === true && row6?.renderMode === "inline", row6 && { ...row6, manifest: "…" });
  const SHAPE = ["installId", "appKey", "version", "renderMode", "publicLabel", "position", "enabled", "publicEnabled", "config", "manifest"];
  check("row has exactly the contract's shape", row6 && SHAPE.every((k) => k in row6));
  const unknownBiz = await call(GCR, "GET", `/api/public/business/no-such-business/apps`);
  check("an unknown slug is a JSON 404", unknownBiz.status === 404 && !!unknownBiz.body?.error);
  finishStep(!failed);
  if (failed) return;

  // ── 7. owner hides it ─────────────────────────────────────────────────
  section("Owner PATCH on gcr with a Paperclip business token (the Play-user path): publicEnabled false hides it from the public list only");
  const bt = await call(PC, "POST", `/api/companies/${companyId}/business-token`, { show: ["expiresAt"] });
  check("business token issued (JWT, expiresAt set)", bt.status === 200 && String(bt.body?.token).split(".").length === 3 && !!bt.body?.expiresAt, bt.body && { expiresAt: bt.body.expiresAt });
  const bizToken = bt.body?.token;
  const auth = { authorization: `Bearer ${bizToken}` };
  const ownerList1 = await call(GCR, "GET", "/api/owner/apps", { headers: auth, show: SHAPE });
  check("gcr verified the JWT against Paperclip's JWKS over HTTP and resolved the business: owner list has the row", ownerList1.status === 200 && ownerList1.body?.length === 1 && ownerList1.body[0].installId === installId, ownerList1.body);
  const noEnabled = await call(GCR, "PATCH", `/api/owner/apps/${installId}`, { headers: auth, body: { enabled: false } });
  check("enabled is not owner-writable (PATCH {enabled:false} → 400, nothing to change)", noEnabled.status === 400, noEnabled.body);
  const hide = await call(GCR, "PATCH", `/api/owner/apps/${installId}`, { headers: auth, body: { publicEnabled: false }, show: SHAPE });
  check("PATCH {publicEnabled:false} → 200, row publicEnabled false, enabled still true", hide.status === 200 && hide.body?.publicEnabled === false && hide.body?.enabled === true, hide.body);
  const pub2 = await call(GCR, "GET", `/api/public/business/${slug}/apps`);
  check("public list is now empty", pub2.status === 200 && Array.isArray(pub2.body) && pub2.body.length === 0, pub2.body);
  const ownerList2 = await call(GCR, "GET", "/api/owner/apps", { headers: auth, show: SHAPE });
  check("owner list still shows it, publicEnabled false", ownerList2.body?.length === 1 && ownerList2.body[0].publicEnabled === false);
  t = await tables("entity_modules");
  rowDump("gcr memdb: entity_modules", t.entity_modules.filter((r) => r.install_id === installId));
  check("memdb: settings.showOnPublic false, enabled true", rowFor(t.entity_modules, installId)?.settings?.showOnPublic === false && rowFor(t.entity_modules, installId)?.enabled === true);
  // Put it back for the later steps, through the same owner route.
  const show = await call(GCR, "PATCH", `/api/owner/apps/${installId}`, { headers: auth, body: { publicEnabled: true, renderMode: "button", publicLabel: "Our menu" }, show: SHAPE });
  check("PATCH {publicEnabled:true, renderMode:button, publicLabel} → public again with the owner's render fields", show.status === 200 && show.body?.publicEnabled === true && show.body?.renderMode === "button" && show.body?.publicLabel === "Our menu", show.body);
  const pub3 = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { show: ["installId", "renderMode", "publicLabel", "publicEnabled"] });
  check("public list has it back with renderMode button and the label", pub3.body?.length === 1 && pub3.body[0].renderMode === "button" && pub3.body[0].publicLabel === "Our menu");
  finishStep(!failed);
  if (failed) return;

  // ── 8. version 1.1.0 ──────────────────────────────────────────────────
  section("Publish 1.1.0 and update the install → gcr row moves to 1.1.0 through PATCH /api/nextgent/installs/:id");
  const manual = await call(PC, "PATCH", `/api/companies/${companyId}/store/${itemId}`, { body: { approvalMode: "manual" }, show: ["id", "channel", "approvalMode"] });
  check("install set to manual updates (so the release is not auto-applied and the explicit update path is exercised)", manual.status === 200 && manual.body?.approvalMode === "manual", manual.body);
  const qr11 = { ...qr, version: "1.1.0", summary: "A live menu customers scan at the table (1.1.0)." };
  const pub11 = toStorePublication(qr11, { channel: "fast", changelog: "Proof release 1.1.0" });
  check("engine accepts the 1.1.0 manifest", pub11.ok === true, pub11.errors);
  const v11 = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: pub11.version, actor: "admin", show: ["appliedTo", "pendingFor", "needsApprovalFor", "failedFor"] });
  check("1.1.0 added on the fast channel; the manual install is pending (not auto-applied)", v11.status === 201 && v11.body?.appliedTo === 0 && v11.body?.pendingFor === 1, v11.body);
  const list2 = await call(PC, "GET", `/api/companies/${companyId}/store`);
  const entry2 = list2.body?.find((i) => i.id === itemId);
  log("listing entry (selected):\n" + json(pick(entry2 || {}, ["installedVersion", "latestVersion", "updateAvailable", "updateChangelog", "needsApproval", "updateNewPermissions", "app"])));
  check("listing shows the update available (1.0.0 → 1.1.0), no new permissions, app still the installed 1.0.0 manifest", entry2?.installedVersion === "1.0.0" && entry2?.latestVersion === "1.1.0" && entry2?.updateAvailable === true && entry2?.needsApproval === false && entry2?.app?.version === "1.0.0");
  const before8 = (await gcrCalls()).length;
  const upd = await call(PC, "POST", `/api/companies/${companyId}/store/${itemId}/update`, { body: {}, show: ["id", "versionId", "enabled", "approvedPermissions"] });
  check("update → 200", upd.status === 200, upd.body);
  const updCalls = (await gcrCalls()).slice(before8);
  log("gcr inbound calls during update:\n" + json(updCalls.map((c) => ({ ...c, body: c.body ? { ...c.body, ...(c.body.app ? { app: `<manifest ${c.body.app.id}@${c.body.app.version}>` } : {}) } : null }))));
  const patch8 = updCalls.find((c) => c.method === "PATCH" && c.path === `/api/nextgent/installs/${installId}`);
  check("gcr received a signed PATCH /api/nextgent/installs/:id with version 1.1.0 and the 1.1.0 manifest (same scope → PATCH, not re-register)", !!patch8 && patch8.signed && patch8.body?.version === "1.1.0" && patch8.body?.app?.version === "1.1.0", patch8);
  t = await tables("entity_modules", "nextgent_installs");
  rowDump("gcr memdb: entity_modules (the install)", t.entity_modules.filter((r) => r.install_id === installId));
  const em8 = rowFor(t.entity_modules, installId);
  check("entity_modules row: version 1.1.0, settings.manifest.version 1.1.0, enabled true, owner fields kept (button / Our menu / showOnPublic true)", em8?.version === "1.1.0" && em8?.settings?.manifest?.version === "1.1.0" && em8?.enabled === true && em8?.render_mode === "button" && em8?.public_label === "Our menu" && em8?.settings?.showOnPublic === true, em8);
  check("nextgent_installs row moved to 1.1.0", t.nextgent_installs.find((r) => r.install_id === installId)?.version === "1.1.0");
  const list3 = await call(PC, "GET", `/api/companies/${companyId}/store`);
  const entry3 = list3.body?.find((i) => i.id === itemId);
  check("listing: installedVersion 1.1.0, app 1.1.0, no update pending", entry3?.installedVersion === "1.1.0" && entry3?.app?.version === "1.1.0" && entry3?.updateAvailable === false, pick(entry3 || {}, ["installedVersion", "latestVersion", "updateAvailable", "app"]));
  finishStep(!failed);
  if (failed) return;

  // ── 9. disable / enable ───────────────────────────────────────────────
  section("Disable / enable: Paperclip has no owner disable route; the one disabled state is an admin push with enabled:false, then the owner's POST …/enable");
  log("routes/store.ts at this head exposes install, enable, update, PATCH (channel/approvalMode) and DELETE for a company; there is no owner disable route. A disabled install is reached through the admin deploy with `installMissing: true, enabled: false` (a push switched off). This step uses a second shipped app, FAQ (apps/faq/manifest.json, which has an app table `entries` for step 10).");
  const faq = manifestOf("faq");
  const pubFaq = toStorePublication(faq, { channel: "stable" });
  check("engine accepts the FAQ manifest", pubFaq.ok === true, pubFaq.errors);
  const faqItem = await call(PC, "POST", "/api/store/admin/items", { body: pubFaq.item, actor: "admin", show: ["id", "key", "kind", "status"] });
  const faqItemId = faqItem.body?.id;
  const faqV = await call(PC, "POST", `/api/store/admin/items/${faqItemId}/versions`, { body: pubFaq.version, actor: "admin", show: ["appliedTo", "pendingFor"] });
  const faqPub = await call(PC, "POST", `/api/store/admin/items/${faqItemId}/publish`, { actor: "admin", show: ["status"] });
  check("FAQ published", faqItem.status === 201 && faqV.status === 201 && faqPub.status === 200 && faqPub.body?.status === "published");
  const before9 = (await gcrCalls()).length;
  const deploy = await call(PC, "POST", `/api/store/admin/items/${faqItemId}/deploy`, { body: { version: "1.0.0", action: "apply", audience: { mode: "companies", companyIds: [companyId] }, installMissing: true, enabled: false }, actor: "admin", show: ["targeted", "apply", "install", "installSwitchedOff", "skip", "failedFor", "companies"] });
  check("admin push installs it switched off (install 1, installSwitchedOff 1)", [200, 201].includes(deploy.status) && deploy.body?.install === 1 && deploy.body?.installSwitchedOff === 1 && deploy.body?.failedFor?.length === 0, deploy.body);
  const pcInstalls = await (await fetch(`${PC}/__proof/installs`)).json();
  const faqInstall = pcInstalls.find((i) => i.itemId === faqItemId);
  log("Paperclip store_installs for FAQ:\n" + json(faqInstall && { id: faqInstall.id, enabled: faqInstall.enabled, approvedPermissions: faqInstall.approvedPermissions, tokenSecretId: faqInstall.tokenSecretId, channel: faqInstall.channel }));
  check("store_installs row exists with enabled false and nothing registered upstream yet (approvedPermissions null, no token)", !!faqInstall && faqInstall.enabled === false && faqInstall.approvedPermissions === null && faqInstall.tokenSecretId === null);
  const faqInstallId = faqInstall?.id;
  const pushCalls = (await gcrCalls()).slice(before9);
  check("a switched-off push tells gcr nothing (no /api/nextgent/installs call yet)", !pushCalls.some((c) => c.path.startsWith("/api/nextgent/installs")), pushCalls);
  const listOff = await call(PC, "GET", `/api/companies/${companyId}/store`);
  const faqEntryOff = listOff.body?.find((i) => i.id === faqItemId);
  check("listing: installed true, enabled false, installEnabled false, installId set", faqEntryOff?.installed === true && faqEntryOff?.enabled === false && faqEntryOff?.installEnabled === false && faqEntryOff?.installId === faqInstallId, pick(faqEntryOff || {}, ["installed", "enabled", "installEnabled", "installId"]));
  const tokOff = await call(PC, "POST", `/api/companies/${companyId}/installs/${faqInstallId}/token`);
  check("no install token while switched off (409)", tokOff.status === 409, tokOff.body);
  const before9b = (await gcrCalls()).length;
  const en = await call(PC, "POST", `/api/companies/${companyId}/store/${faqItemId}/enable`, { body: {}, show: ["id", "enabled", "approvedPermissions", "tokenSecretId", "charged"] });
  check("owner enable → 200, enabled true, token stored", en.status === 200 && en.body?.enabled === true && !!en.body?.tokenSecretId, en.body);
  const enCalls = (await gcrCalls()).slice(before9b);
  log("gcr inbound calls during enable:\n" + json(enCalls.map((c) => ({ ...c, body: c.body ? { ...c.body, ...(c.body.app ? { app: `<manifest ${c.body.app.id}@${c.body.app.version}>` } : {}) } : null }))));
  const regOff = enCalls.find((c) => c.method === "POST" && c.path === "/api/nextgent/installs");
  const onPatch = enCalls.find((c) => c.method === "PATCH" && c.path === `/api/nextgent/installs/${faqInstallId}`);
  check("gcr got the registration as it was (POST …/installs with enabled:false and the manifest) then PATCH {enabled:true}", !!regOff && regOff.body?.enabled === false && regOff.body?.app?.id === "core-faq" && !!onPatch && onPatch.body?.enabled === true && Object.keys(onPatch.body).length === 1, { regOff, onPatch });
  t = await tables("entity_modules", "nextgent_installs");
  rowDump("gcr memdb: entity_modules (FAQ)", t.entity_modules.filter((r) => r.install_id === faqInstallId));
  const emFaq = rowFor(t.entity_modules, faqInstallId);
  check("entity_modules row for FAQ: enabled true after the PATCH, manifest core-faq, managed_by paperclip", emFaq?.enabled === true && emFaq?.settings?.manifest?.id === "core-faq" && emFaq?.managed_by === "paperclip", emFaq);
  const pub9 = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { show: ["installId", "appKey", "enabled", "publicEnabled", "position"] });
  check("public list now has both apps", pub9.body?.length === 2 && pub9.body.some((r) => r.installId === faqInstallId) && pub9.body.some((r) => r.installId === installId), pub9.body);
  finishStep(!failed, "disable: no route; disabled state proven via admin push enabled:false → enable pushes PATCH {enabled:true}");
  if (failed) return;

  // ── 10. records survive uninstall ─────────────────────────────────────
  section("Seed an app record with the install token, then uninstall → gcr row disabled and hidden but kept, app_records untouched");
  const faqTok = await call(PC, "POST", `/api/companies/${companyId}/installs/${faqInstallId}/token`, { show: ["expiresAt"] });
  check("FAQ install token issued", faqTok.status === 200 && typeof faqTok.body?.token === "string", faqTok.body);
  const faqAuth = { authorization: `Bearer ${faqTok.body?.token}` };
  const rec = await call(GCR, "POST", "/api/app-data/entries", { headers: faqAuth, body: { question: "Do you take cards?", answer: "Yes, all major cards.", sort_order: 1 } });
  check("record created through /api/app-data/entries (201)", rec.status === 201 && rec.body?.row?.question === "Do you take cards?", rec.body);
  const recId = rec.body?.row?.id;
  const readBack = await call(GCR, "GET", "/api/app-data/entries", { headers: faqAuth, show: ["table", "total"] });
  check("the install reads its own record back", readBack.status === 200 && readBack.body?.total === 1);
  const pubApp = await call(GCR, "GET", `/api/public/apps/${faqInstallId}`, { show: ["settings", "manifest"] });
  check("public /api/public/apps/:installId serves the record and now the manifest", pubApp.status === 200 && pubApp.body?.data?.entries?.length === 1 && pubApp.body?.manifest?.id === "core-faq", { data: pubApp.body?.data });
  t = await tables("app_records");
  rowDump("gcr memdb: app_records before uninstall", t.app_records);

  const before10 = (await gcrCalls()).length;
  const un = await call(PC, "DELETE", `/api/companies/${companyId}/store/${faqItemId}`);
  check("uninstall → 204", un.status === 204, un.body);
  const unCalls = (await gcrCalls()).slice(before10);
  log("gcr inbound calls during uninstall:\n" + json(unCalls));
  check("gcr received a signed DELETE /api/nextgent/installs/:id", unCalls.some((c) => c.method === "DELETE" && c.path === `/api/nextgent/installs/${faqInstallId}` && c.signed));
  t = await tables("entity_modules", "nextgent_installs", "app_records", "business_mcp_tokens");
  rowDump("gcr memdb: entity_modules (FAQ) after uninstall", t.entity_modules.filter((r) => r.install_id === faqInstallId));
  rowDump("gcr memdb: app_records after uninstall", t.app_records);
  const emGone = rowFor(t.entity_modules, faqInstallId);
  check("entity_modules row still present: enabled false, settings.showOnPublic false, manifest kept", !!emGone && emGone.enabled === false && emGone.settings?.showOnPublic === false && emGone.settings?.manifest?.id === "core-faq", emGone);
  check("app_records untouched (the seeded record is still there)", t.app_records.length === 1 && t.app_records[0].id === recId && t.app_records[0].install_id === faqInstallId);
  check("nextgent_installs row marked removed, install token revoked", t.nextgent_installs.find((r) => r.install_id === faqInstallId)?.status === "removed" && t.business_mcp_tokens.filter((r) => r.install_id === faqInstallId).every((r) => !!r.revoked_at));
  const pub10 = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { show: ["installId", "appKey"] });
  check("public list drops the uninstalled app (QR Menu remains)", pub10.body?.length === 1 && pub10.body[0].installId === installId, pub10.body);
  const ownerList10 = await call(GCR, "GET", "/api/owner/apps", { headers: auth, show: ["installId", "appKey", "enabled", "publicEnabled"] });
  check("owner list still lists the row, enabled false / publicEnabled false", ownerList10.body?.some((r) => r.installId === faqInstallId && r.enabled === false && r.publicEnabled === false), ownerList10.body);
  const deadTok = await call(GCR, "GET", "/api/app-install", { headers: faqAuth });
  check("the old install session token no longer works", deadTok.status === 404 || deadTok.status === 401, deadTok.body);
  const deadPc = await call(PC, "POST", `/api/companies/${companyId}/installs/${faqInstallId}/token`);
  check("Paperclip no longer issues a token for it (404)", deadPc.status === 404, deadPc.body);
  const pcInstalls2 = await (await fetch(`${PC}/__proof/installs`)).json();
  check("Paperclip store_installs row deleted", !pcInstalls2.some((i) => i.id === faqInstallId));

  // And the QR Menu install itself, the item the walk is about.
  const unQr = await call(PC, "DELETE", `/api/companies/${companyId}/store/${itemId}`);
  check("QR Menu uninstall → 204", unQr.status === 204, unQr.body);
  t = await tables("entity_modules", "app_records");
  rowDump("gcr memdb: entity_modules after both uninstalls", t.entity_modules);
  const emQr = rowFor(t.entity_modules, installId);
  check("QR Menu entity_modules row kept: enabled false, showOnPublic false, version 1.1.0 and the owner's render fields kept", !!emQr && emQr.enabled === false && emQr.settings?.showOnPublic === false && emQr.version === "1.1.0" && emQr.render_mode === "button", emQr);
  check("app_records still 1 (nothing deleted on either uninstall)", t.app_records.length === 1);
  const pubEnd = await call(GCR, "GET", `/api/public/business/${slug}/apps`);
  check("public list empty", Array.isArray(pubEnd.body) && pubEnd.body.length === 0);
  const listEnd = await call(PC, "GET", `/api/companies/${companyId}/store`);
  check("Paperclip listing: both items back to not installed (installId null)", listEnd.body?.filter((i) => [itemId, faqItemId].includes(i.id)).every((i) => i.installed === false && i.installId === null));
  finishStep(!failed);
}

main()
  .catch((err) => { log(`\n**Driver error:** ${err.stack || err}`); failed = failed || { step, label: "driver error", detail: String(err) }; })
  .finally(() => {
    log("\n## Summary\n");
    for (const r of results) log(`- Step ${r.step}: ${r.ok ? "PASS" : "FAIL"}${r.note ? ` — ${r.note}` : ""}`);
    if (failed) log(`\n**Stopped at step ${failed.step}: ${failed.label}**`);
    else log("\nAll steps passed.");
    writeFileSync(path.join(HERE, "transcript.md"), lines.join("\n") + "\n");
    console.log(`\ntranscript: ${path.join(HERE, "transcript.md")}`);
    process.exit(failed ? 1 : 0);
  });
