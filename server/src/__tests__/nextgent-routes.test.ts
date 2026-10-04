import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signNextgentBody } from "../services/nextgent-service-signing.js";
import type { NextgentConfig } from "../services/nextgent-config.js";

const mockAccess = vi.hoisted(() => ({ getMembership: vi.fn() }));
const mockLinks = vi.hoisted(() => ({ get: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
const mockInbound = vi.hoisted(() => ({ recordReceipt: vi.fn(), recordConversation: vi.fn() }));

vi.mock("../services/access.js", () => ({ accessService: () => mockAccess }));
vi.mock("../services/nextgent-business-link.js", () => ({ nextgentBusinessLinkService: () => mockLinks }));
vi.mock("../services/nextgent-inbound.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/nextgent-inbound.js")>();
  return { ...actual, nextgentInboundService: () => mockInbound };
});

const SECRET = "shared-secret";
const config: NextgentConfig = {
  gcrApiUrl: "https://gcr.example.test",
  serviceSecret: SECRET,
  publicUrl: "https://paperclip.example.test",
  litellm: { url: null, masterKey: null, companyBudget: null, budgetDuration: null },
  assistant: { name: null, instructionsFile: null, adapterType: null },
  platformCompanyId: null,
  businessTokenTtlSeconds: 300,
};

/** Minimal db: every select returns `rows`. */
function fakeDb(rows: unknown[] = [{ id: "company-1" }]) {
  const chain = { from: () => chain, where: () => chain, then: (fn: (r: unknown[]) => unknown) => Promise.resolve(fn(rows)) };
  return { select: () => chain } as never;
}

async function appAs(actor: Record<string, unknown> | null, db = fakeDb()) {
  const [{ nextgentRoutes, nextgentPublicRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/nextgent.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor ?? { type: "none", source: "none" };
    next();
  });
  app.use(nextgentPublicRoutes(db, { config }));
  app.use("/api", nextgentRoutes(db, { config }));
  app.use(errorHandler);
  return app;
}

const session = (userId: string, extra: Record<string, unknown> = {}) => ({
  type: "board",
  source: "session",
  userId,
  companyIds: ["company-1"],
  isInstanceAdmin: false,
  ...extra,
});

function claimsOf(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

describe("POST /api/companies/:companyId/business-token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives an owner a short-lived token for that company", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "owner" });
    const res = await request(await appAs(session("user-1"))).post("/api/companies/company-1/business-token");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const claims = claimsOf(res.body.token);
    expect(claims).toMatchObject({ iss: config.publicUrl, aud: "gcr-api-clean", sub: "user-1", company_id: "company-1", role: "owner" });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
    expect(new Date(res.body.expiresAt).getTime()).toBe(claims.exp * 1000);
    expect(mockAccess.getMembership).toHaveBeenCalledWith("company-1", "user", "user-1");
  });

  it("maps other active members to member and refuses viewers", async () => {
    mockAccess.getMembership.mockResolvedValueOnce({ status: "active", membershipRole: "operator" });
    const res = await request(await appAs(session("user-2"))).post("/api/companies/company-1/business-token");
    expect(claimsOf(res.body.token).role).toBe("member");
    mockAccess.getMembership.mockResolvedValueOnce({ status: "active", membershipRole: "viewer" });
    const viewer = await request(await appAs(session("user-3"))).post("/api/companies/company-1/business-token");
    expect(viewer.status).toBe(403);
  });

  it("refuses someone who is not a member", async () => {
    mockAccess.getMembership.mockResolvedValue(null);
    const res = await request(await appAs(session("stranger"))).post("/api/companies/company-1/business-token");
    expect(res.status).toBe(403);
  });

  it("gives an instance admin who is not a member the instance_admin role", async () => {
    mockAccess.getMembership.mockResolvedValue(null);
    const res = await request(await appAs(session("admin", { isInstanceAdmin: true, companyIds: [] }))).post(
      "/api/companies/company-1/business-token",
    );
    expect(res.status).toBe(200);
    expect(claimsOf(res.body.token).role).toBe("instance_admin");
  });

  it("refuses agents", async () => {
    const res = await request(await appAs({ type: "agent", agentId: "a1", companyId: "company-1" })).post(
      "/api/companies/company-1/business-token",
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /.well-known/jwks.json", () => {
  it("publishes the public signing key only", async () => {
    const res = await request(await appAs(null)).get("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    expect(res.body.keys[0]).toMatchObject({ use: "sig" });
    expect(res.body.keys[0].kid).toBeTruthy();
    expect(res.body.keys[0]).not.toHaveProperty("d");
  });
});

describe("business link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets an owner link by slug and never returns the token", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "owner" });
    mockLinks.link.mockResolvedValue({ entitySlug: "biz", forwardingAddress: "in@example.test" });
    const res = await request(await appAs(session("user-1"))).post("/api/companies/company-1/business-link").send({ entitySlug: "biz" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ entitySlug: "biz", forwardingAddress: "in@example.test" });
    expect(mockLinks.link).toHaveBeenCalledWith("company-1", { entitySlug: "biz" }, "user-1");
  });

  it("passes a new business through as create", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "admin" });
    mockLinks.link.mockResolvedValue({ entitySlug: "new-biz", forwardingAddress: null });
    const create = { name: "New", kind: "shop", phone: "000" };
    const res = await request(await appAs(session("user-1"))).post("/api/companies/company-1/business-link").send({ create });
    expect(res.status).toBe(201);
    expect(mockLinks.link).toHaveBeenCalledWith("company-1", { create }, "user-1");
  });

  it("passes gcr-api-clean's claim answers through to the app", async () => {
    const { HttpError } = await import("../errors.js");
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "owner" });
    mockLinks.link.mockRejectedValue(
      new HttpError(409, "That business has to be claimed first.", { upstreamStatus: 409, upstream: { claimRequired: true } }),
    );
    const res = await request(await appAs(session("user-1"))).post("/api/companies/company-1/business-link").send({ entitySlug: "biz" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "That business has to be claimed first.", claimRequired: true });
  });

  it("rejects both or neither of entitySlug and create", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "owner" });
    const app = await appAs(session("user-1"));
    expect((await request(app).post("/api/companies/company-1/business-link").send({})).status).toBe(400);
    expect(
      (await request(app).post("/api/companies/company-1/business-link").send({ entitySlug: "a", create: { name: "b", kind: "c" } })).status,
    ).toBe(400);
  });

  it("refuses members who are not owners or admins", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "operator" });
    const res = await request(await appAs(session("user-2"))).post("/api/companies/company-1/business-link").send({ entitySlug: "biz" });
    expect(res.status).toBe(403);
    expect(mockLinks.link).not.toHaveBeenCalled();
  });

  it("unlinks with an optional export", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "owner" });
    mockLinks.unlink.mockResolvedValue({ unlinked: true, entitySlug: "biz", exportUrl: "https://export.example.test/x" });
    const res = await request(await appAs(session("user-1"))).delete("/api/companies/company-1/business-link").send({ export: true });
    expect(res.status).toBe(200);
    expect(mockLinks.unlink).toHaveBeenCalledWith("company-1", true, "user-1");
  });

  it("reports the link state to members", async () => {
    mockAccess.getMembership.mockResolvedValue({ status: "active", membershipRole: "operator" });
    mockLinks.get.mockResolvedValue(null);
    const res = await request(await appAs(session("user-2"))).get("/api/companies/company-1/business-link");
    expect(res.body).toEqual({ linked: false });
  });
});

describe("signed inbound endpoints (contract §5)", () => {
  beforeEach(() => vi.clearAllMocks());

  const receipt = {
    companyId: "company-1",
    taskId: "task-1",
    action: "sms.send",
    target: "+10000000000",
    newValue: "Confirm 7 PM",
    verified: true,
    at: "2026-10-04T12:00:00Z",
  };

  it("rejects unsigned and wrongly signed receipts", async () => {
    const app = await appAs(null);
    const unsigned = await request(app).post("/api/nextgent/receipts").send(receipt);
    expect(unsigned.status).toBe(401);
    const body = JSON.stringify(receipt);
    const bad = signNextgentBody("wrong-secret", body);
    const wrong = await request(app).post("/api/nextgent/receipts").set(bad).set("content-type", "application/json").send(body);
    expect(wrong.status).toBe(401);
    expect(mockInbound.recordReceipt).not.toHaveBeenCalled();
  });

  it("records a signed receipt", async () => {
    mockInbound.recordReceipt.mockResolvedValue({ id: "r1", taskId: "task-1" });
    const body = JSON.stringify(receipt);
    const res = await request(await appAs(null))
      .post("/api/nextgent/receipts")
      .set(signNextgentBody(SECRET, body))
      .set("content-type", "application/json")
      .send(body);
    expect(res.status).toBe(201);
    expect(mockInbound.recordReceipt).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", verified: true, taskId: "task-1" }));
  });

  it("validates a signed receipt's shape", async () => {
    const body = JSON.stringify({ companyId: "company-1", action: "x" });
    const res = await request(await appAs(null))
      .post("/api/nextgent/receipts")
      .set(signNextgentBody(SECRET, body))
      .set("content-type", "application/json")
      .send(body);
    expect(res.status).toBe(400);
  });

  it("records a signed conversation and rejects an unsigned one", async () => {
    mockInbound.recordConversation.mockResolvedValue({ id: "c1" });
    const conversation = {
      companyId: "nextgent",
      channel: "sms",
      from: "+10000000001",
      to: "+10000000002",
      transcript: [{ role: "caller", text: "hi", at: "2026-10-04T12:00:00Z" }],
    };
    const app = await appAs(null);
    expect((await request(app).post("/api/nextgent/conversations").send(conversation)).status).toBe(401);
    const body = JSON.stringify(conversation);
    const res = await request(app)
      .post("/api/nextgent/conversations")
      .set(signNextgentBody(SECRET, body))
      .set("content-type", "application/json")
      .send(body);
    expect(res.status).toBe(201);
    expect(mockInbound.recordConversation).toHaveBeenCalledWith(expect.objectContaining({ companyId: "nextgent", channel: "sms" }));
  });
});
