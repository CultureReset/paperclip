import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { automationService, type AutomationServiceOptions } from "../services/automation/index.js";
import { readNextgentConfig, type NextgentConfig } from "../services/nextgent-config.js";
import { requireNextgentSignature } from "./nextgent.js";

/**
 * Public routes of the automation subsystem, mounted next to the other
 * nextgent public routes (after the JSON parser that captures req.rawBody):
 *
 *   POST /api/nextgent/events        signed (contract §3); gcr-api-clean posts
 *                                    { companyId, event, eventId, occurredAt, ref }
 *                                    once per business event (DECISIONS #87).
 *                                    Fanned out to the company's active event
 *                                    triggers, idempotent on eventId. Answers
 *                                    202 always once the signature holds: a
 *                                    malformed envelope or an unknown company
 *                                    is reported as accepted: false, never
 *                                    retried by the sender.
 *   POST /api/automations/hook/:publicId   gcr's per-install webhook URL: the id
 *                                    is the credential (404 unknown, 202 when
 *                                    switched off, 400 when the definition is
 *                                    not webhook-triggered).
 */
export interface NextgentEventRouteOptions extends AutomationServiceOptions {
  config?: NextgentConfig;
}

export function nextgentEventRoutes(db: Db, options: NextgentEventRouteOptions = {}) {
  const router = Router();
  const config = options.config ?? readNextgentConfig();
  const automations = automationService(db, { ...options, config });
  const signed = requireNextgentSignature(config);

  router.post("/api/nextgent/events", signed, async (req, res) => {
    const parsed = automations.events.parse(req.body);
    if ("problems" in parsed) {
      res.status(202).json({ accepted: false, reason: "invalid", problems: parsed.problems, ran: 0, skipped: 0 });
      return;
    }
    const summary = await automations.fanOutEvent(parsed.event);
    res.status(202).json(summary);
  });

  router.post("/api/automations/hook/:publicId", async (req, res) => {
    const outcome = await automations.fireHook(String(req.params.publicId ?? ""), req.body ?? null);
    res.status(outcome.status).json(outcome.body);
  });

  return router;
}
