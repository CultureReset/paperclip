import { asObject } from "../template.js";
import type { StepModule } from "../types.js";

/** Named values from templates, for later steps as {{ steps.<id>.<name> }}. */
export const transform: StepModule = {
  type: "transform",
  async run({ config }) {
    return asObject(config.assign);
  },
};
