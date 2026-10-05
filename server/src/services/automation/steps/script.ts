import vm from "node:vm";
import type { RunContext, StepModule } from "../types.js";

/**
 * Admin-authored JavaScript in a vm context with only the run in scope. A
 * guard against mistakes — an infinite loop, a typo that reaches for
 * `process` — not against a hostile author: only the platform's builder has
 * this step (adminOnly in the catalogue; refused in owner definitions).
 * Time limit: AUTOMATION_SCRIPT_TIMEOUT_MS, default 2000.
 */
export function scriptTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AUTOMATION_SCRIPT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

export function runScript(code: string, ctx: Pick<RunContext, "trigger" | "config" | "steps" | "business" | "now">, capture?: (lines: string[]) => void, timeoutMs = scriptTimeoutMs()): unknown {
  const logs: string[] = [];
  const sandbox = {
    __args: {
      input: (ctx.trigger?.payload as unknown) ?? null,
      config: ctx.config,
      steps: ctx.steps,
      business: ctx.business,
      trigger: ctx.trigger,
      now: ctx.now,
    },
    console: { log: (...a: unknown[]) => logs.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")) },
    JSON,
    Math,
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const wrapped = `(function () {
        const __fn = function (input, config, steps, business, trigger, now) {\n${code}\n};
        return __fn(__args.input, __args.config, __args.steps, __args.business, __args.trigger, __args.now);
    })()`;
  let result: unknown;
  try {
    result = new vm.Script(wrapped, { filename: "automation-step.js" }).runInContext(context, { timeout: timeoutMs });
  } catch (e) {
    throw new Error(`Script error: ${(e as Error).message}`);
  }
  if (capture && logs.length) capture(logs);
  // Copy out of the vm realm so the value is plain data.
  return result === undefined ? null : JSON.parse(JSON.stringify(result));
}

export const script: StepModule = {
  type: "script",
  async run({ raw, ctx, capture, deps }) {
    return runScript(String(raw.code ?? ""), ctx, capture, scriptTimeoutMs(deps.env));
  },
};
