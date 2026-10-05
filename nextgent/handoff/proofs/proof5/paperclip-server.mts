// PROOF HARNESS (scratchpad, not part of the repo): boots Paperclip's real
// store and NEXT GENT routes as an HTTP listener on an embedded Postgres with
// the real migrations applied (the same fixture server/src/__tests__ use).
// Nothing in the repo is changed.
//
//   PC_PORT=4600 GCR_URL=http://127.0.0.1:4610 \
//   NODE_OPTIONS="--import <chown-tmp-for-postgres.mjs>" tsx paperclip-server.mts
//
// The actor is fixed per request by the `x-proof-actor` header: "admin" is an
// instance admin (publishes), "ownerB" is the second company's owner, anything
// else is company A's owner.
//
// Debug surface for the proof driver only:
//   GET /__proof/ready         { companyId, companyBId, ownerUserId, ownerBUserId }
//   GET /__proof/installs      company A's store_installs rows
//   GET /__proof/links         nextgent_business_links rows + its information_schema columns,
//                              the 0293 archive table's existence, drizzle's migration log tail
//   GET /__proof/inbound       every inbound /api/nextgent/* request (method, path, signed, body)

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PC_PORT || 4600);
const GCR_URL = (process.env.GCR_URL || "http://127.0.0.1:4610").replace(/\/+$/, "");
const SECRET = process.env.NEXTGENT_SERVICE_SECRET || "proof-shared-service-secret";
const home = mkdtempSync(path.join(os.tmpdir(), "paperclip-proof5-home-"));

// From .env.example: the required ones with dummy values, plus the NEXT GENT wiring.
Object.assign(process.env, {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "paperclip-dev-secret",
  PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "paperclip-dev-tool-action-signing-secret-change-me",
  PAPERCLIP_HOME: home,
  PAPERCLIP_SECRETS_MASTER_KEY_FILE: path.join(home, "master.key"),
  PAPERCLIP_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
  PAPERCLIP_API_URL: `http://127.0.0.1:${PORT}`,
  GCR_API_URL: GCR_URL,
  NEXTGENT_SERVICE_SECRET: SECRET,
  NEXTGENT_STORE_CURRENCY: "usd",
  NEXTGENT_STORE_PRICE_MODELS: "free,subscription,one_time",
  NEXTGENT_STORE_PRICE_INTERVALS: "month,year",
});

const SERVER = "/home/user/paperclip/server/src";
// Imported after the environment is set: the route factories read it when called.
const express = (await import("express")).default;
const { eq } = await import("drizzle-orm");
const dbMod = await import("@paperclipai/db");
const { storeRoutes } = await import(`${SERVER}/routes/store.ts`);
const { nextgentRoutes, nextgentPublicRoutes } = await import(`${SERVER}/routes/nextgent.ts`);
const { activityRoutes } = await import(`${SERVER}/routes/activity.ts`);
const { errorHandler } = await import(`${SERVER}/middleware/index.ts`);

console.log("[paperclip-proof] starting embedded Postgres and applying migrations…");
const tempDb = await dbMod.startEmbeddedPostgresTestDatabase("paperclip-proof5-");
const db = dbMod.createDb(tempDb.connectionString);
console.log("[paperclip-proof] database ready");

// The company and its owner (a direct insert, the way the server's own tests seed one).
const companyId = randomUUID();
const ownerUserId = `user-${randomUUID()}`;
await db.insert(dbMod.companies).values({ id: companyId, name: "Proof Cafe Co", issuePrefix: "PRF", requireBoardApprovalForNewAgents: false });
await db.insert(dbMod.companyMemberships).values({
  companyId,
  principalType: "user",
  principalId: ownerUserId,
  status: "active",
  membershipRole: "owner",
  updatedAt: new Date(),
});

// Company B, another owner: the cross-company checks in step 5.
const companyBId = randomUUID();
const ownerBUserId = `user-${randomUUID()}`;
await db.insert(dbMod.companies).values({ id: companyBId, name: "Proof Plumbing Co", issuePrefix: "PRB", requireBoardApprovalForNewAgents: false });
await db.insert(dbMod.companyMemberships).values({
  companyId: companyBId, principalType: "user", principalId: ownerBUserId, status: "active", membershipRole: "owner", updatedAt: new Date(),
});
const ownerBActor = {
  type: "board", source: "session", userId: ownerBUserId, companyIds: [companyBId],
  memberships: [{ companyId: companyBId, membershipRole: "owner", status: "active" }], isInstanceAdmin: false,
};

const ownerActor = {
  type: "board", source: "session", userId: ownerUserId, companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "owner", status: "active" }], isInstanceAdmin: false,
};
const adminActor = { type: "board", source: "session", userId: "proof-admin", companyIds: [], isInstanceAdmin: true };

const app = express();
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
const inbound: unknown[] = [];
app.use("/api/nextgent", (req, _res, next) => {
  inbound.push({
    at: new Date().toISOString(), method: req.method, path: req.originalUrl,
    signed: ["x-nextgent-timestamp", "x-nextgent-nonce", "x-nextgent-signature"].every((h) => !!req.get(h)),
    body: req.body && Object.keys(req.body).length ? req.body : null,
  });
  next();
});
app.use((req, _res, next) => {
  const who = req.get("x-proof-actor");
  (req as any).actor = who === "admin" ? adminActor : who === "ownerB" ? ownerBActor : ownerActor;
  next();
});
app.get("/__proof/ready", (_req, res) => res.json({ companyId, companyBId, ownerUserId, ownerBUserId, port: PORT }));
app.get("/__proof/inbound", (_req, res) => res.json(inbound));
app.get("/__proof/links", async (_req, res) => {
  const sql = db.$client as any;
  const rows = await sql.unsafe(`select * from nextgent_business_links order by linked_at`);
  const columns = await sql.unsafe(`select column_name, data_type from information_schema.columns where table_name = 'nextgent_business_links' order by ordinal_position`);
  const archive = await sql.unsafe(`select table_name from information_schema.tables where table_name = 'nextgent_business_links_archive_0293'`);
  const archiveColumns = await sql.unsafe(`select column_name from information_schema.columns where table_name = 'nextgent_business_links_archive_0293' order by ordinal_position`);
  let migrations: unknown = null;
  try { migrations = await sql.unsafe(`select id, hash, created_at from drizzle.__drizzle_migrations order by id desc limit 3`); } catch (e) { migrations = { error: String((e as Error).message) }; }
  res.json({ rows, columns, archiveTable: archive, archiveColumns, migrationsTail: migrations });
});
app.get("/__proof/activity-raw", async (req, res) => {
  const sql = db.$client as any;
  res.json(await sql.unsafe(`select id, company_id, action, entity_type, entity_id, details, created_at from activity_log where company_id = $1 and action = 'nextgent.conversation' order by created_at`, [String(req.query.companyId)]));
});
app.get("/__proof/installs", async (_req, res) => {
  res.json(await db.select().from(dbMod.storeInstalls).where(eq(dbMod.storeInstalls.companyId, companyId)));
});
app.use(nextgentPublicRoutes(db));
app.use("/api", storeRoutes(db));
app.use("/api", nextgentRoutes(db));
app.use("/api", activityRoutes(db));
app.use(errorHandler);

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[paperclip-proof] Paperclip routes listening on http://127.0.0.1:${PORT}, gcr at ${GCR_URL}, company A ${companyId}, company B ${companyBId}`);
});

async function shutdown() {
  server.close();
  await db.$client.end({ timeout: 1 }).catch(() => {});
  await tempDb.cleanup();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
