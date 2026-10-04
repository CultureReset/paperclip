import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  pluginCompanySettings,
  plugins,
  storeInstalls,
  storeItemVersions,
  storeItems,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { storeRoutes } from "../routes/store.js";
import { storeService } from "../services/store.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres store tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Actor = Record<string, unknown>;

describeEmbeddedPostgres("store", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-store-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(storeInstalls);
    await db.delete(storeItemVersions);
    await db.delete(storeItems);
    await db.delete(pluginCompanySettings);
    await db.delete(plugins);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function appAs(actor: Actor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", storeRoutes(db));
    app.use(errorHandler);
    return app;
  }

  const admin: Actor = { type: "board", source: "session", userId: "admin-user", companyIds: [], isInstanceAdmin: true };

  function member(userId: string, companyId: string): Actor {
    return { type: "board", source: "session", userId, companyIds: [companyId], isInstanceAdmin: false };
  }

  async function seedCompany(prefix: string, members: Array<{ userId: string; role: string }>) {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: prefix, issuePrefix: prefix });
    for (const m of members) {
      await db.insert(companyMemberships).values({
        companyId,
        principalType: "user",
        principalId: m.userId,
        status: "active",
        membershipRole: m.role,
      });
    }
    return companyId;
  }

  async function publishedPack(key = "front-desk") {
    const app = appAs(admin);
    const item = (await request(app).post("/api/store/admin/items").send({ key, kind: "pack", name: "Front Desk" }).expect(201)).body;
    await request(app).post(`/api/store/admin/items/${item.id}/versions`).send({ version: "1.0.0" }).expect(201);
    await request(app).post(`/api/store/admin/items/${item.id}/publish`).expect(200);
    return item.id as string;
  }

  it("lets only the platform admin publish", async () => {
    const companyId = await seedCompany("OWN", [{ userId: "owner", role: "owner" }]);
    await request(appAs(member("owner", companyId)))
      .post("/api/store/admin/items")
      .send({ key: "front-desk", kind: "pack", name: "Front Desk" })
      .expect(403);
  });

  it("hides drafts and shows published items", async () => {
    const companyId = await seedCompany("SEE", [{ userId: "owner", role: "owner" }]);
    const app = appAs(admin);
    const item = (await request(app).post("/api/store/admin/items").send({ key: "draft-pack", kind: "pack", name: "Draft" }).expect(201)).body;
    await request(app).post(`/api/store/admin/items/${item.id}/publish`).expect(400);
    await request(app).post(`/api/store/admin/items/${item.id}/versions`).send({ version: "1.0.0" }).expect(201);

    const before = await request(appAs(member("owner", companyId))).get(`/api/companies/${companyId}/store`).expect(200);
    expect(before.body).toEqual([]);

    await request(app).post(`/api/store/admin/items/${item.id}/publish`).expect(200);
    const after = await request(appAs(member("owner", companyId))).get(`/api/companies/${companyId}/store`).expect(200);
    expect(after.body).toHaveLength(1);
    expect(after.body[0]).toMatchObject({ key: "draft-pack", installed: false, latestVersion: "1.0.0" });
  });

  it("lets owners and admins install, but not operators or viewers", async () => {
    const companyId = await seedCompany("ROL", [
      { userId: "owner", role: "owner" },
      { userId: "admin", role: "admin" },
      { userId: "operator", role: "operator" },
      { userId: "viewer", role: "viewer" },
    ]);
    const itemId = await publishedPack();

    await request(appAs(member("operator", companyId))).post(`/api/companies/${companyId}/store/${itemId}/install`).expect(403);
    await request(appAs(member("viewer", companyId))).post(`/api/companies/${companyId}/store/${itemId}/install`).expect(403);
    await request(appAs(member("admin", companyId))).post(`/api/companies/${companyId}/store/${itemId}/install`).expect(201);
    await request(appAs(member("owner", companyId))).delete(`/api/companies/${companyId}/store/${itemId}`).expect(204);
  });

  it("keeps each company's installs to itself", async () => {
    const companyA = await seedCompany("AAA", [{ userId: "alice", role: "owner" }]);
    const companyB = await seedCompany("BBB", [{ userId: "bob", role: "owner" }]);
    const itemId = await publishedPack();

    await request(appAs(member("alice", companyA))).post(`/api/companies/${companyA}/store/${itemId}/install`).expect(201);
    await request(appAs(member("alice", companyA))).post(`/api/companies/${companyB}/store/${itemId}/install`).expect(403);
    await request(appAs(member("alice", companyA))).get(`/api/companies/${companyB}/store`).expect(403);

    const bView = await request(appAs(member("bob", companyB))).get(`/api/companies/${companyB}/store`).expect(200);
    expect(bView.body[0].installed).toBe(false);
  });

  it("releases updates Red Hat style: channels, automatic or manual approval, required security fixes", async () => {
    const auto = await seedCompany("AUT", [{ userId: "alice", role: "owner" }]);
    const manual = await seedCompany("MAN", [{ userId: "bob", role: "owner" }]);
    const fast = await seedCompany("FST", [{ userId: "carol", role: "owner" }]);
    const outsider = await seedCompany("OUT", [{ userId: "dave", role: "owner" }]);
    const itemId = await publishedPack();
    const release = (body: Record<string, unknown>) =>
      request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send(body).expect(201);
    const view = async (userId: string, companyId: string) =>
      (await request(appAs(member(userId, companyId))).get(`/api/companies/${companyId}/store`).expect(200)).body[0];

    await request(appAs(member("alice", auto))).post(`/api/companies/${auto}/store/${itemId}/install`).send({}).expect(201);
    await request(appAs(member("bob", manual))).post(`/api/companies/${manual}/store/${itemId}/install`).send({ approvalMode: "manual" }).expect(201);
    await request(appAs(member("carol", fast))).post(`/api/companies/${fast}/store/${itemId}/install`).send({ channel: "fast" }).expect(201);

    // A stable enhancement: automatic installs take it, manual ones are offered it.
    expect((await release({ version: "1.1.0" })).body).toMatchObject({ appliedTo: 2, pendingFor: 1 });
    expect(await view("alice", auto)).toMatchObject({ installedVersion: "1.1.0", updateAvailable: false });
    expect(await view("bob", manual)).toMatchObject({ installedVersion: "1.0.0", updateAvailable: true, updateAdvisory: "enhancement" });
    expect(await view("carol", fast)).toMatchObject({ installedVersion: "1.1.0" });

    // A fast release reaches only fast subscribers.
    expect((await release({ version: "1.2.0-beta", channel: "fast" })).body).toMatchObject({ appliedTo: 1, pendingFor: 0 });
    expect(await view("alice", auto)).toMatchObject({ installedVersion: "1.1.0", latestVersion: "1.1.0" });
    expect(await view("carol", fast)).toMatchObject({ installedVersion: "1.2.0-beta" });

    // Only security advisories can be required, and a required one reaches manual installs too.
    await request(appAs(admin)).post(`/api/store/admin/items/${itemId}/versions`).send({ version: "x", required: true }).expect(400);
    expect((await release({ version: "1.1.1", advisoryType: "security", required: true })).body).toMatchObject({ appliedTo: 3, pendingFor: 0 });
    expect(await view("bob", manual)).toMatchObject({ installedVersion: "1.1.1", updateAvailable: false });

    // A manual company updates when it chooses; switching to automatic is its own call.
    await release({ version: "1.3.0", advisoryType: "bugfix" });
    expect(await view("bob", manual)).toMatchObject({ updateAvailable: true, updateAdvisory: "bugfix" });
    await request(appAs(member("bob", manual))).post(`/api/companies/${manual}/store/${itemId}/update`).expect(200);
    expect(await view("bob", manual)).toMatchObject({ installedVersion: "1.3.0", updateAvailable: false });
    await request(appAs(member("bob", manual))).patch(`/api/companies/${manual}/store/${itemId}`).send({ approvalMode: "automatic" }).expect(200);
    expect(await view("bob", manual)).toMatchObject({ approvalMode: "automatic" });

    // A company that never installed it is untouched.
    expect(await view("dave", outsider)).toMatchObject({ installed: false });
  });

  it("shows a store plugin only inside companies that installed it", async () => {
    const companyA = await seedCompany("PLA", [{ userId: "alice", role: "owner" }]);
    const companyB = await seedCompany("PLB", [{ userId: "bob", role: "owner" }]);
    const [plugin] = await db
      .insert(plugins)
      .values({ pluginKey: "acme.fleet", packageName: "@acme/fleet", version: "1.0.0", manifestJson: {} as never, status: "ready" })
      .returning();

    const app = appAs(admin);
    const item = (await request(app).post("/api/store/admin/items").send({ key: "fleet", kind: "plugin", name: "Fleet", pluginKey: "acme.fleet" }).expect(201)).body;
    await request(app).post(`/api/store/admin/items/${item.id}/versions`).send({ version: "1.0.0" }).expect(201);
    await request(app).post(`/api/store/admin/items/${item.id}/publish`).expect(200);
    await request(appAs(member("alice", companyA))).post(`/api/companies/${companyA}/store/${item.id}/install`).expect(201);

    const store = storeService(db);
    const forA = await store.pluginVisibility(companyA);
    const forB = await store.pluginVisibility(companyB);
    expect(forA.storeManaged.has("acme.fleet")).toBe(true);
    expect(forA.installed.has("acme.fleet")).toBe(true);
    expect(forB.installed.has("acme.fleet")).toBe(false);

    const settings = await db.select().from(pluginCompanySettings);
    expect(settings).toEqual([expect.objectContaining({ pluginId: plugin.id, companyId: companyA, enabled: true })]);

    await request(appAs(member("alice", companyA))).delete(`/api/companies/${companyA}/store/${item.id}`).expect(204);
    const [afterUninstall] = await db.select().from(pluginCompanySettings);
    expect(afterUninstall.enabled).toBe(false);
  });
});
