import { asObject } from "../template.js";
import type { StepModule } from "../types.js";
import { cleanValues, contractOf, requireMcp } from "./_data-common.js";

export const dataUpdate: StepModule = {
  type: "data.update",
  async run(input) {
    const { config, dryRun } = input;
    const table = contractOf(config);
    const values = cleanValues(asObject(config.values));
    if (!Object.keys(values).length) throw new Error("Nothing to change");
    if (config.id == null || config.id === "") throw new Error("No row id");
    if (dryRun) return { dry_run: true, would_update: { table, id: config.id, values } };
    const mcp = requireMcp(input);
    const result = await mcp.callTool<Record<string, unknown>>("update_row", { section: table, id: config.id, values });
    return { table, row: (result as { row?: unknown })?.row ?? result };
  },
};
