import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, routineRuns, routineTriggers, routines } from "@paperclipai/db";
import { isUuidLike, nextgentEventSchema, type NextgentEvent } from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";
import type { RunResult } from "./types.js";

/**
 * The inbound event router (DECISIONS #87): gcr-api-clean posts each business
 * event once, signed, as { companyId, event, eventId, occurredAt, ref }; this
 * fans it out to the company's active routines with an `event` trigger for
 * that name. Idempotent on eventId (a retry that crossed a late answer runs
 * nothing twice). Never throws: the sender always gets 202.
 */
export interface FanOutSummary {
  accepted: boolean;
  reason?: string;
  problems?: string[];
  ran: number;
  skipped: number;
  runs: Array<{ routineId: string; triggerId: string; status: string; runId: string | null }>;
}

export interface EventRunInput {
  routine: typeof routines.$inferSelect;
  trigger: typeof routineTriggers.$inferSelect;
  event: NextgentEvent;
}

export function automationEvents(db: Db) {
  return {
    /** Parse the envelope; problems are reported, never thrown. */
    parse(body: unknown): { event: NextgentEvent } | { problems: string[] } {
      const parsed = nextgentEventSchema.safeParse(body);
      if (parsed.success) return { event: parsed.data };
      return { problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`) };
    },

    /** The company's active event-triggered step routines listening for `event`. */
    async listeners(companyId: string, event: string) {
      return db
        .select({ trigger: routineTriggers, routine: routines })
        .from(routineTriggers)
        .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
        .where(and(
          eq(routineTriggers.companyId, companyId),
          eq(routineTriggers.kind, "event"),
          eq(routineTriggers.enabled, true),
          eq(routineTriggers.archived, false),
          eq(routineTriggers.eventName, event),
          eq(routines.status, "active"),
          eq(routines.mode, "steps"),
        ));
    },

    async fanOut(event: NextgentEvent, run: (input: EventRunInput) => Promise<RunResult>): Promise<FanOutSummary> {
      const summary: FanOutSummary = { accepted: true, ran: 0, skipped: 0, runs: [] };
      try {
        if (!isUuidLike(event.companyId)) return { ...summary, accepted: false, reason: "unknown_company" };
        const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, event.companyId)).then((rows) => rows[0] ?? null);
        if (!company) return { ...summary, accepted: false, reason: "unknown_company" };
        const listening = await this.listeners(event.companyId, event.event);
        for (const { trigger, routine } of listening) {
          const existing = await db
            .select({ id: routineRuns.id })
            .from(routineRuns)
            .where(and(eq(routineRuns.routineId, routine.id), eq(routineRuns.source, "event"), eq(routineRuns.idempotencyKey, event.eventId)))
            .limit(1);
          if (existing.length) {
            summary.skipped += 1;
            summary.runs.push({ routineId: routine.id, triggerId: trigger.id, status: "duplicate", runId: existing[0].id });
            continue;
          }
          try {
            const result = await run({ routine, trigger, event });
            summary.ran += 1;
            summary.runs.push({ routineId: routine.id, triggerId: trigger.id, status: result.status, runId: result.run_id ?? null });
          } catch (error) {
            // One routine's failure must not fail the others, nor the sender.
            logger.error({ err: error, routineId: routine.id, event: event.event }, "event fan-out: a routine run failed");
            summary.runs.push({ routineId: routine.id, triggerId: trigger.id, status: "failed", runId: null });
          }
        }
        return summary;
      } catch (error) {
        logger.error({ err: error, companyId: event.companyId, event: event.event }, "event fan-out failed");
        return { ...summary, accepted: false, reason: "error" };
      }
    },
  };
}

export type AutomationEvents = ReturnType<typeof automationEvents>;
