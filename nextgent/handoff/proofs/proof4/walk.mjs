#!/usr/bin/env node
// PROOF DRIVER (proof4): walks Step 4 (the business bridge; DECISIONS #32–#36,
// #40, #41) over real HTTP between the two servers started by run.sh
// (Paperclip on PC_URL, gcr-api-clean on GCR_URL), asserting at each step and
// writing transcript.md next to this file. Stops at the first failing step.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toStorePublication } from "/home/user/App-build-/packages/engine/src/store.js";

const require = createRequire(import.meta.url);
// gcr's own signer, for the replay check in step 5 (same shared secret as both servers, from run.sh).
const signing = require("/home/user/gcr-api-clean/lib/serviceSigning.js");

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
async function call(base, method, p, { body, headers = {}, actor, show, raw } = {}) {
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
  log(`\`${method} ${url.replace(PC, "{paperclip}").replace(GCR, "{gcr}")}\` (${who}${headers.authorization ? ", Bearer token" : ""}${shownHeaders.length ? `, headers: ${shownHeaders.join(", ")}` : ""}) → **${res.status}**`);
  if (body !== undefined) log("request body:\n" + json(summarizeBody(typeof body === "string" ? JSON.parse(body) : body)));
  if (show) log("response (selected):\n" + json(pick(parsed, show)));
  else if (raw || (parsed !== null && JSON.stringify(parsed).length <= 2500)) log("response:\n" + json(parsed));
  else log(`response: <${JSON.stringify(parsed).length} bytes, see assertions>`);
  return { status: res.status, body: parsed, text, headers: res.headers };
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
async function pcInbound() { return (await fetch(`${PC}/__proof/inbound`)).json(); }
async function pcLinks() { return (await fetch(`${PC}/__proof/links`)).json(); }
async function seed(table, row) { return (await fetch(`${GCR}/__proof/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, row }) })).json(); }
async function setRows(table, where, patch) { return (await fetch(`${GCR}/__proof/set`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table, where, patch }) })).json(); }
function rowDump(title, rows) { log(`${title}:\n` + json(rows)); }
const manifestOf = (dir) => JSON.parse(readFileSync(path.join(APPS, dir, "manifest.json"), "utf8"));
const sameKeys = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).sort().join(",") === [...keys].sort().join(",");

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
  log("# Proof 4: Step 4, the business bridge, over real HTTP (Paperclip ⇄ gcr-api-clean)\n");
  log(`Run at ${new Date().toISOString()}.`);
  log(`\nPaperclip at \`${PC}\` (real routes/store.ts + routes/nextgent.ts + routes/activity.ts on embedded Postgres with all migrations), gcr-api-clean at \`${GCR}\` (real routes/nextgent.js, routes/owner.js and lib/liveAgent.js on scripts/lib/memdb.js). Shared NEXTGENT_SERVICE_SECRET; gcr's PAPERCLIP_API_URL and PAPERCLIP_ISSUER are the Paperclip URL. Read-only on both repos.\n`);
  log("Repo state at run time:\n```\n" + git("/home/user/paperclip") + "\n---\n" + git("/home/user/gcr-api-clean") + "\n```");

  const ready = await waitReady();
  const { companyId, companyBId } = ready;
  log(`\nPaperclip company A: \`${companyId}\` (owner \`${ready.ownerUserId}\`); company B: \`${companyBId}\` (owner \`${ready.ownerBUserId}\`). Both created by direct insert into companies + an owner membership.`);

  // ── 1. link; the link row holds no business facts ─────────────────────
  section("Link company A to a new business; Paperclip's link holds the reference only (DECISIONS #32, #33, #40)");
  const link = await call(PC, "POST", `/api/companies/${companyId}/business-link`, { body: { create: { name: "Proof Diner", kind: "cafe" } } });
  check("link answered 201 with the slug gcr-api-clean created", link.status === 201 && typeof link.body?.entitySlug === "string", link.body);
  const slug = link.body?.entitySlug;
  const linked = await call(PC, "GET", `/api/companies/${companyId}/business-link`);
  check("GET business-link is exactly {linked, entitySlug, linkedAt}", linked.status === 200 && sameKeys(linked.body, ["linked", "entitySlug", "linkedAt"]) && linked.body.linked === true && linked.body.entitySlug === slug, linked.body);
  check("no forwardingAddress / businessKind in the GET response", !("forwardingAddress" in (linked.body || {})) && !("businessKind" in (linked.body || {})) && !("kind" in (linked.body || {})));
  const pl = await pcLinks();
  rowDump("Paperclip Postgres: nextgent_business_links rows", pl.rows);
  rowDump("Paperclip Postgres: information_schema.columns for nextgent_business_links", pl.columns);
  rowDump("Paperclip Postgres: nextgent_business_links_archive_0293 (table, columns)", { table: pl.archiveTable, columns: pl.archiveColumns });
  rowDump("Paperclip Postgres: drizzle.__drizzle_migrations tail", pl.migrationsTail);
  const colNames = (pl.columns || []).map((c) => c.column_name);
  check("the row exists for company A with the slug", pl.rows?.some((r) => r.company_id === companyId && r.entity_slug === slug));
  check("table columns are exactly company_id, entity_slug, business_token_secret_id, linked_by_user_id, linked_at, updated_at", colNames.sort().join(",") === ["company_id", "entity_slug", "business_token_secret_id", "linked_by_user_id", "linked_at", "updated_at"].sort().join(","), colNames);
  check("no business_kind / forwarding_address column", !colNames.includes("business_kind") && !colNames.includes("forwarding_address"));
  check("migration 0293 ran: nextgent_business_links_archive_0293 exists with company_id, business_kind, forwarding_address, archived_at", pl.archiveTable?.length === 1 && (pl.archiveColumns || []).map((c) => c.column_name).sort().join(",") === ["company_id", "business_kind", "forwarding_address", "archived_at"].sort().join(","), pl);
  const journal = JSON.parse(readFileSync("/home/user/paperclip/packages/db/src/migrations/meta/_journal.json", "utf8"));
  const last = journal.entries.at(-1);
  log(`drizzle journal last entry: \`${last.tag}\` (idx ${last.idx}); migrations logged in the database: ${Array.isArray(pl.migrationsTail) ? pl.migrationsTail.length ? `latest id ${pl.migrationsTail[0].id}` : "none" : JSON.stringify(pl.migrationsTail)}`);
  check("journal's last migration is 0293 and the database's newest drizzle migration row has 0293's `when` as its created_at", last.tag.startsWith("0293_") && Array.isArray(pl.migrationsTail) && String(pl.migrationsTail[0]?.created_at) === String(last.when), { last, tail: pl.migrationsTail });
  let t = await tables("entity", "company_links");
  rowDump("gcr memdb: entity", t.entity);
  rowDump("gcr memdb: company_links", t.company_links);
  check("gcr has entity_type 'cafe' on the entity (gcr is where the kind lives)", t.entity.find((e) => e.slug === slug)?.entity_type === "cafe");
  check("the link call reached gcr signed", (await gcrCalls()).some((c) => c.method === "POST" && c.path === "/api/nextgent/link" && c.signed));
  // Company B gets its own business, for the cross-company checks later.
  const linkB = await call(PC, "POST", `/api/companies/${companyBId}/business-link`, { body: { create: { name: "Proof Plumbing", kind: "plumber" } }, actor: "ownerB" });
  check("company B linked to its own new business", linkB.status === 201 && typeof linkB.body?.entitySlug === "string" && linkB.body.entitySlug !== slug, linkB.body);
  const slugB = linkB.body?.entitySlug;
  finishStep(!failed);
  if (failed) return;

  // ── 2. kinds through the bridge ───────────────────────────────────────
  section("Business kinds come live from gcr (DECISIONS #32): admin meta → signed GET /api/nextgent/business-kinds; a kind-audience push targets the company");
  const set = await setRows("entity", { slug }, { entity_type: "restaurant" });
  rowDump(`gcr memdb: entity '${slug}' after setting entity_type = restaurant`, set.rows);
  const before2 = (await gcrCalls()).length;
  const meta = await call(PC, "GET", "/api/store/admin/meta", { actor: "admin", show: ["audienceModes"] });
  const kindMode = meta.body?.audienceModes?.find((m) => m.key === "kind");
  check("meta 200 with audienceModes.kind.options", meta.status === 200 && Array.isArray(kindMode?.options), meta.body);
  const restaurant = kindMode?.options?.find((o) => o.key === "restaurant");
  check("options include exactly {key:'restaurant', count:1} (the console gets key and count; company ids stay in the planner)", sameKeys(restaurant, ["key", "count"]) && restaurant.count === 1, kindMode?.options);
  check("options include {key:'plumber', count:1} for company B and no 'cafe' (the earlier value is gone: nothing is cached in Paperclip)", kindMode?.options?.some((o) => o.key === "plumber" && o.count === 1) && !kindMode?.options?.some((o) => o.key === "cafe"), kindMode?.options);
  const kindCalls = (await gcrCalls()).slice(before2);
  log("gcr inbound /api/nextgent calls during meta:\n" + json(kindCalls));
  check("gcr saw a signed GET /api/nextgent/business-kinds", kindCalls.some((c) => c.method === "GET" && c.path === "/api/nextgent/business-kinds" && c.signed));
  // A published app to push.
  const qr = manifestOf("qr-menu");
  const pub = toStorePublication(qr, { channel: "stable", changelog: "First release" });
  check("engine toStorePublication accepts the shipped QR Menu manifest", pub.ok === true, pub.errors);
  const item = await call(PC, "POST", "/api/store/admin/items", { body: pub.item, actor: "admin", show: ["id", "key", "kind", "status"] });
  const itemId = item.body?.id;
  const v1 = await call(PC, "POST", `/api/store/admin/items/${itemId}/versions`, { body: pub.version, actor: "admin", show: ["appliedTo", "pendingFor"] });
  const published = await call(PC, "POST", `/api/store/admin/items/${itemId}/publish`, { actor: "admin", show: ["status"] });
  check("item created, version 1.0.0 accepted, published", item.status === 201 && v1.status === 201 && published.body?.status === "published");
  const before2b = (await gcrCalls()).length;
  const audience = { mode: "kind", values: ["restaurant"] };
  const preview = await call(PC, "POST", `/api/store/admin/items/${itemId}/deploy/preview`, { body: { version: "1.0.0", action: "apply", audience, installMissing: true, enabled: true }, actor: "admin" });
  check("preview 200", preview.status === 200, preview.body);
  const previewTargets = JSON.stringify(preview.body);
  check("preview targets company A and not company B", preview.body?.targeted === 1 && previewTargets.includes(companyId) && !previewTargets.includes(companyBId), preview.body);
  check("the preview asked gcr for the kinds (signed GET business-kinds)", (await gcrCalls()).slice(before2b).some((c) => c.method === "GET" && c.path === "/api/nextgent/business-kinds" && c.signed));
  const deploy = await call(PC, "POST", `/api/store/admin/items/${itemId}/deploy`, { body: { version: "1.0.0", action: "apply", audience, installMissing: true, enabled: true }, actor: "admin" });
  check("deploy: targeted 1 (company A), install 1, no failures", [200, 201].includes(deploy.status) && deploy.body?.targeted === 1 && deploy.body?.install === 1 && deploy.body?.companies?.[0]?.companyId === companyId && (deploy.body?.failedFor?.length ?? 0) === 0, deploy.body);
  log("QR Menu declares permissions (menu:read, menu:write), so the push installs it switched off pending the owner's consent (services/store.ts:300 `startOn` needs no permissions and no price); nothing goes to gcr until the owner enables it. The owner of company A enables it now, which is what proves the push landed on A's business.");
  const pcInstalls = await (await fetch(`${PC}/__proof/installs`)).json();
  check("company A has the install (switched off)", pcInstalls.some((i) => i.itemId === itemId && i.enabled === false), pcInstalls);
  const en = await call(PC, "POST", `/api/companies/${companyId}/store/${itemId}/enable`, { body: {}, show: ["id", "enabled", "approvedPermissions", "tokenSecretId"] });
  check("owner A enable → 200, enabled true", en.status === 200 && en.body?.enabled === true, en.body);
  t = await tables("nextgent_installs", "entity_modules");
  rowDump("gcr memdb: nextgent_installs", t.nextgent_installs.map((r) => ({ install_id: r.install_id, company_id: r.company_id, entity_slug: r.entity_slug, item_key: r.item_key, status: r.status })));
  check("gcr registered the install for company A's business only", t.nextgent_installs.length === 1 && t.nextgent_installs[0].entity_slug === slug && t.nextgent_installs[0].company_id === companyId && !t.nextgent_installs.some((r) => r.entity_slug === slugB));
  const listB = await call(PC, "GET", `/api/companies/${companyBId}/store`, { actor: "ownerB", show: ["id", "installed"] });
  check("company B's listing shows the item not installed", listB.body?.find((i) => i.id === itemId)?.installed === false);
  finishStep(!failed);
  if (failed) return;

  // ── 3. closed conversation → reference only ───────────────────────────
  section("A closed SMS conversation in gcr posts a REFERENCE to Paperclip (DECISIONS #34, #41): no transcript, no phone number");
  const convId = randomUUID();
  const CALLER = "+15550123456";
  const BIZ_NUMBER = "+15550200000";
  const started = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const transcript = [
    { role: "caller", text: `Hi, this is a customer at ${CALLER}, do you have gluten-free pancakes?`, at: started },
    { role: "agent", text: "Yes, we do. Would you like to book a table?", at: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
    { role: "caller", text: "Yes please, 7pm for two. My number is 555-012-3456.", at: new Date(Date.now() - 3 * 60 * 1000).toISOString() },
  ];
  const thread = await seed("message_threads", { id: "thread-1", entity_slug: slug, channel: "sms", customer_address: CALLER });
  const row = await seed("live_conversations", {
    id: convId, channel: "sms", mode: "business", entity_slug: slug, company_id: companyId,
    from_number: CALLER, to_number: BIZ_NUMBER, provider_ref: null,
    transcript, tool_calls: [], status: "open", state: "answered", started_at: started, last_activity_at: new Date().toISOString(),
  });
  rowDump("gcr memdb: seeded message_threads row", thread);
  rowDump("gcr memdb: seeded live_conversations row (open, 3 turns, caller number in from_number and in the text)", row);
  const beforeIn = (await pcInbound()).length;
  const closed = await call(GCR, "POST", "/__proof/close-conversation", { body: { id: convId, outcome: "booked" } });
  check("closeConversation ran: status closed, ended_at set, recorded_at set, record_error null", closed.body?.row?.status === "closed" && !!closed.body?.row?.ended_at && !!closed.body?.row?.recorded_at && closed.body?.row?.record_error === null, closed.body?.row);
  const inbound = (await pcInbound()).slice(beforeIn);
  log("Paperclip inbound /api/nextgent calls during close:\n" + json(inbound));
  const post = inbound.find((c) => c.method === "POST" && c.path === "/api/nextgent/conversations");
  check("Paperclip received one signed POST /api/nextgent/conversations", inbound.length === 1 && !!post && post.signed, inbound);
  const REF_KEYS = ["companyId", "conversationId", "channel", "mode", "threadId", "startedAt", "endedAt", "turns", "outcome"];
  check("the body is exactly the reference shape (companyId + {conversationId, channel, mode, threadId, startedAt, endedAt, turns, outcome})", sameKeys(post?.body, REF_KEYS) && post.body.companyId === companyId && post.body.conversationId === convId && post.body.channel === "sms" && post.body.mode === "business" && post.body.threadId === "thread-1" && post.body.turns === 3 && post.body.outcome === "booked", post?.body);
  const wire = JSON.stringify(post?.body ?? {});
  check("the wire body has no transcript text and no phone number", !wire.includes("pancakes") && !wire.includes(CALLER) && !wire.includes(BIZ_NUMBER) && !wire.includes("555-012") && !/transcript|from|"to"/.test(wire), post?.body);
  const act = await call(PC, "GET", `/api/companies/${companyId}/activity?limit=200`);
  const actRows = Array.isArray(act.body) ? act.body : Array.isArray(act.body?.activity) ? act.body.activity : Array.isArray(act.body?.items) ? act.body.items : [];
  const convRows = actRows.filter((a) => a.action === "nextgent.conversation");
  log("Paperclip activity rows with action nextgent.conversation:\n" + json(convRows));
  check("activity has exactly one nextgent.conversation entry", act.status === 200 && convRows.length === 1, { status: act.status, actions: actRows.map((a) => a.action) });
  const details = convRows[0]?.details;
  check("details is exactly {conversationId, channel, mode, threadId, startedAt, endedAt, turns, outcome} with turns 3", sameKeys(details, ["conversationId", "channel", "mode", "threadId", "startedAt", "endedAt", "turns", "outcome"]) && details?.turns === 3 && details?.conversationId === convId && details?.outcome === "booked" && details?.threadId === "thread-1" && details?.startedAt === started && details?.endedAt === closed.body?.row?.ended_at, details);
  const actJson = JSON.stringify(convRows);
  check("nothing of the transcript and no phone number anywhere in the activity JSON", !actJson.includes("pancakes") && !actJson.includes("gluten") && !actJson.includes(CALLER) && !actJson.includes(BIZ_NUMBER) && !actJson.includes("555-012") && !/\+1\d{10}/.test(actJson) && !/transcript/.test(actJson) && !/"from"|"to"/.test(actJson), convRows);
  const rawAct = await (await fetch(`${PC}/__proof/activity-raw?companyId=${companyId}`)).json();
  rowDump("Paperclip Postgres: activity_log rows (action nextgent.conversation) for company A", rawAct);
  const rawJson = JSON.stringify(rawAct);
  check("the stored activity_log row carries the same reference and nothing else", rawAct.length === 1 && sameKeys(rawAct[0].details, ["conversationId", "channel", "mode", "threadId", "startedAt", "endedAt", "turns", "outcome"]) && !rawJson.includes("pancakes") && !/\+1\d{10}/.test(rawJson) && rawAct[0].entity_type === "nextgent_conversation", rawAct);
  finishStep(!failed);
  if (failed) return;

  // ── 4. owner reads the conversation in gcr ────────────────────────────
  section("gcr owner routes with a Paperclip business token (DECISIONS #36): list without bodies or numbers, detail with the transcript, bogus id 404");
  const bt = await call(PC, "POST", `/api/companies/${companyId}/business-token`, { show: ["expiresAt"] });
  check("business token issued for company A (JWT)", bt.status === 200 && String(bt.body?.token).split(".").length === 3, bt.body && { expiresAt: bt.body.expiresAt });
  const authA = { authorization: `Bearer ${bt.body?.token}` };
  const list = await call(GCR, "GET", "/api/owner/conversations", { headers: authA });
  check("list 200 with one conversation, total 1", list.status === 200 && list.body?.conversations?.length === 1 && list.body?.total === 1, list.body);
  const c0 = list.body?.conversations?.[0];
  check("list row is {id, channel, mode, started_at, ended_at, outcome, turns} for the conversation", sameKeys(c0, ["id", "channel", "mode", "started_at", "ended_at", "outcome", "turns"]) && c0?.id === convId && c0?.turns === 3 && c0?.outcome === "booked" && c0?.channel === "sms", c0);
  const listJson = list.text;
  check("list carries no bodies and no numbers", !listJson.includes("pancakes") && !listJson.includes(CALLER) && !listJson.includes(BIZ_NUMBER) && !/transcript|from_number|to_number/.test(listJson));
  const detail = await call(GCR, "GET", `/api/owner/conversations/${convId}`, { headers: authA });
  check("detail 200 with the 3-turn transcript, from/to, status, tool_calls", detail.status === 200 && detail.body?.conversation?.transcript?.length === 3 && detail.body.conversation.transcript[0].text.includes("pancakes") && detail.body.conversation.from === CALLER && detail.body.conversation.to === BIZ_NUMBER && detail.body.conversation.status === "closed" && Array.isArray(detail.body.conversation.tool_calls), detail.body);
  const bogus = await call(GCR, "GET", `/api/owner/conversations/${randomUUID()}`, { headers: authA });
  check("a bogus id → 404", bogus.status === 404, bogus.body);
  const bogus2 = await call(GCR, "GET", `/api/owner/conversations/not-a-uuid`, { headers: authA });
  check("a non-uuid id → 404", bogus2.status === 404, bogus2.body);
  finishStep(!failed);
  if (failed) return;

  // ── 5. signing and slug scoping ───────────────────────────────────────
  section("Signing and slug checks still hold: unsigned 401, replayed nonce 401, company B cannot read company A's conversations");
  const unsigned = await call(GCR, "GET", "/api/nextgent/business-kinds");
  check("unsigned GET /api/nextgent/business-kinds → 401", unsigned.status === 401, unsigned.body);
  const url = `${GCR}/api/nextgent/business-kinds`;
  const headers = signing.signHeaders({ method: "GET", url, rawBody: "" });
  log(`signed with gcr's lib/serviceSigning.signHeaders (shared secret from the environment): ${json({ ...headers, "x-nextgent-signature": headers["x-nextgent-signature"].slice(0, 16) + "…" })}`);
  const first = await call(GCR, "GET", "/api/nextgent/business-kinds", { headers });
  check("the fresh signed request → 200 with the kinds", first.status === 200 && Array.isArray(first.body) && first.body.some((k) => k.key === "restaurant"), first.body);
  const replay = await call(GCR, "GET", "/api/nextgent/business-kinds", { headers });
  check("the same request again (same nonce, same signature) → 401 replayed", replay.status === 401 && /replay/i.test(JSON.stringify(replay.body)), replay.body);
  const stale = signing.signHeaders({ method: "GET", url, rawBody: "" }, { now: Date.now() - 400 * 1000 });
  const old = await call(GCR, "GET", "/api/nextgent/business-kinds", { headers: stale });
  check("a 400 s old signature → 401 too old", old.status === 401 && /old/i.test(JSON.stringify(old.body)), old.body);
  const wrongPath = signing.signHeaders({ method: "GET", url: `${GCR}/api/nextgent/entitlement`, rawBody: "" });
  const moved = await call(GCR, "GET", "/api/nextgent/business-kinds", { headers: wrongPath });
  check("a signature for another path presented here → 401 bad signature", moved.status === 401, moved.body);
  // Paperclip side of the same contract.
  const pcUnsigned = await call(PC, "POST", "/api/nextgent/conversations", { body: { companyId, channel: "sms", turns: 1 } });
  check("Paperclip refuses an unsigned POST /api/nextgent/conversations with 401", pcUnsigned.status === 401, pcUnsigned.body);
  // Company B's token: its own slug, nothing of A's.
  const btB = await call(PC, "POST", `/api/companies/${companyBId}/business-token`, { actor: "ownerB", show: ["expiresAt"] });
  check("business token issued for company B", btB.status === 200 && String(btB.body?.token).split(".").length === 3, btB.body && { expiresAt: btB.body.expiresAt });
  const authB = { authorization: `Bearer ${btB.body?.token}` };
  const listB5 = await call(GCR, "GET", "/api/owner/conversations", { headers: authB });
  check("B's list is empty (its business has no conversations)", listB5.status === 200 && listB5.body?.conversations?.length === 0 && listB5.body?.total === 0, listB5.body);
  const crossB = await call(GCR, "GET", `/api/owner/conversations/${convId}`, { headers: authB });
  check("B reading A's conversation id → 404", crossB.status === 404, crossB.body);
  const crossQuery = await call(GCR, "GET", `/api/owner/conversations/${convId}?business=${slug}&slug=${slug}`, { headers: authB });
  check("B naming A's slug in the query is ignored (still 404, not an admin)", crossQuery.status === 404, crossQuery.body);
  const noToken = await call(GCR, "GET", "/api/owner/conversations");
  check("no token → 401", noToken.status === 401, noToken.body);
  const pcCrossActivity = await call(PC, "GET", `/api/companies/${companyId}/activity?limit=5`, { actor: "ownerB" });
  check("Paperclip: owner B cannot read company A's activity (403/404)", [403, 404].includes(pcCrossActivity.status), pcCrossActivity.body);
  t = await tables("live_conversations");
  rowDump("gcr memdb: live_conversations at the end (the transcript and numbers stayed here)", t.live_conversations.map((r) => ({ ...r, transcript: `<${r.transcript.length} turns>` })));
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
