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
  STORE_AUDIENCE_MODES,
  STORE_CHANNELS,
  STORE_DEPLOY_ACTIONS,
  STORE_ITEM_KINDS,
  storeService,
} from "../services/store.js";
import { readNextgentConfig } from "../services/nextgent-config.js";
import { MENU_CATALOG, MENU_KEYS, storeMenuService } from "../services/store-menu.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin } from "./authz.js";
import { HttpError } from "../errors.js";
import { withUpstreamDetails } from "./nextgent.js";

/**
 * Store refusals that carry what the app needs to show: the charge on a
 * refused entitlement, the new permissions on an update awaiting approval,
 * and gcr-api-clean's own reason.
 */
async function withStoreDetails(res: import("express").Response, run: () => Promise<void>) {
  try {
    await withUpstreamDetails(res, run);
  } catch (error) {
    const details = error instanceof HttpError ? (error.details as Record<string, unknown> | undefined) : undefined;
    if (error instanceof HttpError && (details?.code === "needs_approval" || details?.code === "not_entitled")) {
      res.status(error.status).json({ ...details, error: error.message });
      return;
    }
    throw error;
  }
}

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

const deploySchema = z.object({
  version: z.string().trim().min(1).max(40),
  action: z.enum(STORE_DEPLOY_ACTIONS),
  audience: z.object({
    mode: z.enum(STORE_AUDIENCE_MODES),
    companyIds: z.array(z.string().uuid()).max(10_000).optional(),
    values: z.array(z.string().trim().min(1)).max(100).optional(),
  }),
  notes: z.string().trim().max(2_000).nullish(),
});

const priceSchema = z.object({
  amountCents: z.number().int().min(0).nullable(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code").nullish(),
  interval: z.string().trim().min(1).max(40).nullish(),
  model: z.string().trim().min(1).max(40).nullish(),
});

const coreMenuSchema = z.object({ core: z.array(z.enum(MENU_KEYS)) });

/** Updating with new data permissions is the owner's approval of them. */
const updateInstallSchema = z
  .object({ approvePermissions: z.boolean().optional() })
  .optional()
  .transform((value) => value ?? {});

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
  const menu = storeMenuService(db);

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

  /**
   * The store's vocabulary for the admin console. Kinds, channels, advisory
   * types, actions and audiences are what this server accepts (the kinds and
   * channels are database constraints); price models, intervals and the
   * default currency come from server settings.
   */
  router.get("/store/admin/meta", async (req, res) => {
    assertInstanceAdmin(req);
    const pricing = readNextgentConfig().storePricing;
    res.json({
      kinds: [...STORE_ITEM_KINDS],
      channels: [...STORE_CHANNELS],
      advisoryTypes: [...STORE_ADVISORY_TYPES],
      approvalModes: [...STORE_APPROVAL_MODES],
      forceableAdvisory: "security",
      actions: STORE_DEPLOY_ACTIONS.map((key) => ({ key, force: key === "force" })),
      audienceModes: STORE_AUDIENCE_MODES.map((key) =>
        key === "companies" ? { key, needs: "companies" } : key === "channel" ? { key, options: [...STORE_CHANNELS] } : { key },
      ),
      priceModels: pricing.models,
      intervals: pricing.intervals,
      currency: pricing.defaultCurrency,
    });
  });

  router.get("/store/admin/items/:itemId/installs", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.listItemInstalls(req.params.itemId as string));
  });

  router.post("/store/admin/items/:itemId/deploy/preview", validate(deploySchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.previewDeploy(req.params.itemId as string, req.body));
  });

  router.post("/store/admin/items/:itemId/deploy", validate(deploySchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.status(201).json(await store.deploy(req.params.itemId as string, req.body, req.actor.userId ?? null));
  });

  router.get("/store/admin/deployments", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await store.listDeployments());
  });

  router.put("/store/admin/items/:itemId/price", validate(priceSchema), async (req, res) => {
    assertInstanceAdmin(req);
    await withUpstreamDetails(res, async () => {
      res.json(await store.setPrice(req.params.itemId as string, req.body));
    });
  });

  router.get("/store/admin/menu", async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ catalog: MENU_CATALOG, core: await menu.coreMenu() });
  });

  router.put("/store/admin/menu", validate(coreMenuSchema), async (req, res) => {
    assertInstanceAdmin(req);
    res.json({ core: await menu.setCoreMenu(req.body.core) });
  });

  // ----- Company: browse and install -----------------------------------

  router.get("/companies/:companyId/menu", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await menu.visibleFor(companyId));
  });

  router.get("/companies/:companyId/store", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await store.listForCompany(companyId));
  });

  router.post("/companies/:companyId/store/:itemId/install", validate(subscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    await withStoreDetails(res, async () => {
      res.status(201).json(await store.install(companyId, req.params.itemId as string, req.actor.userId ?? null, req.body));
    });
  });

  router.patch("/companies/:companyId/store/:itemId", validate(subscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    res.json(await store.updateSubscription(companyId, req.params.itemId as string, req.body));
  });

  router.get("/companies/:companyId/store/:itemId/consent", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const channel = req.query.channel === "fast" ? "fast" : "stable";
    res.json(await store.consent(companyId, req.params.itemId as string, channel));
  });

  router.post("/companies/:companyId/store/:itemId/update", validate(updateInstallSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    await withStoreDetails(res, async () => {
      res.json(await store.updateInstall(companyId, req.params.itemId as string, req.actor.userId ?? null, req.body));
    });
  });

  router.delete("/companies/:companyId/store/:itemId", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageInstalls(req, access, companyId);
    await store.uninstall(companyId, req.params.itemId as string, req.actor.userId ?? null);
    res.status(204).end();
  });

  return router;
}
