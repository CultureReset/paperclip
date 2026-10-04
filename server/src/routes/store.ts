import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { forbidden } from "../errors.js";
import { accessService } from "../services/access.js";
import { normalizeHumanRole } from "../services/company-member-roles.js";
import {
  STORE_ADVISORY_TYPES,
  STORE_APPROVAL_MODES,
  STORE_CHANNELS,
  STORE_ITEM_KINDS,
  storeService,
} from "../services/store.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

const itemKeySchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers and dashes");

const createItemSchema = z.object({
  key: itemKeySchema,
  kind: z.enum(STORE_ITEM_KINDS),
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(280).nullish(),
  description: z.string().trim().max(10_000).nullish(),
  iconUrl: z.string().trim().url().nullish(),
  pluginKey: z.string().trim().min(1).nullish(),
});

const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(280).nullish(),
  description: z.string().trim().max(10_000).nullish(),
  iconUrl: z.string().trim().url().nullish(),
});

const addVersionSchema = z.object({
  version: z.string().trim().min(1).max(40),
  channel: z.enum(STORE_CHANNELS).default("stable"),
  advisoryType: z.enum(STORE_ADVISORY_TYPES).default("enhancement"),
  required: z.boolean().default(false),
  changelog: z.string().trim().max(10_000).nullish(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const subscriptionSchema = z
  .object({
    channel: z.enum(STORE_CHANNELS).optional(),
    approvalMode: z.enum(STORE_APPROVAL_MODES).optional(),
  })
  .optional()
  .transform((value) => value ?? {});

/** Store installs change what a whole company sees, so only its owners and admins may do them. */
async function assertCanManageInstalls(req: Request, access: ReturnType<typeof accessService>, companyId: string) {
  assertCompanyAccess(req, companyId);
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  const membership = req.actor.userId ? await access.getMembership(companyId, "user", req.actor.userId) : null;
  const role = membership?.status === "active" ? normalizeHumanRole(membership.membershipRole) : null;
  if (role !== "owner" && role !== "admin") {
    throw forbidden("Only owners and admins can install or remove store items");
  }
}

export function storeRoutes(db: Db) {
  const router = Router();
  const store = storeService(db);
  const access = accessService(db);

  // ----- Platform admin: publish ---------------------------------------

  router.get("/store/admin/items", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.listAll());
  });

  router.post("/store/admin/items", validate(createItemSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json(await store.create(req.body, req.actor.userId ?? null));
  });

  router.patch("/store/admin/items/:itemId", validate(updateItemSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.update(req.params.itemId as string, req.body));
  });

  router.post("/store/admin/items/:itemId/versions", validate(addVersionSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json(await store.addVersion(req.params.itemId as string, req.body, req.actor.userId ?? null));
  });

  router.post("/store/admin/items/:itemId/publish", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.publish(req.params.itemId as string));
  });

  router.post("/store/admin/items/:itemId/retire", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.retire(req.params.itemId as string));
  });

  // ----- Company: browse and install -----------------------------------

  router.get("/companies/:companyId/store", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await store.listForCompany(companyId));
  });

  router.post("/companies/:companyId/store/:itemId/install", validate(subscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    res.status(201).json(await store.install(companyId, req.params.itemId as string, req.actor.userId ?? null, req.body));
  });

  router.patch("/companies/:companyId/store/:itemId", validate(subscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    res.json(await store.updateSubscription(companyId, req.params.itemId as string, req.body));
  });

  router.post("/companies/:companyId/store/:itemId/update", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    res.json(await store.updateInstall(companyId, req.params.itemId as string, req.actor.userId ?? null));
  });

  router.delete("/companies/:companyId/store/:itemId", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    await store.uninstall(companyId, req.params.itemId as string, req.actor.userId ?? null);
    res.status(204).end();
  });

  return router;
}
