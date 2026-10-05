import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { routineRevisions, routineRunSteps, routineRuns, routineWaits, routines } from "@paperclipai/db";
import type { RunResult, RunResume, RunTrigger, StepLogEntry } from "./types.js";

/**
 * Waits (gcr `resumeWaits`): a run paused at a wait step is a routine_waits
 * row — the step to resume at, the context so far, when it is due. The
 * scheduled check claims each due wait (waiting → running) before it runs,
 * so two checks at once cannot both resume it; a wait whose routine was
 * switched off or removed is cancelled, not run; and the run resumes on the
 * revision it started on, even if the install moved on since.
 */
export type WaitRow = typeof routineWaits.$inferSelect;

export interface ResumeInput {
  wait: WaitRow;
  routine: typeof routines.$inferSelect;
  definition: Record<string, unknown>;
  trigger: RunTrigger;
  resume: RunResume;
}

export interface ResumeSummary {
  due: number;
  resumed: number;
  cancelled: number;
  failed: number;
  error?: string;
}

/** AUTOMATION_RESUME_LIMIT: waits resumed per tick (default 100). */
export function resumeLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AUTOMATION_RESUME_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

export function automationWaits(db: Db) {
  async function stepLogFor(runId: string): Promise<StepLogEntry[]> {
    const rows = await db.select().from(routineRunSteps).where(eq(routineRunSteps.runId, runId)).orderBy(asc(routineRunSteps.position));
    return rows.map((row) => ({
      id: row.stepId,
      type: row.stepType,
      name: row.name,
      status: row.status as StepLogEntry["status"],
      ms: row.ms,
      ...(row.output !== null && row.output !== undefined ? { output: row.output } : {}),
      ...(row.error ? { error: row.error } : {}),
    }));
  }

  async function pinnedDefinition(wait: WaitRow, routine: typeof routines.$inferSelect): Promise<Record<string, unknown> | null> {
    if (wait.routineRevisionId) {
      const revision = await db.select({ definition: routineRevisions.definition }).from(routineRevisions).where(eq(routineRevisions.id, wait.routineRevisionId)).then((rows) => rows[0] ?? null);
      if (revision?.definition) return revision.definition as Record<string, unknown>;
    }
    return (routine.definition as Record<string, unknown> | null) ?? null;
  }

  return {
    stepLogFor,

    /**
     * Carry on every wait that is due. `run` executes one resumed run and
     * answers with its result; this module does the claiming, the cancelling
     * and the bookkeeping around it.
     */
    async resumeDue(input: { now?: Date; limit?: number; run: (resume: ResumeInput) => Promise<RunResult> }): Promise<ResumeSummary> {
      const now = input.now ?? new Date();
      const limit = input.limit ?? resumeLimit();
      const summary: ResumeSummary = { due: 0, resumed: 0, cancelled: 0, failed: 0 };
      let due: WaitRow[];
      try {
        due = await db.select().from(routineWaits).where(and(eq(routineWaits.state, "waiting"), lte(routineWaits.dueAt, now))).orderBy(asc(routineWaits.dueAt)).limit(limit);
      } catch (error) {
        return { ...summary, error: (error as Error).message };
      }

      for (const wait of due) {
        summary.due += 1;
        const claimed = await db
          .update(routineWaits)
          .set({ state: "running", resumedAt: now, updatedAt: now })
          .where(and(eq(routineWaits.id, wait.id), eq(routineWaits.state, "waiting")))
          .returning({ id: routineWaits.id });
        if (!claimed.length) continue;

        const routine = await db.select().from(routines).where(eq(routines.id, wait.routineId)).then((rows) => rows[0] ?? null);
        const definition = routine ? await pinnedDefinition(wait, routine) : null;
        if (!routine || routine.status !== "active" || routine.companyId !== wait.companyId || !definition) {
          await db.update(routineWaits).set({ state: "cancelled", updatedAt: now }).where(eq(routineWaits.id, wait.id));
          await db.update(routineRuns).set({ status: "skipped", failureReason: "Switched off while waiting", completedAt: now, updatedAt: now }).where(eq(routineRuns.id, wait.runId));
          summary.cancelled += 1;
          continue;
        }

        const context = (wait.context ?? {}) as { trigger?: RunTrigger; steps?: Record<string, unknown> };
        let result: RunResult;
        try {
          result = await input.run({
            wait,
            routine,
            definition,
            trigger: context.trigger ?? { type: "resume", payload: null },
            resume: { runId: wait.runId, stepIndex: wait.stepIndex, steps: context.steps ?? {}, stepsLog: await stepLogFor(wait.runId) },
          });
        } catch (error) {
          await db.update(routineWaits).set({ state: "failed", updatedAt: now }).where(eq(routineWaits.id, wait.id));
          await db.update(routineRuns).set({ status: "failed", failureReason: (error as Error).message, completedAt: now, updatedAt: now }).where(eq(routineRuns.id, wait.runId));
          summary.failed += 1;
          continue;
        }
        await db.update(routineWaits).set({ state: result.status === "failed" ? "failed" : "done", updatedAt: now }).where(eq(routineWaits.id, wait.id));
        if (result.status === "failed") summary.failed += 1;
        else summary.resumed += 1;
      }
      return summary;
    },

    /** Cancel every pending wait of a routine (the install was switched off or removed). */
    async cancelForRoutine(routineId: string, reason = "Switched off while waiting") {
      const now = new Date();
      const pending = await db.update(routineWaits).set({ state: "cancelled", updatedAt: now }).where(and(eq(routineWaits.routineId, routineId), eq(routineWaits.state, "waiting"))).returning({ runId: routineWaits.runId });
      for (const row of pending) {
        await db.update(routineRuns).set({ status: "skipped", failureReason: reason, completedAt: now, updatedAt: now }).where(eq(routineRuns.id, row.runId));
      }
      return pending.length;
    },
  };
}

export type AutomationWaits = ReturnType<typeof automationWaits>;
