import { Router, type Request, type RequestHandler, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { companies, storeInstalls } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { conflict, forbidden, HttpError, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { normalizeHumanRole } from "../services/company-member-roles.js";
import { assertBusinessTokenKeyLoadable, businessTokenJwks, signBusinessToken, type BusinessTokenRole } from "../services/nextgent-business-jwt.js";
import { nextgentBusinessLinkService } from "../services/nextgent-business-link.js";
import { deviceStatusSchema, nextgentDeviceService, pairDeviceSchema } from "../services/nextgent-devices.js";
import { gcrConfigured, readNextgentConfig, type NextgentConfig } from "../services/nextgent-config.js";
import { gcrClient, upstreamDetails, type FetchLike } from "../services/nextgent-gcr-client.js";
import {
  nextgentConversationSchema,
  nextgentInboundService,
  nextgentReceiptSchema,
} from "../services/nextgent-inbound.js";
import {
  NEXTGENT_NONCE_HEADER,
  NEXTGENT_SIGNATURE_HEADER,
  NEXTGENT_TIMESTAMP_HEADER,
  splitRequestUrl,
  verifyNextgentSignature,
} from "../services/nextgent-service-signing.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

export interface NextgentRouteOptions {
  config?: NextgentConfig;
  fetch?: FetchLike;
}

/**
 * Answer a refused gcr-api-clean call with its own fields (claimRequired,
 * claimInstead, reason, …) next to the error, so the app can act on them.
 * Anything else goes to the normal error handler.
 */
export async function withUpstreamDetails(res: Response, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const extras = upstreamDetails(error);
    if (extras && error instanceof HttpError && error.status < 500) {
      res.status(error.status).json({ ...extras, error: error.message });
      return;
    }
    throw error;
  }
}

const optionalText = z.string().trim().min(1).max(500).optional();

/** Owner app → Paperclip. Exactly one of entitySlug or create. */
const businessLinkSchema = z.union([
  z.object({ entitySlug: z.string().trim().min(1).max(200) }).strict(),
  z
    .object({
      create: z
        .object({
          name: z.string().trim().min(1).max(200),
          kind: z.string().trim().min(1).max(100),
          phone: optionalText,
          address: optionalText,
          website: optionalText,
        })
        .strict(),
    })
    .strict(),
]);

const unlinkSchema = z
  .object({ export: z.boolean().optional() })
  .optional()
  .transform((value) => value ?? {});

async function companyExists(db: Db, companyId: string) {
  const row = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0]);
  return Boolean(row);
}

/**
 * Which role a signed-in user holds for a company, for a business token.
 * Members get "owner" or "member"; a viewer cannot get a token that may
 * write; an instance admin who is not a member gets "instance_admin", which
 * gcr-api-clean only honours for ids it lists in platform_admins.
 */
async function businessRoleFor(req: Request, db: Db, companyId: string): Promise<BusinessTokenRole> {
  assertBoard(req);
  const userId = req.actor.userId;
  if (!userId) throw forbidden("A signed-in user is required");
  const membership = await accessService(db).getMembership(companyId, "user", userId);
  if (membership && membership.status === "active") {
    const role = normalizeHumanRole(membership.membershipRole);
    if (role === "viewer") throw forbidden("Viewer access is read-only");
    return role === "owner" ? "owner" : "member";
  }
  if (req.actor.isInstanceAdmin || req.actor.source === "local_implicit") {
    if (!(await companyExists(db, companyId))) throw notFound("Company not found");
    return "instance_admin";
  }
  throw forbidden("User does not have access to this company");
}

/**
 * Linking changes what the whole company is, and pairing a computer gives it
 * the company's device token (DECISIONS #70), so only owners and admins (or
 * an instance admin) may.
 */
async function assertCanManageBusinessLink(req: Request, db: Db, companyId: string, refusal = "Only owners and admins can link or unlink the business") {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    if (!(await companyExists(db, companyId))) throw notFound("Company not found");
    return;
  }
  const userId = req.actor.userId;
  const membership = userId ? await accessService(db).getMembership(companyId, "user", userId) : null;
  const role = membership?.status === "active" ? normalizeHumanRole(membership.membershipRole) : null;
  if (role !== "owner" && role !== "admin") throw forbidden(refusal);
}

const DEVICE_REFUSAL = "Only owners and admins can pair or unlink a computer";

/** `online=true|false` narrows the admin list; anything else means both. */
function onlineFilter(value: unknown): boolean | null {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

/**
 * Session routes under /api: the screen's business token, and linking the
 * company to its business.
 */
export function nextgentRoutes(db: Db, options: NextgentRouteOptions = {}) {
  const router = Router();
  const config = options.config ?? readNextgentConfig();
  const links = nextgentBusinessLinkService(db, { config, fetch: options.fetch });
  const inbound = nextgentInboundService(db, { config });
  const gcr = gcrClient({ config, fetch: options.fetch });
  const devices = nextgentDeviceService(db, { config, fetch: options.fetch });

  router.post("/companies/:companyId/business-token", async (req, res) => {
    const companyId = req.params.companyId as string;
    const role = await businessRoleFor(req, db, companyId);
    if (!config.publicUrl) throw new HttpError(503, "PAPERCLIP_PUBLIC_URL must be set to issue business tokens");
    const { token, expiresAt } = signBusinessToken({
      issuer: config.publicUrl,
      userId: req.actor.userId as string,
      companyId,
      role,
      ttlSeconds: config.businessTokenTtlSeconds,
    });
    res.set("Cache-Control", "no-store");
    res.json({ token, expiresAt });
  });

  /**
   * Contract §12: an instance-admin token with no company, for Plat-admin's
   * fleet-wide and admin screens. gcr-api-clean honours it only for ids it
   * lists in platform_admins, and admin routes still name the slug.
   */
  router.post("/admin/business-token", async (req, res) => {
    assertInstanceAdmin(req);
    if (!config.publicUrl) throw new HttpError(503, "PAPERCLIP_PUBLIC_URL must be set to issue business tokens");
    const userId = req.actor.userId;
    if (!userId) throw forbidden("A signed-in user is required");
    const { token, expiresAt } = signBusinessToken({
      issuer: config.publicUrl,
      userId,
      companyId: null,
      role: "instance_admin",
      ttlSeconds: config.businessTokenTtlSeconds,
    });
    res.set("Cache-Control", "no-store");
    res.json({ token, expiresAt });
  });

  /**
   * An installed app's business-data token for the screen that draws it: a
   * short-lived session token gcr-api-clean mints for that one install (it
   * can only touch what the owner approved for it, and dies with the
   * install). The install's long-lived token stays a server-side secret and
   * is never sent to a browser.
   */
  router.post("/companies/:companyId/installs/:installId/token", async (req, res) => {
    const companyId = req.params.companyId as string;
    const installId = req.params.installId as string;
    await businessRoleFor(req, db, companyId);
    if (!isUuidLike(installId)) throw notFound("Install not found");
    const install = await db
      .select({ id: storeInstalls.id, enabled: storeInstalls.enabled, tokenSecretId: storeInstalls.tokenSecretId })
      .from(storeInstalls)
      .where(and(eq(storeInstalls.id, installId), eq(storeInstalls.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!install) throw notFound("Install not found");
    if (!install.enabled) throw conflict("This install is switched off");
    if (!install.tokenSecretId) throw notFound("This install has no business-data token");
    if (!gcr.configured) throw new HttpError(503, "GCR_API_URL and NEXTGENT_SERVICE_SECRET must be set to issue install tokens");
    await withUpstreamDetails(res, async () => {
      const session = await gcr.installSession(install.id, companyId);
      if (typeof session?.token !== "string" || !session.token || typeof session.expiresAt !== "string" || !session.expiresAt) {
        throw new HttpError(502, "gcr-api-clean returned an incomplete install session");
      }
      res.set("Cache-Control", "no-store");
      res.json({ token: session.token, expiresAt: session.expiresAt });
    });
  });

  /** Receipts for real-world actions in this company, newest first (any member). */
  router.get("/companies/:companyId/receipts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? ""), 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(String(req.query.offset ?? ""), 10) || 0, 0);
    res.json(await inbound.listReceipts(companyId, { limit, offset }));
  });

  router.get("/companies/:companyId/business-link", async (req, res) => {
    const companyId = req.params.companyId as string;
    await businessRoleFor(req, db, companyId);
    const link = await links.get(companyId);
    res.json(
      link
        ? { linked: true, entitySlug: link.entitySlug, linkedAt: link.linkedAt }
        : { linked: false },
    );
  });

  router.post("/companies/:companyId/business-link", validate(businessLinkSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageBusinessLink(req, db, companyId);
    const body = req.body as z.infer<typeof businessLinkSchema>;
    await withUpstreamDetails(res, async () => {
      const result = await links.link(
        companyId,
        "create" in body ? { create: body.create } : { entitySlug: body.entitySlug },
        req.actor.userId ?? null,
      );
      res.status(201).json(result);
    });
  });

  router.delete("/companies/:companyId/business-link", validate(unlinkSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageBusinessLink(req, db, companyId);
    const body = req.body as { export?: boolean };
    await withUpstreamDetails(res, async () => {
      res.json(await links.unlink(companyId, body.export === true, req.actor.userId ?? null));
    });
  });

  /** The company's devices (SPEC §5): every member, and the box itself with its device token. */
  router.get("/companies/:companyId/devices", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({ devices: await devices.list(companyId), onlineSeconds: config.devices.onlineSeconds });
  });

  /** Owners and admins approve the code the box shows (DECISIONS #69, #70). */
  router.post("/companies/:companyId/devices/pair", validate(pairDeviceSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageBusinessLink(req, db, companyId, DEVICE_REFUSAL);
    await withUpstreamDetails(res, async () => {
      res.status(201).json(await devices.pair(companyId, req.body as z.infer<typeof pairDeviceSchema>, req.actor.userId ?? null));
    });
  });

  router.delete("/companies/:companyId/devices/:deviceId", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageBusinessLink(req, db, companyId, DEVICE_REFUSAL);
    await withUpstreamDetails(res, async () => {
      res.json(await devices.unlink(companyId, req.params.deviceId as string, req.actor.userId ?? null));
    });
  });

  /** Plat-admin's fleet view: linked devices across companies, `companyId` and `online` narrow it. */
  router.get("/admin/nextgent/devices", async (req, res) => {
    assertInstanceAdmin(req);
    const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : null;
    if (companyId && !isUuidLike(companyId)) throw notFound("Company not found");
    res.json({ devices: await devices.listAll({ companyId, online: onlineFilter(req.query.online) }), onlineSeconds: config.devices.onlineSeconds });
  });

  return router;
}

/** Rejects any request without a valid contract §3 signature over its method, path, query and exact body bytes. */
export function requireNextgentSignature(config: NextgentConfig): RequestHandler {
  return (req, res, next) => {
    const result = verifyNextgentSignature({
      secret: config.serviceSecret,
      request: {
        method: req.method,
        ...splitRequestUrl(req.originalUrl ?? req.url),
        rawBody: (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      },
      timestamp: req.get(NEXTGENT_TIMESTAMP_HEADER),
      nonce: req.get(NEXTGENT_NONCE_HEADER),
      signature: req.get(NEXTGENT_SIGNATURE_HEADER),
      acceptLegacy: config.acceptLegacySignatures,
    });
    if (result.ok) {
      next();
      return;
    }
    if (result.reason === "unconfigured") {
      res.status(503).json({ error: "NEXTGENT_SERVICE_SECRET is not set on this server" });
      return;
    }
    res.status(401).json({ error: "Invalid or missing NEXT GENT signature", reason: result.reason });
  };
}

/**
 * Routes mounted outside the session/board guards: the public JWKS, and the
 * endpoints gcr-api-clean calls, which authenticate by signature only.
 * Mount after the JSON parser that captures `req.rawBody`.
 */
export function nextgentPublicRoutes(db: Db, options: NextgentRouteOptions = {}) {
  const router = Router();
  const config = options.config ?? readNextgentConfig();
  // A NEXT GENT deployment (gcr-api-clean wired) must hold its signing key
  // from the start: in production a missing NEXTGENT_JWT_PRIVATE_KEY stops
  // the server here with a clear error rather than at the first token mint.
  if (gcrConfigured(config)) assertBusinessTokenKeyLoadable();
  const inbound = nextgentInboundService(db, { config });
  const devices = nextgentDeviceService(db, { config, fetch: options.fetch });
  const signed = requireNextgentSignature(config);

  router.get("/.well-known/jwks.json", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json(businessTokenJwks());
  });

  router.post("/api/nextgent/receipts", signed, validate(nextgentReceiptSchema), async (req, res) => {
    res.status(201).json(await inbound.recordReceipt(req.body));
  });

  router.post("/api/nextgent/conversations", signed, validate(nextgentConversationSchema), async (req, res) => {
    res.status(201).json(await inbound.recordConversation(req.body));
  });

  /** The relay heartbeat's state for a computer and its phones (DECISIONS #72, #73). */
  router.post("/api/nextgent/devices/status", signed, validate(deviceStatusSchema), async (req, res) => {
    res.json(await devices.applyStatus(req.body));
  });

  return router;
}
