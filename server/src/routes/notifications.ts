import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { NOTIFICATION_KINDS, notifyService, type NotifyServiceOptions } from "../services/notify/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

/**
 * Owner notification settings and the recent log (DECISIONS #85), the port of
 * gcr-api-clean routes/notify-settings.js. The company comes from the URL and
 * is checked against the session; a member reads, a non-viewer writes.
 */
const settingsSchema = z.object({
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email_on: z.boolean().optional(),
  sms_on: z.boolean().optional(),
  muted_kinds: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export function notificationRoutes(db: Db, options: NotifyServiceOptions = {}) {
  const router = Router();
  const notify = notifyService(db, options);

  router.get("/companies/:companyId/notifications/settings", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json({ settings: await notify.getSettings(companyId), kinds: [...NOTIFICATION_KINDS], recent: await notify.recent(companyId, 20) });
  });

  router.put("/companies/:companyId/notifications/settings", validate(settingsSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json({ settings: await notify.updateSettings(companyId, req.body as z.infer<typeof settingsSchema>, req.actor.userId ?? null) });
  });

  router.get("/companies/:companyId/notifications/recent", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? ""), 10) || 20, 1), 100);
    res.json({ recent: await notify.recent(companyId, limit) });
  });

  return router;
}
