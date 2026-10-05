import { renderDeep, resolveConfig, truncate, outputBudget } from "./template.js";
import { triggerContext } from "./ref.js";
import { stepDescriptor, stepModule } from "./steps/registry.js";
import type {
  RunContext,
  RunDefinitionOptions,
  RunResult,
  RunStatus,
  StepLogEntry,
} from "./types.js";

/**
 * Execute one automation definition for one company — the port of
 * gcr-api-clean `runDefinition` (lib/automationEngine.js :698-858), with the
 * same statuses, step log shape, dry-run reporting, continue_on_error,
 * stopsWhen and output truncation (DECISIONS #82, #91).
 *
 * A recorded run gets its row first, so steps can name it (the agent step
 * sends it with the hand-off; a wait saves against it). Unrecorded runs
 * (tests from a builder, the parity dump) never wait: there is nothing to
 * resume them against.
 */
export async function runDefinition(opts: RunDefinitionOptions): Promise<RunResult> {
  const { deps, recorder } = opts;
  const dryRun = opts.dryRun === true;
  const record = opts.record ?? null;
  const resume = opts.resume ?? null;
  const definition = (opts.definition ?? {}) as Record<string, unknown>;
  const steps = Array.isArray(definition.steps) ? (definition.steps as Record<string, unknown>[]) : [];
  const startedAt = deps.clock();
  const started = startedAt.getTime();
  const budget = outputBudget(deps.env);

  const ctx: RunContext = {
    companyId: opts.companyId,
    business: opts.business ?? {},
    config: resolveConfig(definition.config_schema, opts.config ?? null),
    trigger: triggerContext(opts.trigger),
    steps: resume?.steps ? { ...resume.steps } : {},
    now: startedAt.toISOString(),
    output: { notices: [], logs: [] },
    automation: record
      ? {
          id: record.routineId,
          key: record.automationKey ?? null,
          version: record.version ?? null,
          name: record.automationName ?? (typeof definition.name === "string" ? definition.name : null),
        }
      : null,
    runId: resume?.runId ?? null,
  };

  if (record && recorder && !resume) {
    ctx.runId = await recorder.createRun({ record, companyId: opts.companyId, trigger: ctx.trigger, dryRun, startedAt });
  }

  const stepsLog: StepLogEntry[] = Array.isArray(resume?.stepsLog) ? resume.stepsLog.slice() : [];
  let position = stepsLog.length;
  let status: RunStatus = "ok";
  let error: string | null = null;
  let waiting: { stepIndex: number; dueAt: string } | null = null;

  const logStep = async (entry: StepLogEntry) => {
    stepsLog.push(entry);
    if (record && recorder && ctx.runId) {
      await recorder.appendStep({ runId: ctx.runId, companyId: opts.companyId, position, entry });
    }
    position += 1;
  };

  for (let i = resume ? resume.stepIndex : 0; i < steps.length; i += 1) {
    const step = steps[i] ?? {};
    if (step.enabled === false) continue;
    const id = String(step.id || `step_${i + 1}`);
    const module = stepModule(step.type);
    const descriptor = stepDescriptor(step.type);
    const entry: StepLogEntry = { id, type: String(step.type), name: String(step.name || descriptor?.label || step.type), status: "ok", ms: 0 };
    const t0 = deps.clock().getTime();
    ctx.stepId = id;

    try {
      if (!module || !descriptor) throw new Error(`Unknown step type: ${String(step.type)}`);
      if (descriptor.adminOnly && opts.allowAdminSteps !== true) {
        throw new Error(`"${descriptor.label}" is only available to the platform.`);
      }
      const raw = (step.config && typeof step.config === "object" ? step.config : {}) as Record<string, unknown>;
      const rendered = renderDeep(raw, ctx) as Record<string, unknown>;
      const out = await module.run({
        config: rendered,
        raw,
        ctx,
        dryRun,
        deps,
        capture: (lines) => ctx.output.logs.push(...lines.map((l) => `[${id}] ${l}`)),
      });
      ctx.steps[id] = out;
      entry.output = truncate(out, budget);
      if (dryRun && descriptor.sideEffect) entry.status = "dry_run";
      if (typeof module.stopsWhen === "function" && module.stopsWhen(out, rendered)) {
        entry.status = "stopped";
        entry.ms = deps.clock().getTime() - t0;
        await logStep(entry);
        status = "skipped";
        break;
      }
      if (descriptor.pausesRun && !dryRun) {
        entry.status = "waiting";
        entry.ms = deps.clock().getTime() - t0;
        await logStep(entry);
        waiting = { stepIndex: i + 1, dueAt: String((out as { due_at: string }).due_at) };
        status = "waiting";
        break;
      }
    } catch (e) {
      entry.status = "failed";
      entry.error = (e as Error).message;
      entry.ms = deps.clock().getTime() - t0;
      await logStep(entry);
      if (step.continue_on_error) continue;
      status = "failed";
      error = `${entry.name}: ${(e as Error).message}`;
      break;
    }
    entry.ms = deps.clock().getTime() - t0;
    await logStep(entry);
  }
  delete ctx.stepId;

  const result: RunResult = {
    status,
    error,
    dry_run: dryRun,
    duration_ms: deps.clock().getTime() - started,
    steps_log: stepsLog,
    output: ctx.output,
  };

  if (waiting && !(record && recorder)) {
    // Unrecorded runs do not wait: there is nothing to resume them against.
    result.status = "ok";
    result.waited = waiting;
  }

  if (record && recorder) {
    const runId = ctx.runId;
    result.run_id = runId;
    if (runId) {
      await recorder.finishRun({
        runId,
        status,
        error,
        output: ctx.output,
        durationMs: result.duration_ms,
        finishedAt: status === "waiting" ? null : deps.clock(),
      });
      if (waiting) {
        try {
          await recorder.saveWait({
            runId,
            companyId: opts.companyId,
            record,
            stepIndex: waiting.stepIndex,
            dueAt: waiting.dueAt,
            context: { trigger: ctx.trigger, steps: ctx.steps, automation: ctx.automation },
          });
        } catch (waitError) {
          result.status = "failed";
          result.error = `Could not save the wait: ${(waitError as Error).message}`;
          await recorder.finishRun({ runId, status: "failed", error: result.error, output: ctx.output, durationMs: result.duration_ms, finishedAt: deps.clock() });
        }
      }
    }
    if (!dryRun) {
      await recorder.touchRoutine({ routineId: record.routineId, lastRunAt: deps.clock(), lastRunStatus: result.status });
    }
    if (result.status === "failed" && !dryRun) {
      await recorder.notifyFailure({
        companyId: opts.companyId,
        runId,
        automationName: ctx.automation?.name ?? null,
        error: String(result.error ?? "").slice(0, 500),
      });
    }
  }

  return result;
}
