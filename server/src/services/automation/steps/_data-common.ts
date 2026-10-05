import type { BusinessMcp, StepRunInput } from "../types.js";

/**
 * Shared by the three data steps, which go through the business MCP by
 * contract name (DECISIONS #45): `read_section`, `create_row`, `update_row`
 * with the install's token. The business is the token's, never named by the
 * definition — a step cannot read or write another business's rows, no
 * matter what its configuration says.
 */

/** The contract a data step names: `contract` (DECISIONS #45) or gcr's `table` key, which carries the same value here. */
export function contractOf(config: Record<string, unknown>): string {
  const value = config.contract ?? config.table;
  const name = value == null ? "" : String(value).trim();
  if (!name) throw new Error("Not a business table: ");
  return name;
}

export function requireMcp(input: StepRunInput): BusinessMcp {
  if (!input.deps.mcp) throw new Error("This automation's install has no business-data token, so it cannot reach the business's data");
  return input.deps.mcp;
}

/** Columns the server stamps; a definition never sets them (gcr cleanBody SYSTEM_COLUMNS). */
const SYSTEM_COLUMNS = new Set(["id", "entity_slug", "created_at"]);

export function cleanValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (!SYSTEM_COLUMNS.has(k)) out[k] = v;
  return out;
}

export const ROW_LIMIT = 500;
