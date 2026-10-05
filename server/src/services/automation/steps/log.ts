import type { StepModule } from "../types.js";

/** A line in the run log. */
export const log: StepModule = {
  type: "log",
  async run({ config }) {
    return { message: String(config.message ?? "") };
  },
};
