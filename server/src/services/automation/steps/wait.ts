import type { StepModule } from "../types.js";

/** AUTOMATION_WAIT_MAX_MINUTES: the longest a wait step may ask for; 0 or unset means no limit. */
export function waitMaxMinutes(env: Record<string, string | undefined>): number {
  const n = Number(env.AUTOMATION_WAIT_MAX_MINUTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Pause the run. The runner sees `pausesRun` on the catalogue entry and saves
 * the run in routine_waits instead of going on; the scheduled check resumes
 * it at the next step when it is due.
 */
export const wait: StepModule = {
  type: "wait",
  async run({ config, dryRun, deps }) {
    const minutes = Number(config.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Minutes must be a positive number");
    const maxMinutes = waitMaxMinutes(deps.env);
    if (maxMinutes && minutes > maxMinutes) throw new Error(`A wait can be at most ${maxMinutes} minutes`);
    const dueAt = new Date(deps.clock().getTime() + minutes * 60 * 1000).toISOString();
    if (dryRun) return { dry_run: true, would_wait: { minutes, due_at: dueAt } };
    return { minutes, due_at: dueAt };
  },
};
