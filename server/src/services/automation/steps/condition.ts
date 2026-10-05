import { compare } from "../template.js";
import type { StepModule } from "../types.js";

/** Compare two values; when the check fails the run stops as skipped (or carries on with on_fail = continue). */
export const condition: StepModule = {
  type: "condition",
  async run({ config }) {
    const passed = compare(config.left, String(config.op), config.right);
    return { passed, left: config.left, right: config.right };
  },
  stopsWhen: (out, config) => !(out as { passed: boolean }).passed && config.on_fail !== "continue",
};
