import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCompanyService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => ({}),
  budgetService: () => mockBudgetService,
  companyArtifactsService: () => ({}),
  companyPortabilityService: () => ({}),
  companyService: () => mockCompanyService,
  feedbackService: () => ({}),
  logActivity: mockLogActivity,
  workTimelineService: () => ({}),
}));

const createdCompany = {
  id: "company-new",
  name: "New Company",
  budgetMonthlyCents: 0,
};

async function createApp(actor: Record<string, unknown>) {
  const [{ companyRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/companies.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("POST /api/companies self-serve workspaces", () => {
  const signedInUser = { type: "board", source: "session", userId: "user-1", isInstanceAdmin: false };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAPERCLIP_SELF_SERVE_COMPANIES;
    delete process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.PAPERCLIP_MANAGED_CONFIG;
    mockCompanyService.create.mockResolvedValue(createdCompany);
  });

  afterEach(() => {
    delete process.env.PAPERCLIP_SELF_SERVE_COMPANIES;
    delete process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN;
  });

  it("keeps creation admin-only when self-serve is off", async () => {
    const app = await createApp(signedInUser);
    const res = await request(app).post("/api/companies").send({ name: "Mine" });
    expect(res.status).toBe(403);
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });

  it("lets a signed-in user create a workspace they own when self-serve is on", async () => {
    process.env.PAPERCLIP_SELF_SERVE_COMPANIES = "true";
    const app = await createApp(signedInUser);
    const res = await request(app).post("/api/companies").send({ name: "Mine" });
    expect(res.status).toBe(201);
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith("company-new", "user", "user-1", "owner", "active");
  });

  it("does not extend self-serve to non-session actors", async () => {
    process.env.PAPERCLIP_SELF_SERVE_COMPANIES = "true";
    const app = await createApp({ type: "board", source: "board_key", userId: "user-1", isInstanceAdmin: false });
    const res = await request(app).post("/api/companies").send({ name: "Mine" });
    expect(res.status).toBe(403);
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });

  it("stays off on Paperclip Cloud-managed instances", async () => {
    process.env.PAPERCLIP_SELF_SERVE_COMPANIES = "true";
    process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    const app = await createApp(signedInUser);
    const res = await request(app).post("/api/companies").send({ name: "Mine" });
    expect(res.status).toBe(403);
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });
});
