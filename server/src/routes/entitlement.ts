import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { COMPANY_PLAN_STATUSES, entitlementService, entitlementSource } from "../services/entitlement/index.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

/**
 * Entitlement routes (DECISIONS #83): the admin's plans, plan items, grants
 * and company plans (gcr-api-clean routes/store.js admin part, which no
 * surface called any more), and the owner's "may I have this item" answer
 * (gcr GET /api/nextgent/entitlement).
 */
const planSchema = z.object({
  key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).nullish(),
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
const planPatchSchema = planSchema.omit({ key: true }).partial();
const planItemSchema = z.object({ itemId: z.string().uuid() });
const grantSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
  note: z.string().trim().max(500).nullish(),
  expiresAt: z.string().trim().min(1).nullish(),
});
const companyPlanSchema = z.object({
  planId: z.string().uuid().nullish(),
  status: z.enum(COMPANY_PLAN_STATUSES).optional(),
  pauseReason: z.string().trim().max(500).nullish(),
});

export function entitlementRoutes(db: Db) {
  const router = Router();
  const entitlement = entitlementService(db);
  const plans = entitlement.plans;

  router.get("/entitlement/admin/meta", async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ source: entitlementSource(), accessModes: ["free", "plan", "grant"], companyPlanStatuses: [...COMPANY_PLAN_STATUSES] });
  });

  router.get("/entitlement/admin/plans", async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ plans: await plans.listPlans() });
  });

  router.post("/entitlement/admin/plans", validate(planSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json({ plan: await plans.createPlan(req.body as z.infer<typeof planSchema>) });
  });

  router.patch("/entitlement/admin/plans/:planId", validate(planPatchSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ plan: await plans.updatePlan(req.params.planId as string, req.body as z.infer<typeof planPatchSchema>) });
  });

  router.post("/entitlement/admin/plans/:planId/items", validate(planItemSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json(await plans.addPlanItem(req.params.planId as string, (req.body as z.infer<typeof planItemSchema>).itemId));
  });

  router.delete("/entitlement/admin/plans/:planId/items/:itemId", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await plans.removePlanItem(req.params.planId as string, req.params.itemId as string));
  });

  router.get("/entitlement/admin/grants", async (req, res) => {
    assertInstanceAdmin(req);
    res.json({
      grants: await plans.listGrants({
        companyId: typeof req.query.companyId === "string" ? req.query.companyId : null,
        itemId: typeof req.query.itemId === "string" ? req.query.itemId : null,
        includeRevoked: req.query.includeRevoked === "true",
      }),
    });
  });

  router.post("/entitlement/admin/grants", validate(grantSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json({ grant: await plans.createGrant(req.body as z.infer<typeof grantSchema>, req.actor.userId ?? null) });
  });

  router.post("/entitlement/admin/grants/:grantId/revoke", async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ grant: await plans.revokeGrant(req.params.grantId as string) });
  });

  router.get("/entitlement/admin/companies/:companyId/plan", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await plans.getCompanyPlan(req.params.companyId as string));
  });

  router.put("/entitlement/admin/companies/:companyId/plan", validate(companyPlanSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ companyPlan: await plans.setCompanyPlan(req.params.companyId as string, req.body as z.infer<typeof companyPlanSchema>, req.actor.userId ?? null) });
  });

  /** The owner's answer: may this company have the item, and at what price (gcr GET /entitlement). */
  router.get("/companies/:companyId/entitlement", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const itemKey = typeof req.query.itemKey === "string" ? req.query.itemKey.trim() : "";
    if (!itemKey) throw badRequest("itemKey is required");
    const answer = await entitlement.entitlementFor(companyId, itemKey);
    res.json({ allowed: answer.allowed, reason: answer.allowed ? answer.reason : answer.ok ? "paused" : answer.reason, priceCents: answer.priceCents, interval: answer.interval, planKey: answer.planKey, paused: answer.paused });
  });

  return router;
}
