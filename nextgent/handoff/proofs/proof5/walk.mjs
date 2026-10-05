#!/usr/bin/env node
// PROOF DRIVER (proof5): walks Step 5 (apps in the store; DECISIONS #42–#68,
// review 11) over real HTTP between the two servers started by run.sh
// (Paperclip on PC_URL, gcr-api-clean on GCR_URL), asserting at each step and
// writing transcript.md next to this file. Stops at the first failing step.

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

/** One HTTP call, logged: method, URL, body, status, response. */
async function call(base, method, p, { body, headers = {}, actor, show, raw, quiet } = {}) {
  const url = `${base}${p}`;
  const init = { method, headers: { accept: "application/json", ...headers } };
  if (actor) init.headers["x-proof-actor"] = actor;
  if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = typeof body === "string" ? body : JSON.stringify(body); }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 400) }; }
  const who = base === PC ? `Paperclip${actor ? ` as ${actor}` : " as owner A"}` : "gcr-api-clean";
  const shownHeaders = Object.keys(headers).filter((h) => h !== "authorization");
  log(`\`${method} ${url.replace(PC, "{paperclip}").replace(GCR, "{gcr}")}\` (${who}${headers.authorization ? `, Bearer ${tokenKind(headers.authorization)}` : ""}${shownHeaders.length ? `, headers: ${shownHeaders.join(", ")}` : ""}) → **${res.status}**`);
  if (body !== undefined && !quiet) log("request body:\n" + json(summarizeBody(typeof body === "string" ? JSON.parse(body) : body)));
  if (show) log("response (selected):\n" + json(pick(parsed, show)));
  else if (quiet) log(`response: <${JSON.stringify(parsed).length} bytes>`);
  else if (raw || (parsed !== null && JSON.stringify(parsed).length <= 2500)) log("response:\n" + json(parsed));
  else log(`response: <${JSON.stringify(parsed).length} bytes, see assertions>`);
  return { status: res.status, body: parsed, text, headers: res.headers };
}
function tokenKind(auth) {
  const t = String(auth).replace(/^Bearer\s+/i, "");
  if (t.startsWith("gcr_mcp_ist.")) return "install session token (gcr_mcp_ist.…)";
  if (t.startsWith("gcr_mcp_")) return "business_mcp_token (gcr_mcp_…)";
  if (t.split(".").length === 3) return "JWT";
  return "token";
}
function summarizeBody(b) {
  if (b && typeof b === "object" && b.payload?.app) return { ...b, payload: { ...b.payload, app: `<manifest ${b.payload.app.id}@${b.payload.app.version}, ${JSON.stringify(b.payload.app).length} bytes>` } };
  if (b && typeof b === "object" && b.app?.id) return { ...b, app: `<manifest ${b.app.id}@${b.app.version}>` };
  return b;
}
function pick(obj, keys) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((o) => pick(o, keys));
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, k === "app" || k === "manifest" ? (obj[k] ? `<manifest ${obj[k].id}@${obj[k].version}>` : obj[k]) : obj[k]]));
}
async function tables(...names) { return (await fetch(`${GCR}/__proof/tables?names=${names.join(",")}`)).json(); }
async function gcrCalls() { return (await fetch(`${GCR}/__proof/calls`)).json(); }
async function gcrEvents() { return (await fetch(`${GCR}/__proof/events`)).json(); }
async function seed(table, row) { return (await fetch(`${GCR}/__proof/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, row }) })).json(); }
async function setRows(table, where, patch) { return (await fetch(`${GCR}/__proof/set`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, where, patch }) })).json(); }
function rowDump(title, rows) { log(`${title}:\n` + json(rows)); }
const manifestOf = (dir) => JSON.parse(readFileSync(path.join(APPS, dir, "manifest.json"), "utf8"));
const sameKeys = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).sort().join(",") === [...keys].sort().join(",");
const manifestSummary = (m) => {
  if (!m) return null;
  const bindings = Object.keys(m.bindings || {}).join("/") || "-";
  const events = (m.events?.emits || []).join("/") || "-";
  return "<manifest " + m.id + "@" + m.version + ", bindings " + bindings + ", events " + events + ">";
};
const moduleSummary = (r) => ({ id: r.id, install_id: r.install_id, entity_slug: r.entity_slug, module_key: r.module_key, enabled: r.enabled, version: r.version, managed_by: r.managed_by, manifest: manifestSummary(r.settings?.manifest), showOnPublic: r.settings?.showOnPublic });
/** JSON with object keys sorted, so a value that went through jsonb (which reorders keys) compares equal to the file. */
const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const byInstall = (rows, id) => rows.find((r) => r.install_id === id);

/** A JSON-RPC call to gcr's business MCP (POST /api/mcp), as an MCP host would make it. */
let rpcId = 0;
async function mcp(token, method, params, { quiet } = {}) {
  const r = await call(GCR, "POST", "/api/mcp", { headers: { authorization: `Bearer ${token}` }, body: { jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }, quiet: quiet ?? true });
  return r.body;
}
const toolNames = (reply) => (reply?.result?.tools || []).map((t) => t.name);

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

/** Publish an engine manifest through Paperclip's admin API (toStorePublication's two calls, then publish). */
async function publish(manifest, label) {
  const pub = toStorePublication(manifest, { channel: "stable", changelog: "First release" });
  check(`${label}: engine toStorePublication accepts the manifest (validateManifest)`, pub.ok === true, pub.errors);
  if (!pub.ok) return null;
  const item = await call(PC, "POST", "/api/store/admin/items", { body: pub.item, actor: "admin", show: ["id", "key", "kind", "status"] });
  const itemId = item.body?.id;
  const v1 = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: pub.version, actor: "admin", show: ["appliedTo", "pendingFor", "needsApprovalFor"] });
  const published = await call(PC, "POST", `/api/store/admin/items/${itemId}/publish`, { actor: "admin", show: ["status"] });
  check(`${label}: item created, release ${manifest.version} passed the gate (201), published`, item.status === 201 && v1.status === 201 && published.body?.status === "published", { item: item.body, v1: v1.body, published: published.body });
  return { itemId, key: manifest.id, pub };
}

async function main() {
  log("# Proof 5: Step 5, apps in the store, over real HTTP (Paperclip ⇄ gcr-api-clean)\n");
  log(`Run at ${new Date().toISOString()}.`);
  log(`\nPaperclip at \`${PC}\` (real routes/store.ts + routes/nextgent.ts on embedded Postgres with all migrations), gcr-api-clean at \`${GCR}\` (real routes/nextgent.js, business-data.js, app-data.js, owner.js, mcp.js, platform.js, gcr.js on scripts/lib/memdb.js with a stubbed PostgREST schema document). Shared NEXTGENT_SERVICE_SECRET. Read-only on all three repos; the manifests are the shipped \`App-build-/apps/*/manifest.json\`, loaded with the engine's \`toStorePublication\`.\n`);
  log("Repo state at run time:\n```\n" + git("/home/user/paperclip") + "\n---\n" + git("/home/user/gcr-api-clean") + "\n---\n" + git("/home/user/App-build-") + "\n```");

  const ready = await waitReady();
  const { companyId } = ready;
  log(`\nPaperclip company A: \`${companyId}\` (owner \`${ready.ownerUserId}\`), created by direct insert into companies + an owner membership.`);

  // ── 1. link, seed, publish, install ───────────────────────────────────
  section("Link the company, seed the business, publish the six shipped apps through the gate, install them (DECISIONS #42, #44–#47, #55, #61)");
  const link = await call(PC, "POST", `/api/companies/${companyId}/business-link`, { body: { create: { name: "Proof Diner", kind: "restaurant" } } });
  check("link answered 201 with the slug gcr-api-clean created", link.status === 201 && typeof link.body?.entitySlug === "string", link.body);
  const slug = link.body?.entitySlug;
  const linkTok = await (await fetch(`${GCR}/__proof/link-token`)).json();
  check("gcr handed Paperclip a company-level business_mcp_token with the link (captured from the response; Paperclip stores it sealed)", typeof linkTok.token === "string" && linkTok.token.startsWith("gcr_mcp_") && linkTok.entitySlug === slug, { ...linkTok, token: linkTok.token ? linkTok.token.slice(0, 12) + "…" : null });
  const companyToken = linkTok.token;

  // The business's own facts, where they live: the entity row and its tables.
  const ent = await setRows("entity", { slug }, { social_instagram: "https://instagram.com/proofdiner", website_url: "https://proofdiner.example", currency: "GBP", is_active: true, timezone: "UTC" });
  rowDump(`gcr memdb: entity '${slug}' after seeding social_instagram, website_url, currency (is_active true: listed on GCR)`, ent.rows);
  const secStarters = await seed("menu_sections", { id: "sec-starters", entity_slug: slug, section_name: "Starters", sort_order: 1 });
  const secMains = await seed("menu_sections", { id: "sec-mains", entity_slug: slug, section_name: "Mains", sort_order: 2 });
  // Inserted out of order on purpose: the read must come back by sort_order.
  await seed("menu_items", { id: "item-c", entity_slug: slug, item_name: "Gumbo", description: "Dark roux, andouille", price: 14.5, section_id: "sec-mains", is_available: true, sort_order: 3 });
  await seed("menu_items", { id: "item-a", entity_slug: slug, item_name: "Boiled Peanuts", description: "Cajun", price: 4, section_id: "sec-starters", is_available: true, sort_order: 1 });
  await seed("menu_items", { id: "item-b", entity_slug: slug, item_name: "Hush Puppies", description: null, price: 6, section_id: "sec-starters", is_available: false, sort_order: 2 });
  await seed("entity_photos", { id: "photo-1", entity_slug: slug, url: "https://img.example/room.jpg", caption: "The room", is_cover: true, sort_order: 0 });
  await seed("entity_photos", { id: "photo-2", entity_slug: slug, url: "https://img.example/plate.jpg", caption: "Gumbo night", is_cover: false, sort_order: 1 });
  await seed("faqs", { id: "faq-1", entity_slug: slug, question: "Do you take bookings?", answer: "Walk-ins only.", sort_order: 0 });
  await seed("faqs", { id: "faq-2", entity_slug: slug, question: "Is there parking?", answer: "Behind the building.", sort_order: 1 });
  log("Seeded (memdb, as the business's own tables): 2 menu_sections, 3 menu_items (inserted 3,1,2 by sort_order), 2 entity_photos, 2 faqs.");

  const APP_DIRS = { "core-faq": "faq", "core-gallery": "gallery", "core-enquiry-form": "enquiry-form", "core-social-links": "social-links", "core-qr-menu": "qr-menu", "core-song-requests": "song-requests" };
  const items = {};
  for (const [key, dir] of Object.entries(APP_DIRS)) {
    const m = manifestOf(dir);
    log(`\n### ${m.name} (\`${key}\`): permissions ${JSON.stringify((m.permissions || []).map((p) => p.id))}, bindings ${JSON.stringify(Object.fromEntries(Object.entries(m.bindings || {}).map(([k, b]) => [k, `${b.contract} ${b.access}${b.inbox ? " inbox" : ""}`])))}, events ${JSON.stringify(m.events?.emits || [])}, tables ${JSON.stringify(Object.keys(m.data?.tables || {}))}`);
    const out = await publish(m, m.name);
    if (!out) break;
    items[key] = out;
  }
  if (failed) { finishStep(false); return; }

  // The owner installs each one, consenting to everything the release asks for.
  const installs = {};
  for (const [key, it] of Object.entries(items)) {
    const inst = await call(PC, "POST", `/api/companies/${companyId}/store/${it.itemId}/install`, { body: {}, show: ["id", "enabled", "approvedPermissions", "tokenSecretId"] });
    check(`${key}: owner install → 201/200, enabled, approvedPermissions = the manifest's permissions`, [200, 201].includes(inst.status) && inst.body?.enabled === true && JSON.stringify([...(inst.body?.approvedPermissions || [])].sort()) === JSON.stringify(manifestOf(APP_DIRS[key]).permissions.map((p) => p.id).sort()), inst.body);
    installs[key] = inst.body?.id;
  }
  let t = await tables("nextgent_installs", "entity_modules", "business_mcp_tokens");
  rowDump("gcr memdb: nextgent_installs", t.nextgent_installs.map((r) => ({ install_id: r.install_id, entity_slug: r.entity_slug, item_key: r.item_key, kind: r.kind, version: r.version, permissions: r.permissions, status: r.status })));
  rowDump("gcr memdb: entity_modules (Paperclip's rows, manifests summarised)", t.entity_modules.filter((r) => r.managed_by === "paperclip").map(moduleSummary));
  const postCalls = (await gcrCalls()).filter((c) => c.method === "POST" && c.path === "/api/nextgent/installs");
  check("gcr saw six signed POST /api/nextgent/installs, each carrying the whole manifest (app.bindings present)", postCalls.length === 6 && postCalls.every((c) => c.signed && c.body?.app?.bindings !== undefined || (c.body?.app?.id === "core-song-requests" && c.body?.app?.data?.tables)), postCalls.map((c) => ({ signed: c.signed, itemKey: c.body?.itemKey, permissions: c.body?.permissions, hasApp: !!c.body?.app, bindings: Object.keys(c.body?.app?.bindings || {}) })));
  check("six nextgent_installs rows for the slug, all active, kind app, with the approved permissions", Object.values(installs).every((id) => { const r = byInstall(t.nextgent_installs, id); return r && r.entity_slug === slug && r.status === "active" && r.kind === "app"; }) && t.nextgent_installs.length === 6);
  check("six entity_modules rows managed_by paperclip for the slug, enabled, settings.manifest = the shipped manifest (id, bindings, events kept whole)", Object.entries(installs).every(([key, id]) => { const r = byInstall(t.entity_modules, id); const m = manifestOf(APP_DIRS[key]); return r && r.managed_by === "paperclip" && r.entity_slug === slug && r.enabled === true && r.module_key === key && canonical(r.settings?.manifest) === canonical(m); }), t.entity_modules.filter((r) => r.managed_by === "paperclip").map((r) => [r.module_key, r.settings?.manifest?.id]));
  check("the legacy row on another business is untouched", t.entity_modules.some((r) => r.id === "legacy-1" && r.managed_by === undefined && r.enabled === true));
  check("one business_mcp_tokens row per install (hash only, install_id, permissions) plus the company-level one", t.business_mcp_tokens.filter((r) => r.install_id).length === 6 && t.business_mcp_tokens.every((r) => !r.token && r.token_hash) && t.business_mcp_tokens.some((r) => !r.install_id && r.company_id === companyId), t.business_mcp_tokens.map((r) => ({ install_id: r.install_id, company_id: r.company_id, permissions: r.permissions, scope: r.scope, hasHash: !!r.token_hash, hasToken: !!r.token })));
  finishStep(!failed);
  if (failed) return;

  // ── 2. store listing ──────────────────────────────────────────────────
  section("Store listing for the company: item.app carries bindings; needsAccessTo lists the derived permissions, contacts:* for Enquiry Form (DECISIONS #59)");
  const listing = await call(PC, "GET", `/api/companies/${companyId}/store`, { quiet: true });
  check("listing 200 with the six apps installed", listing.status === 200 && Array.isArray(listing.body) && Object.keys(items).every((key) => listing.body.find((i) => i.key === key)?.installed === true), listing.body?.map?.((i) => [i.key, i.installed]));
  for (const [key, dir] of Object.entries(APP_DIRS)) {
    const row = listing.body.find((i) => i.key === key);
    const m = manifestOf(dir);
    log(`\n${key}: needsAccessTo ${JSON.stringify((row?.needsAccessTo || []).map((p) => `${p.permission}${p.optional ? " (optional)" : ""}${p.changesThings ? " [changes things]" : ""}`))}; app.bindings ${JSON.stringify(row?.app?.bindings ?? null)}; installId ${row?.installId}`);
    check(`${key}: item.app is the manifest with bindings as shipped`, canonical(row?.app?.bindings ?? null) === canonical(m.bindings ?? null) && row?.app?.id === key, row?.app?.bindings);
    check(`${key}: needsAccessTo = the manifest's permissions with resource/action split and reasons`, JSON.stringify((row?.needsAccessTo || []).map((p) => [p.permission, p.resource, p.action, p.reason, p.optional])) === JSON.stringify(m.permissions.map((p) => [p.id, p.id.split(":")[0], p.id.split(":")[1], p.reason, p.optional === true])), row?.needsAccessTo);
  }
  const enquiryRow = listing.body.find((i) => i.key === "core-enquiry-form");
  check("Enquiry Form needsAccessTo includes contacts:read and contacts:write (resource contacts), write flagged as changing things", enquiryRow?.needsAccessTo?.some((p) => p.permission === "contacts:read" && p.resource === "contacts" && !p.changesThings) && enquiryRow?.needsAccessTo?.some((p) => p.permission === "contacts:write" && p.resource === "contacts" && p.changesThings), enquiryRow?.needsAccessTo);
  check("listing installIds match the install rows gcr holds", Object.entries(installs).every(([key, id]) => listing.body.find((i) => i.key === key)?.installId === id));
  finishStep(!failed);
  if (failed) return;

  // ── 3. install tokens → business data by contract ─────────────────────
  section("Each install's short-lived token reaches its bound business data through gcr /api/business/<contract> (DECISIONS #45, #56, #57, #59, #63, #65)");
  const tokens = {};
  for (const [key, id] of Object.entries(installs)) {
    const tk = await call(PC, "POST", `/api/companies/${companyId}/installs/${id}/token`, { show: ["expiresAt"] });
    check(`${key}: Paperclip issues a short-lived install token (gcr_mcp_ist.…) via gcr POST /api/nextgent/installs/:id/session`, tk.status === 200 && String(tk.body?.token).startsWith("gcr_mcp_ist.") && typeof tk.body?.expiresAt === "string", tk.body && { expiresAt: tk.body.expiresAt });
    tokens[key] = tk.body?.token;
  }
  const auth = (key) => ({ authorization: `Bearer ${tokens[key]}` });

  log("\n### FAQ → faqs.items (bound; no app table)");
  const faqRead = await call(GCR, "GET", "/api/business/faqs.items", { headers: auth("core-faq") });
  check("FAQ token reads faqs.items: 200, table faqs, contract faqs.items, the two seeded rows", faqRead.status === 200 && faqRead.body?.table === "faqs" && faqRead.body?.contract === "faqs.items" && faqRead.body?.rows?.length === 2 && faqRead.body.rows.every((r) => r.entity_slug === slug), faqRead.body);
  const faqMade = await call(GCR, "POST", "/api/business/faqs.items", { headers: auth("core-faq"), body: { question: "Do you do takeaway?", answer: "Yes, call ahead.", entity_slug: "someone-else" } });
  check("FAQ token creates a faqs row: 201, entity_slug is the install's business (the body's slug was dropped)", faqMade.status === 201 && faqMade.body?.row?.entity_slug === slug && faqMade.body?.row?.question === "Do you do takeaway?", faqMade.body);
  t = await tables("faqs", "app_records");
  check("faqs now has 3 rows for the slug; app_records has none (business data, not app records)", t.faqs.filter((r) => r.entity_slug === slug).length === 3 && t.app_records.length === 0, { faqs: t.faqs.length, app_records: t.app_records.length });

  log("\n### Gallery → media.images (entity_photos)");
  const gal = await call(GCR, "GET", "/api/business/media.images", { headers: auth("core-gallery") });
  check("Gallery token reads media.images: 200, table entity_photos, the two photos with url/caption/is_cover", gal.status === 200 && gal.body?.table === "entity_photos" && gal.body?.rows?.length === 2 && gal.body.rows.every((r) => typeof r.url === "string" && "caption" in r), gal.body);

  log("\n### QR Menu → menu.sections, menu.items (ordered by sort_order), business.currency → { value }");
  const secs = await call(GCR, "GET", "/api/business/menu.sections", { headers: auth("core-qr-menu") });
  check("menu.sections: 200, table menu_sections, two sections", secs.status === 200 && secs.body?.table === "menu_sections" && secs.body?.rows?.length === 2, secs.body);
  const menu = await call(GCR, "GET", "/api/business/menu.items", { headers: auth("core-qr-menu") });
  check("menu.items: 200, table menu_items, three items in sort_order (1,2,3) although inserted 3,1,2", menu.status === 200 && menu.body?.table === "menu_items" && JSON.stringify(menu.body?.rows?.map((r) => r.sort_order)) === "[1,2,3]" && menu.body.rows[0].item_name === "Boiled Peanuts", menu.body?.rows?.map((r) => [r.item_name, r.sort_order]));
  check("menu.items rows carry is_available and section_id", menu.body?.rows?.every((r) => "is_available" in r && "section_id" in r));
  const cur = await call(GCR, "GET", "/api/business/business.currency", { headers: auth("core-qr-menu") });
  check("business.currency: 200 → { table entity, contract business.currency, value 'GBP' } (a scalar contract, DECISIONS #56)", cur.status === 200 && cur.body?.value === "GBP" && cur.body?.contract === "business.currency" && !("rows" in cur.body), cur.body);
  const curWrite = await call(GCR, "POST", "/api/business/business.currency", { headers: auth("core-qr-menu"), body: { currency: "EUR" } });
  check("business.currency is read-only through the contract: a write is refused (403)", curWrite.status === 403, curWrite.body);

  log("\n### Social Links → business.links as rows { id, network, url }; a PATCH changes the entity column (DECISIONS #63, #67)");
  const links = await call(GCR, "GET", "/api/business/business.links", { headers: auth("core-social-links") });
  check("business.links: 200, rows derived from the entity's set link columns: instagram and website, each { id, network, url }", links.status === 200 && links.body?.table === "entity" && links.body?.rows?.length === 2 && links.body.rows.every((r) => sameKeys(r, ["id", "network", "url"]) && r.id === r.network) && links.body.rows.some((r) => r.network === "instagram" && r.url === "https://instagram.com/proofdiner") && links.body.rows.some((r) => r.network === "website" && r.url === "https://proofdiner.example"), links.body);
  const patched = await call(GCR, "PATCH", "/api/business/business.links/instagram", { headers: auth("core-social-links"), body: { url: "https://instagram.com/proofdiner.official" } });
  check("PATCH business.links/instagram { url } → 200 with the row", patched.status === 200 && patched.body?.row?.network === "instagram" && patched.body?.row?.url === "https://instagram.com/proofdiner.official", patched.body);
  t = await tables("entity");
  const entRow = t.entity.find((e) => e.slug === slug);
  check("entity.social_instagram is the new url; website_url and the rest unchanged", entRow?.social_instagram === "https://instagram.com/proofdiner.official" && entRow?.website_url === "https://proofdiner.example" && entRow?.currency === "GBP", { social_instagram: entRow?.social_instagram, website_url: entRow?.website_url, currency: entRow?.currency });
  const badLink = await call(GCR, "PATCH", "/api/business/business.links/slug", { headers: auth("core-social-links"), body: { url: "https://evil.example" } });
  check("a row id that names a non-link column (slug) → 404: a pivot row can never reach another column", badLink.status === 404 && entRow?.slug === slug, badLink.body);

  log("\n### Enquiry Form → leads.items with contacts:write; a token without contacts is refused (DECISIONS #59)");
  const lead = await call(GCR, "POST", "/api/business/leads.items", { headers: auth("core-enquiry-form"), body: { name: "Pat Lee", email: "pat@example.com", phone: "+15550100200", message: "Private room for 12?" } });
  check("Enquiry Form token POSTs leads.items → 201, table entity_leads, row for the slug", lead.status === 201 && lead.body?.table === "entity_leads" && lead.body?.contract === "leads.items" && lead.body?.row?.entity_slug === slug && lead.body.row.email === "pat@example.com", lead.body);
  const leadRead = await call(GCR, "GET", "/api/business/leads.items", { headers: auth("core-enquiry-form") });
  check("Enquiry Form token reads leads.items (contacts:read) → the one lead", leadRead.status === 200 && leadRead.body?.rows?.length === 1, leadRead.body);
  const noLeads = await call(GCR, "GET", "/api/business/leads.items", { headers: auth("core-gallery") });
  check("Gallery's token (business:read/write, no contacts) on leads.items → 403", noLeads.status === 403, noLeads.body);
  const noRaw = await call(GCR, "GET", "/api/business/entity_leads", { headers: auth("core-gallery") });
  check("Gallery's token on the raw table entity_leads → 403 (the table resolves to contacts through the registry, never business)", noRaw.status === 403, noRaw.body);
  const noRawWrite = await call(GCR, "POST", "/api/business/entity_leads", { headers: auth("core-gallery"), body: { name: "x", email: "x@example.com" } });
  check("Gallery's token writing entity_leads → 403", noRawWrite.status === 403, noRawWrite.body);
  const noCustomers = await call(GCR, "GET", "/api/business/customers.items", { headers: auth("core-qr-menu") });
  check("QR Menu's token (menu, business:read) on customers.items → 403", noCustomers.status === 403, noCustomers.body);
  const crossFaq = await call(GCR, "GET", "/api/business/faqs.items", { headers: auth("core-enquiry-form") });
  check("Enquiry Form's token (contacts only) on faqs.items → 403: contacts does not imply business", crossFaq.status === 403, crossFaq.body);
  t = await tables("entity_leads");
  check("entity_leads holds exactly one row, for the slug", t.entity_leads.length === 1 && t.entity_leads[0].entity_slug === slug);
  finishStep(!failed);
  if (failed) return;

  // ── 4. public submissions ─────────────────────────────────────────────
  section("Public: a visitor's submission into the bound leads source and into the Song Requests app table; the Messages inbox; the declared events (DECISIONS #48, #55, #57, #60, #61)");
  const beforeEvents = (await gcrEvents()).length;
  const enquiryInstall = installs["core-enquiry-form"];
  const pub = await call(GCR, "GET", `/api/public/apps/${enquiryInstall}`, { quiet: true });
  check("GET /api/public/apps/<enquiry install> → 200 with the manifest and public settings; no lead data on the public page (leads.items is a table of people)", pub.status === 200 && pub.body?.manifest?.id === "core-enquiry-form" && pub.body?.settings?.accepting === true && !("enquiries" in (pub.body?.data || {})), { settings: pub.body?.settings, dataKeys: Object.keys(pub.body?.data || {}) });
  const sub = await call(GCR, "POST", `/api/public/apps/${enquiryInstall}/enquiries`, { body: { name: "Visitor Vee", email: "vee@example.com", message: "Do you cater weddings?", status: "won", entity_slug: "someone-else" } });
  check("POST /api/public/apps/<enquiry install>/enquiries (the source key, resolved through the manifest's binding) → 201 with a receipt { id, created_at } only", sub.status === 201 && sub.body?.table === "enquiries" && sameKeys(sub.body?.row, ["id", "created_at"]), sub.body);
  t = await tables("entity_leads", "business_messages", "message_threads", "app_records");
  const visitorLead = t.entity_leads.find((r) => r.email === "vee@example.com");
  rowDump("gcr memdb: entity_leads", t.entity_leads);
  check("entity_leads has the visitor's row for the slug; the owner-only 'status' and the body's slug were dropped", !!visitorLead && visitorLead.entity_slug === slug && visitorLead.status !== "won" && visitorLead.message === "Do you cater weddings?" && t.entity_leads.length === 2, visitorLead);
  rowDump("gcr memdb: message_threads", t.message_threads);
  rowDump("gcr memdb: business_messages", t.business_messages);
  const inboxMsg = t.business_messages.find((m) => m.install_id === enquiryInstall);
  check("one business_messages row: channel app, direction in, install_id = the enquiry install, customer_address = the visitor's email, body carries the message", !!inboxMsg && inboxMsg.channel === "app" && inboxMsg.direction === "in" && inboxMsg.customer_address === "vee@example.com" && inboxMsg.entity_slug === slug && String(inboxMsg.body).includes("Do you cater weddings?") && t.business_messages.length === 1, inboxMsg);
  const thread = t.message_threads.find((th) => th.id === inboxMsg?.thread_id);
  check("its message_threads row: channel app, the slug, customer_address = the visitor's email", !!thread && thread.channel === "app" && thread.entity_slug === slug && thread.customer_address === "vee@example.com", thread);
  // The owner's inbox, with the business token Paperclip issues for the company.
  const bt = await call(PC, "POST", `/api/companies/${companyId}/business-token`, { show: ["expiresAt"] });
  check("Paperclip business token (JWT) issued for company A", bt.status === 200 && String(bt.body?.token).split(".").length === 3, bt.body && { expiresAt: bt.body.expiresAt });
  const ownerAuth = { authorization: `Bearer ${bt.body?.token}` };
  const threads = await call(GCR, "GET", "/api/owner/messages/threads", { headers: ownerAuth });
  const appThread = threads.body?.threads?.find((th) => th.channel === "app");
  check("GET /api/owner/messages/threads shows the thread: channel app, contact = the email, unread 1, source { installId, appKey: core-enquiry-form }", threads.status === 200 && !!appThread && appThread.contact === "vee@example.com" && appThread.unread === 1 && appThread.source?.installId === enquiryInstall && appThread.source?.appKey === "core-enquiry-form", threads.body);
  const detail = await call(GCR, "GET", `/api/owner/messages/threads/${appThread?.id}`, { headers: ownerAuth });
  check("thread detail: one inbound message with the submission body, source on the thread", detail.status === 200 && detail.body?.messages?.length === 1 && detail.body.messages[0].direction === "in" && detail.body.thread?.source?.appKey === "core-enquiry-form", detail.body);
  let ev = (await gcrEvents()).slice(beforeEvents);
  log("gcr automation events emitted during the submission (lib/automationEngine.emitEvent, wrapped):\n" + json(ev));
  const enqEv = ev.find((e) => e.event === "core-enquiry-form.submitted");
  check("the declared event core-enquiry-form.submitted was emitted for the slug with { app, installId, table: enquiries, record, source: visitor }, exactly once", ev.length === 1 && !!enqEv && enqEv.slug === slug && enqEv.payload?.app === "core-enquiry-form" && enqEv.payload?.installId === enquiryInstall && enqEv.payload?.table === "enquiries" && enqEv.payload?.source === "visitor" && enqEv.payload?.record?.email === "vee@example.com", ev);
  check("the event payload's record carries no owner-only status value from the visitor", enqEv?.payload?.record?.status !== "won");
  const known = await (await fetch(`${GCR}/__proof/known-events?slug=${slug}`)).json();
  const knownNames = known.map((k) => (typeof k === "string" ? k : k.name));
  log(`knownEvents(${slug}) (lib/automationEngine.knownEvents = platform EVENTS + appEventsFor): ${JSON.stringify(knownNames)}`);
  check("knownEvents for the business includes core-enquiry-form.submitted and core-song-requests.submitted (the installed manifests are the registry)", knownNames.includes("core-enquiry-form.submitted") && knownNames.includes("core-song-requests.submitted") && knownNames.includes("booking.created"), knownNames);

  log("\n### Song Requests → its own app table (public append, inbox default on)");
  const songInstall = installs["core-song-requests"];
  const beforeEvents2 = (await gcrEvents()).length;
  const song = await call(GCR, "POST", `/api/public/apps/${songInstall}/requests`, { body: { song: "Blue Monday", artist: "New Order", from_name: "Sam", status: "played" } });
  check("POST /api/public/apps/<song install>/requests → 201 receipt", song.status === 201 && song.body?.table === "requests" && sameKeys(song.body?.row, ["id", "created_at"]), song.body);
  t = await tables("app_records", "business_messages", "message_threads");
  const rec = t.app_records.find((r) => r.install_id === songInstall);
  rowDump("gcr memdb: app_records", t.app_records);
  check("app_records has the request: install_id, entity_slug, app_table requests, source visitor; owner-only status dropped (default pending)", !!rec && rec.entity_slug === slug && rec.app_table === "requests" && rec.source === "visitor" && rec.data?.song === "Blue Monday" && rec.data?.status !== "played" && t.app_records.length === 1, rec);
  const songMsg = t.business_messages.find((m) => m.install_id === songInstall);
  check("a second business_messages row: channel app, install_id = the song install, customer_address falls back to the first text field (the song) since there is no email/phone", !!songMsg && songMsg.channel === "app" && songMsg.customer_address === "Blue Monday" && String(songMsg.body).includes("Blue Monday") && t.business_messages.length === 2, songMsg);
  const threads2 = await call(GCR, "GET", "/api/owner/messages/threads", { headers: ownerAuth, quiet: true });
  const songThread = threads2.body?.threads?.find((th) => th.source?.appKey === "core-song-requests");
  check("the owner's threads now show a second app thread with source.appKey core-song-requests", !!songThread && songThread.channel === "app", threads2.body?.threads?.map((th) => [th.channel, th.contact, th.source]));
  ev = (await gcrEvents()).slice(beforeEvents2);
  log("gcr automation events emitted during the song request:\n" + json(ev));
  check("core-song-requests.submitted emitted once for the slug with table requests, source visitor, the record", ev.length === 1 && ev[0].event === "core-song-requests.submitted" && ev[0].slug === slug && ev[0].payload?.table === "requests" && ev[0].payload?.source === "visitor" && ev[0].payload?.record?.song === "Blue Monday", ev);
  const closed = await setRows("entity_modules", { install_id: songInstall }, {});
  void closed;
  const noApp = await call(GCR, "POST", `/api/public/apps/${songInstall}/nothing`, { body: { x: 1 } });
  check("a source key the manifest does not declare → 404", noApp.status === 404, noApp.body);
  const noSubmitFaq = await call(GCR, "POST", `/api/public/apps/${installs["core-faq"]}/entries`, { body: { question: "spam?", answer: "spam" } });
  check("a visitor cannot submit into FAQ's entries (bound read-write but the binding is not a public form and inbox is not set): 404 — not a public submission", noSubmitFaq.status === 404 || noSubmitFaq.status === 403, noSubmitFaq.body);
  finishStep(!failed);
  if (failed) return;

  // ── 5. agent face ─────────────────────────────────────────────────────
  section("Agent face (DECISIONS #46): the business MCP lists installed apps' declared actions as app_<key>_<action> tools under the install's permissions");
  log("None of the six shipped manifests declares `actions` (checked: apps/*/manifest.json). To exercise the agent face this step publishes a proof-only seventh app, `proof-agent-faq`: the shipped FAQ manifest with its id/name/publisher changed and three actions added (list_faqs read, add_faq create, edit_faq update, all through the `faqs` binding). It goes through the same engine validator and the same Paperclip gate.");
  const agentManifest = { ...manifestOf("faq"), id: "proof-agent-faq", name: "Agent FAQ (proof)", publisher: "proof", actions: [
    { id: "list_faqs", summary: "List the business's questions and answers.", kind: "read", binding: "faqs" },
    { id: "add_faq", summary: "Add a question and its answer to the FAQ.", kind: "create", binding: "faqs" },
    { id: "edit_faq", summary: "Change the wording of one question or answer.", kind: "update", binding: "faqs" },
  ] };
  const agentItem = await publish(agentManifest, "Agent FAQ (proof)");
  if (!agentItem) { finishStep(false); return; }
  const agentInst = await call(PC, "POST", `/api/companies/${companyId}/store/${agentItem.itemId}/install`, { body: {}, show: ["id", "enabled", "approvedPermissions"] });
  check("proof app installed with business:read, business:write", [200, 201].includes(agentInst.status) && agentInst.body?.enabled === true, agentInst.body);
  const agentInstallId = agentInst.body?.id;
  t = await tables("entity_modules");
  check("its entity_modules row carries the manifest with actions", byInstall(t.entity_modules, agentInstallId)?.settings?.manifest?.actions?.length === 3);

  log("\n### With the company's business_mcp_token (from the link: every resource, read and write)");
  const init = await mcp(companyToken, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "proof", version: "5" } });
  check("initialize → serverInfo and instructions", !!init?.result?.serverInfo && typeof init.result.instructions === "string", init);
  const list = await mcp(companyToken, "tools/list");
  const names = toolNames(list);
  log(`tools/list → ${JSON.stringify(names)}`);
  const appTools = names.filter((n) => n.startsWith("app_"));
  check("tools/list includes app_proof-agent-faq_list_faqs, _add_faq, _edit_faq beside the seven generic tools", ["app_proof-agent-faq_list_faqs", "app_proof-agent-faq_add_faq", "app_proof-agent-faq_edit_faq"].every((n) => names.includes(n)) && ["whoami", "list_sections", "read_section", "create_row"].every((n) => names.includes(n)), names);
  check("no app tools for the six shipped apps (they declare no actions)", appTools.every((n) => n.startsWith("app_proof-agent-faq_")), appTools);
  const listTool = list.result.tools.find((tl) => tl.name === "app_proof-agent-faq_list_faqs");
  check("the read tool is annotated readOnlyHint and titled with the app's name", listTool?.annotations?.readOnlyHint === true && /Agent FAQ/.test(listTool?.title || ""), listTool);
  const read = await mcp(companyToken, "tools/call", { name: "app_proof-agent-faq_list_faqs", arguments: {} }, { quiet: false });
  const readSc = read?.result?.structuredContent;
  check("tools/call list_faqs → the faqs rows through the contract (section faqs, contract faqs.items), 3 rows, app and action named", !read?.result?.isError && readSc?.app === "proof-agent-faq" && readSc?.action === "list_faqs" && readSc?.contract === "faqs.items" && Array.isArray(readSc?.rows) && readSc.rows.length === 3, readSc);
  const create = await mcp(companyToken, "tools/call", { name: "app_proof-agent-faq_add_faq", arguments: { values: { question: "Dogs?", answer: "On the patio, yes.", entity_slug: "someone-else" } } }, { quiet: false });
  const createSc = create?.result?.structuredContent;
  check("tools/call add_faq → a faqs row created for the business (the slug in values was dropped)", !create?.result?.isError && createSc?.created?.question === "Dogs?" && createSc?.created?.entity_slug === slug, create);
  t = await tables("faqs");
  check("faqs has 4 rows for the slug, none for anyone else", t.faqs.filter((r) => r.entity_slug === slug).length === 4 && t.faqs.length === 4);

  log("\n### With QR Menu's install token (menu:read, menu:write, business:read — no business:write)");
  const listQr = await mcp(tokens["core-qr-menu"], "tools/list");
  const qrNames = toolNames(listQr);
  log(`tools/list → ${JSON.stringify(qrNames)}`);
  check("the read action is listed (business:read), the write actions are not (no business:write)", qrNames.includes("app_proof-agent-faq_list_faqs") && !qrNames.includes("app_proof-agent-faq_add_faq") && !qrNames.includes("app_proof-agent-faq_edit_faq"), qrNames);
  const denied = await mcp(tokens["core-qr-menu"], "tools/call", { name: "app_proof-agent-faq_add_faq", arguments: { values: { question: "x?", answer: "y" } } }, { quiet: false });
  check("calling add_faq with it → JSON-RPC error -32601 (no such tool for this caller)", denied?.error?.code === -32601, denied);
  const qrRead = await mcp(tokens["core-qr-menu"], "tools/call", { name: "app_proof-agent-faq_list_faqs", arguments: { limit: 2 } });
  check("calling list_faqs with it works (2 rows asked for)", !qrRead?.result?.isError && qrRead?.result?.structuredContent?.rows?.length === 2, qrRead);
  log("\n### With Enquiry Form's install token (contacts only)");
  const listEnq = await mcp(tokens["core-enquiry-form"], "tools/list");
  check("no app tools at all for a token holding neither business:read nor business:write", !toolNames(listEnq).some((n) => n.startsWith("app_")), toolNames(listEnq));
  t = await tables("faqs");
  check("faqs still has 4 rows (the denied call wrote nothing)", t.faqs.length === 4);
  finishStep(!failed);
  if (failed) return;

  // ── 6. legacy safety ──────────────────────────────────────────────────
  section("Legacy safety: a legacy dashboard save (POST /api/platform/state) that omits these apps leaves every Paperclip row intact; GET /api/gcr/entity/:slug lists them with managed_by");
  await seed("entity_owners", { user_id: "legacy-owner-1", entity_slug: slug, role: "owner" });
  const jwt = await (await fetch(`${GCR}/__proof/legacy-jwt?siteId=legacy-owner-1`)).json();
  const legacyAuth = { authorization: `Bearer ${jwt.token}` };
  log("The legacy dashboard signs in with an Express JWT (JWT_SECRET; middleware/auth.js authRequired); entity_owners maps its siteId to the slug.");
  const before = await tables("entity_modules", "entity");
  const pcRowsBefore = JSON.stringify(before.entity_modules.filter((r) => r.managed_by === "paperclip"));
  const st = await call(GCR, "GET", "/api/platform/state", { headers: legacyAuth });
  check("GET /api/platform/state: the legacy view sees none of Paperclip's installs (installed {} , page_order [])", st.status === 200 && Object.keys(st.body?.installed || {}).length === 0 && (st.body?.page_order || []).length === 0, st.body);
  const save = await call(GCR, "POST", "/api/platform/state", { headers: legacyAuth, body: { business: { name: "Proof Diner", tagline: "Gulf coast kitchen" }, installed: { menu: { enabled: true, manifest: { block: "menu", dataKey: "menu_items" }, config: { columns: 2 } } }, page_order: ["menu"] } });
  check("POST /api/platform/state → 200 { success, slug }", save.status === 200 && save.body?.success === true && save.body?.slug === slug, save.body);
  const after = await tables("entity_modules", "entity");
  const pcRowsAfter = JSON.stringify(after.entity_modules.filter((r) => r.managed_by === "paperclip"));
  rowDump("gcr memdb: entity_modules after the legacy save (summarised)", after.entity_modules.map((r) => ({ id: r.id, entity_slug: r.entity_slug, module_key: r.module_key, enabled: r.enabled, managed_by: r.managed_by ?? null, install_id: r.install_id ?? null, manifest: r.settings?.manifest?.id || r.settings?.manifest?.block || null })));
  check("all seven Paperclip rows are byte-for-byte unchanged (none deleted, disabled or rewritten)", pcRowsBefore === pcRowsAfter && after.entity_modules.filter((r) => r.managed_by === "paperclip").length === 7);
  check("the legacy save added its own 'menu' row for the slug (managed_by null) and left the other business's legacy row alone", after.entity_modules.some((r) => r.entity_slug === slug && r.module_key === "menu" && !r.managed_by && r.settings?.manifest?.block === "menu") && after.entity_modules.some((r) => r.id === "legacy-1" && r.enabled === true));
  const entAfter = after.entity.find((e) => e.slug === slug);
  check("the entity keeps its link columns and currency (the save sent none of them)", entAfter?.social_instagram === "https://instagram.com/proofdiner.official" && entAfter?.website_url === "https://proofdiner.example" && entAfter?.currency === "GBP" && entAfter?.subtitle === "Gulf coast kitchen", entAfter);
  const save2 = await call(GCR, "POST", "/api/platform/state", { headers: legacyAuth, body: { business: { name: "Proof Diner" }, installed: {}, page_order: [] } });
  const after2 = await tables("entity_modules");
  check("a second save with installed {} deletes the legacy 'menu' row (its own) and still none of Paperclip's", save2.status === 200 && !after2.entity_modules.some((r) => r.entity_slug === slug && r.module_key === "menu" && !r.managed_by) && JSON.stringify(after2.entity_modules.filter((r) => r.managed_by === "paperclip")) === pcRowsBefore);
  const full = await call(GCR, "GET", `/api/gcr/entity/${slug}`, { quiet: true });
  const mods = full.body?.modules || [];
  log("GET /api/gcr/entity/:slug modules[]:\n" + json(mods.map((m) => ({ module_key: m.module_key, enabled: m.enabled, managed_by: m.managed_by, install_id: m.install_id, version: m.version, render_mode: m.render_mode }))));
  check("modules[] lists the seven Paperclip rows with managed_by 'paperclip', install_id and version", full.status === 200 && mods.filter((m) => m.managed_by === "paperclip").length === 7 && mods.filter((m) => m.managed_by === "paperclip").every((m) => m.install_id && m.version === "1.0.0"), mods);
  check("the public entity carries the three FAQ rows the apps wrote beside the seeded ones (faqs is the one FAQ table)", Array.isArray(full.body?.faqs) && full.body.faqs.length === 4, full.body?.faqs);
  const publicApps = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { quiet: true });
  check("GET /api/public/business/:slug/apps lists the seven enabled public apps with their manifests", publicApps.status === 200 && publicApps.body?.length === 7 && publicApps.body.every((a) => a.manifest?.id === a.appKey), publicApps.body?.map((a) => a.appKey));
  finishStep(!failed);
  if (failed) return;

  // ── 7. uninstall ──────────────────────────────────────────────────────
  section("Uninstall FAQ: the entity_modules row is switched off, never deleted; the faqs rows stay (DECISIONS #22, #44)");
  const faqsBefore = (await tables("faqs")).faqs;
  const un = await call(PC, "DELETE", `/api/companies/${companyId}/store/${items["core-faq"].itemId}`);
  check("DELETE the FAQ install → 200/204", [200, 204].includes(un.status), un.body);
  const del = (await gcrCalls()).find((c) => c.method === "DELETE" && c.path === `/api/nextgent/installs/${installs["core-faq"]}`);
  check("gcr saw the signed DELETE /api/nextgent/installs/<faq install>", !!del && del.signed, del);
  t = await tables("entity_modules", "nextgent_installs", "faqs", "business_mcp_tokens");
  const emFaq = byInstall(t.entity_modules, installs["core-faq"]);
  rowDump("gcr memdb: entity_modules (FAQ) after uninstall", emFaq && { ...emFaq, settings: { ...emFaq.settings, manifest: `<manifest ${emFaq.settings?.manifest?.id}>` } });
  check("entity_modules row still present: enabled false, settings.showOnPublic false, manifest kept", !!emFaq && emFaq.enabled === false && emFaq.settings?.showOnPublic === false && emFaq.settings?.manifest?.id === "core-faq", emFaq);
  check("nextgent_installs row for FAQ is no longer active; its token row is revoked", byInstall(t.nextgent_installs, installs["core-faq"])?.status !== "active" && t.business_mcp_tokens.filter((r) => r.install_id === installs["core-faq"]).every((r) => !!r.revoked_at), { install: byInstall(t.nextgent_installs, installs["core-faq"])?.status, tokens: t.business_mcp_tokens.filter((r) => r.install_id === installs["core-faq"]).map((r) => r.revoked_at) });
  check("faqs rows untouched: same 4 rows as before", JSON.stringify(t.faqs) === JSON.stringify(faqsBefore) && t.faqs.length === 4, t.faqs.map((r) => r.question));
  const dead = await call(GCR, "GET", "/api/business/faqs.items", { headers: auth("core-faq") });
  check("FAQ's install session token no longer works (401/404)", [401, 403, 404].includes(dead.status), dead.body);
  const pubDead = await call(GCR, "GET", `/api/public/apps/${installs["core-faq"]}`);
  check("the FAQ public page is gone (404)", pubDead.status === 404, pubDead.body);
  const stillGallery = await call(GCR, "GET", "/api/business/media.images", { headers: auth("core-gallery"), quiet: true });
  check("the other installs are unaffected (Gallery still reads media.images)", stillGallery.status === 200 && stillGallery.body?.rows?.length === 2);
  const publicApps2 = await call(GCR, "GET", `/api/public/business/${slug}/apps`, { quiet: true });
  check("the public apps list drops FAQ (six left)", publicApps2.status === 200 && publicApps2.body?.length === 6 && !publicApps2.body.some((a) => a.appKey === "core-faq"), publicApps2.body?.map((a) => a.appKey));
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
