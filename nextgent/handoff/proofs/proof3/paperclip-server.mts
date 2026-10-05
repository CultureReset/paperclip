// PROOF HARNESS (scratchpad, not part of the repo): boots Paperclip's real
// store and NEXT GENT routes as an HTTP listener on an embedded Postgres with
// the real migrations applied (the same fixture server/src/__tests__ use).
// Nothing in the repo is changed.
//
//   PC_PORT=4600 GCR_URL=http://127.0.0.1:4610 \
//   NODE_OPTIONS="--import <chown-tmp-for-postgres.mjs>" tsx paperclip-server.mts
//
// The actor is fixed per request by the `x-proof-actor` header: "admin" is an
// instance admin (publishes), anything else is the seeded company's owner.
//
// Debug surface for the proof driver only:
//   GET /__proof/ready     { companyId, ownerUserId }
//   GET /__proof/installs  the company's store_installs rows

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PC_PORT || 4600);
const GCR_URL = (process.env.GCR_URL || "http://127.0.0.1:4610").replace(/\/+$/, "");
const SECRET = process.env.NEXTGENT_SERVICE_SECRET || "proof-shared-service-secret";
const home = mkdtempSync(path.join(os.tmpdir(), "paperclip-proof3-home-"));

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
const { errorHandler } = await import(`${SERVER}/middleware/index.ts`);

console.log("[paperclip-proof] starting embedded Postgres and applying migrations…");
const tempDb = await dbMod.startEmbeddedPostgresTestDatabase("paperclip-proof3-");
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

const ownerActor = {
  type: "board", source: "session", userId: ownerUserId, companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "owner", status: "active" }], isInstanceAdmin: false,
};
const adminActor = { type: "board", source: "session", userId: "proof-admin", companyIds: [], isInstanceAdmin: true };

const app = express();
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use((req, _res, next) => {
  (req as any).actor = req.get("x-proof-actor") === "admin" ? adminActor : ownerActor;
  next();
});
app.get("/__proof/ready", (_req, res) => res.json({ companyId, ownerUserId, port: PORT }));
app.get("/__proof/installs", async (_req, res) => {
  res.json(await db.select().from(dbMod.storeInstalls).where(eq(dbMod.storeInstalls.companyId, companyId)));
});
app.use(nextgentPublicRoutes(db));
app.use("/api", storeRoutes(db));
app.use("/api", nextgentRoutes(db));
app.use(errorHandler);

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[paperclip-proof] Paperclip routes listening on http://127.0.0.1:${PORT}, gcr at ${GCR_URL}, company ${companyId}`);
});

async function shutdown() {
  server.close();
  await db.$client.end({ timeout: 1 }).catch(() => {});
  await tempDb.cleanup();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
