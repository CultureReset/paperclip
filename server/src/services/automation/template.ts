/**
 * Templating and the pure helpers of the step runner, ported verbatim from
 * gcr-api-clean `lib/automationEngine.js` (DECISIONS #82: identical semantics).
 *
 * Any string in a step's configuration may carry {{ paths }} into the run
 * context:
 *
 *     {{ business.name }}          the business
 *     {{ config.reminder_phone }}  a setting the business filled in
 *     {{ trigger.payload.x }}      what fired the run (webhook body, event ref)
 *     {{ steps.query.rows.0.name }} an earlier step's output, by its id
 *     {{ now }}                    ISO timestamp
 *
 * A string that is exactly one {{ path }} resolves to the raw value, so an
 * object or an array can be passed whole from one step to the next.
 */

const PATH = /\{\{\s*([A-Za-z0-9_$.\-]+)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_$.\-]+)\s*\}\}\s*$/;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of String(path).split(".")) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function render(template: unknown, ctx: unknown): unknown {
  if (typeof template !== "string") return template;
  const whole = template.match(WHOLE);
  if (whole) return getPath(ctx, whole[1]);
  return template.replace(PATH, (_, p: string) => {
    const v = getPath(ctx, p);
    if (v == null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/** Apply render() to every string leaf of a value. */
export function renderDeep(value: unknown, ctx: unknown): unknown {
  if (typeof value === "string") return render(value, ctx);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderDeep(v, ctx);
    return out;
  }
  return value;
}

/** A step's config field may be a JSON string (typed in the builder) or a value. */
export function asObject(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export type CompareOp = "eq" | "ne" | "gt" | "lt" | "contains" | "empty" | "not_empty" | "truthy";

export function compare(left: unknown, op: string, right?: unknown): boolean {
  const l = left;
  const r = right;
  const num = (v: unknown) => (v === "" || v == null ? NaN : Number(v));
  switch (op) {
    case "eq": return String(l ?? "") === String(r ?? "") || (Number.isFinite(num(l)) && num(l) === num(r));
    case "ne": return !compare(l, "eq", r);
    case "gt": return num(l) > num(r);
    case "lt": return num(l) < num(r);
    case "contains": return String(l ?? "").toLowerCase().includes(String(r ?? "").toLowerCase());
    case "empty": return l == null || l === "" || (Array.isArray(l) && !l.length);
    case "not_empty": return !compare(l, "empty", r);
    case "truthy": return !!l && l !== "false" && l !== "0";
    default: throw new Error(`Unknown check: ${op}`);
  }
}

/** Output budget in characters: AUTOMATION_OUTPUT_BUDGET, default 8000 (gcr's 8 KB). */
export function outputBudget(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AUTOMATION_OUTPUT_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8000;
}

/** Keep run logs a sensible size — a 500-row query result is not worth storing whole. */
export function truncate(value: unknown, budget = outputBudget()): unknown {
  try {
    const text = JSON.stringify(value);
    if (!text || text.length <= budget) return value;
    return { truncated: true, preview: text.slice(0, budget) };
  } catch {
    return String(value);
  }
}

export interface ConfigSchemaField {
  key?: string;
  type?: string;
  default?: unknown;
}

/** Merge the config_schema defaults with what the business chose. */
export function resolveConfig(schema: unknown, chosen: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of Array.isArray(schema) ? (schema as ConfigSchemaField[]) : []) {
    if (!field?.key) continue;
    out[field.key] = field.default ?? (field.type === "boolean" ? false : "");
  }
  for (const [k, v] of Object.entries(chosen ?? {})) {
    if (k in out) out[k] = v;
  }
  return out;
}

/** True for `true` and the string "true" (a builder's boolean field may arrive as text). */
export function truthyFlag(value: unknown): boolean {
  return value === true || value === "true";
}
