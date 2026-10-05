import { asObject } from "../template.js";
import type { StepModule } from "../types.js";
import { cleanValues, contractOf, requireMcp } from "./_data-common.js";

export const dataInsert: StepModule = {
  type: "data.insert",
  async run(input) {
    const { config, dryRun } = input;
    const table = contractOf(config);
    const values = cleanValues(asObject(config.values));
    if (dryRun) return { dry_run: true, would_insert: { table, values } };
    const mcp = requireMcp(input);
    const result = await mcp.callTool<Record<string, unknown>>("create_row", { section: table, values });
    return { table, row: (result as { row?: unknown })?.row ?? result };
  },
};
