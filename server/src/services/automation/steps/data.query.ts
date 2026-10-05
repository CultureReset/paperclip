import { asObject } from "../template.js";
import type { StepModule } from "../types.js";
import { contractOf, requireMcp, ROW_LIMIT } from "./_data-common.js";

interface SectionRows {
  section?: string;
  rows?: Record<string, unknown>[];
}

/**
 * Rows from one contract through `read_section`. gcr applied filter, order
 * and limit in its query; the MCP reads by section and search only, so the
 * same filter/order/limit are applied to what it returns.
 */
export const dataQuery: StepModule = {
  type: "data.query",
  async run(input) {
    const { config } = input;
    const table = contractOf(config);
    const limit = Math.min(Math.max(Number(config.limit) || 100, 1), ROW_LIMIT);
    const mcp = requireMcp(input);
    const result = await mcp.callTool<SectionRows>("read_section", { section: table, limit: ROW_LIMIT });
    let rows = Array.isArray(result?.rows) ? result.rows : [];
    for (const [col, val] of Object.entries(asObject(config.filter))) {
      if (col === "entity_slug") continue;
      rows = rows.filter((row) => (val === null ? row[col] == null : row[col] === val));
    }
    if (config.order_by) {
      const key = String(config.order_by);
      const ascending = config.descending === false;
      rows = [...rows].sort((a, b) => {
        const l = a[key] as string | number | null | undefined;
        const r = b[key] as string | number | null | undefined;
        if (l === r) return 0;
        if (l == null) return 1;
        if (r == null) return -1;
        const cmp = l < r ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    rows = rows.slice(0, limit);
    return { table, rows, count: rows.length };
  },
};
