import { Router, type Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { routines } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { forbidden, HttpError, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { automationService, type AutomationServiceOptions } from "../services/automation/index.js";
import { automationInstalls } from "../services/automation/install.js";
import { normalizeHumanRole } from "../services/company-member-roles.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin, hasCompanyAccess } from "./authz.js";

/**
 * Automations (SPEC §7, DECISIONS #82, #89): the owner's installs and drafts,
 * the port of gcr-api-clean's owner router (/api/business/automations), and
 * the admin's catalogue and recent runs. The company comes from the URL and is
 * checked against the session; an automation is looked up inside that
 * company only.
 */
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const runSchema = z.object({
  input: z.unknown().optional(),
  dry_run: z.boolean().optional(),
}).optional().transform((value) => value ?? {});
const draftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().optional(),
  description: z.string().nullish(),
  trigger: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(z.unknown()).optional(),
  config_schema: z.array(z.unknown()).optional(),
});

/** A refusal that lists the definition's problems answers with them, as gcr's builder expects ({ error, problems }). */
async function withProblems(res: import("express").Response, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const details = error instanceof HttpError ? (error.details as { problems?: unknown } | undefined) : undefined;
    if (error instanceof HttpError && error.status < 500 && Array.isArray(details?.problems)) {
      res.status(error.status).json({ error: error.message, problems: details.problems });
      return;
    }
    throw error;
  }
}

async function assertCanManage(req: Request, access: ReturnType<typeof accessService>, companyId: string) {
  assertCompanyAccess(req, companyId);
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  const membership = req.actor.userId ? await access.getMembership(companyId, "user", req.actor.userId) : null;
  const role = membership?.status === "active" ? normalizeHumanRole(membership.membershipRole) : null;
  if (role !== "owner" && role !== "admin") throw forbidden("Only owners and admins can change automations");
}

export function automationRoutes(db: Db, options: AutomationServiceOptions = {}) {
  const router = Router();
  const automations = automationService(db, options);
  const installs = automationInstalls(db, { config: options.config, automations });
  const access = accessService(db);

  /** The routine, only when it is this company's automation (404 otherwise, for both missing and foreign). */
  async function ownAutomation(req: Request, companyId: string, routineId: string) {
    if (!isUuidLike(routineId)) return null;
    const routine = await db.select().from(routines).where(eq(routines.id, routineId)).then((rows) => rows[0] ?? null);
    if (!routine || routine.companyId !== companyId || routine.mode !== "steps" || !hasCompanyAccess(req, routine.companyId)) return null;
    return routine;
  }

  // ----- Owner -----------------------------------------------------------

  /** The builder's palette for an owner: no platform-only steps, plus the events this company's installed apps declare. */
  router.get("/companies/:companyId/automations/meta", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json(automations.definitions.catalogue({ forOwner: true, events: await automations.definitions.knownEvents(companyId) }));
  });

  router.get("/companies/:companyId/automations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json({ automations: await installs.listForCompany(companyId) });
  });

  router.get("/companies/:companyId/automations/drafts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json({ drafts: await installs.listDrafts(companyId) });
  });

  router.post("/companies/:companyId/automations/drafts", validate(draftSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, access, companyId);
    const body = req.body as z.infer<typeof draftSchema>;
    await withProblems(res, async () => {
      const result = await installs.saveDraft(companyId, body as Record<string, unknown>, req.actor.userId ?? null, body.id ?? null);
      res.status(body.id ? 200 : 201).json(result);
    });
  });

  router.post("/companies/:companyId/automations/drafts/:routineId/publish", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, access, companyId);
    await withProblems(res, async () => {
      const routine = await installs.publishDraft(companyId, req.params.routineId as string, req.actor.userId ?? null);
      res.json({ id: routine.id, published: true, status: routine.status });
    });
  });

  router.patch("/companies/:companyId/automations/:routineId", validate(patchSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, access, companyId);
    const routine = await ownAutomation(req, companyId, req.params.routineId as string);
    if (!routine) throw notFound("That automation is not on your dashboard.");
    res.json(await installs.patch(routine, req.body as z.infer<typeof patchSchema>, req.actor.userId ?? null));
  });

  /** Run it now (for real), or dry with dry_run: true. */
  router.post("/companies/:companyId/automations/:routineId/run", validate(runSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, access, companyId);
    const routine = await ownAutomation(req, companyId, req.params.routineId as string);
    if (!routine) throw notFound("That automation is not on your dashboard.");
    const body = req.body as { input?: unknown; dry_run?: boolean };
    res.json({ result: await automations.runNow(routine, { payload: body.input ?? null, dryRun: body.dry_run === true }) });
  });

  router.get("/companies/:companyId/automations/:routineId/runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const routine = await ownAutomation(req, companyId, req.params.routineId as string);
    if (!routine) throw notFound("That automation is not on your dashboard.");
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? ""), 10) || 30, 100);
    res.json({ runs: await automations.listRuns(routine.id, limit) });
  });

  router.post("/companies/:companyId/automations/:routineId/hook/rotate", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManage(req, access, companyId);
    const routine = await ownAutomation(req, companyId, req.params.routineId as string);
    if (!routine) throw notFound("That automation is not on your dashboard.");
    res.json(await installs.rotateHook(routine));
  });

  // ----- Admin -----------------------------------------------------------

  /** The full palette, platform-only steps included. */
  router.get("/automations/admin/meta", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(automations.definitions.catalogue({}));
  });

  /** Recent step runs across every company, filterable (gcr /runs/recent). */
  router.get("/automations/admin/runs/recent", async (req, res) => {
    assertInstanceAdmin(req);
    const text = (key: string) => (typeof req.query[key] === "string" && String(req.query[key]).trim() ? String(req.query[key]).trim() : null);
    res.json(await automations.recentRuns({ companyId: text("companyId"), routineId: text("routineId"), status: text("status"), limit: Number.parseInt(String(req.query.limit ?? ""), 10) || 100 }));
  });

  return router;
}
