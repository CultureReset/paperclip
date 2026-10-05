import { runDefinition } from "./runner.js";
import { refFor, triggerContext } from "./ref.js";
import type { BusinessMcp, RunnerDeps, RunResult } from "./types.js";

/**
 * The parity dump (DECISIONS #91): Paperclip's half of the proof that the
 * two engines run the same definition and the same event the same way. The
 * shape, the volatile fields and the sorting are gcr-api-clean's
 * `scripts/parity-dump.js` (shape version 1), so a diff of the two files is
 * the comparison. No database, no network: the runner's deps are built from
 * the same seed file gcr's dump reads ({ slug, config, tables }), and every
 * side-effecting step reports what it WOULD do.
 */

export const PARITY_SHAPE_VERSION = 1;
const VOLATILE = new Set(["ms", "duration_ms", "run_id", "at", "now", "due_at", "expires_at", "created_at", "updated_at", "timestamp", "nonce"]);
const VOLATILE_PATTERN = /^x-paperclip-(timestamp|signature)$/i;

/** Sorted keys, volatile fields removed, at every depth. */
export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE.has(key) || VOLATILE_PATTERN.test(key)) continue;
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value === undefined ? null : value;
}

export interface ParitySeed {
  slug?: string;
  config?: Record<string, unknown>;
  tables?: Record<string, Record<string, unknown>[]>;
}

type Row = Record<string, unknown>;

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (value.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** A business MCP answering from the seed's tables, scoped to the slug like gcr's token resolution. */
function seedMcp(tables: Record<string, Row[]>, slug: string): BusinessMcp {
  const rowsOf = (section: string) => {
    if (!Object.prototype.hasOwnProperty.call(tables, section)) throw new Error(`Not a business table: ${section}`);
    return (tables[section] ?? []).filter((row) => row.entity_slug === slug);
  };
  return {
    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      if (name === "read_section") return { section: args.section, rows: rowsOf(String(args.section)) } as T;
      throw new Error(`parity dump: ${name} is not called in a dry run`);
    },
  };
}

/** Runner deps for a dry run against a seed: the clock is fixed so a wait's due time cannot differ between runs. */
export function seedDeps(seed: ParitySeed, slug: string): RunnerDeps {
  const tables = seed.tables ?? {};
  const entity = (tables.entity ?? []).find((row) => row.slug === slug) ?? null;
  const notifySettings = (tables.owner_notify_settings ?? []).find((row) => row.entity_slug === slug) ?? null;
  const numbers = (tables.business_phone_numbers ?? []).filter((row) => row.entity_slug === slug && row.status === "active");
  const own = new Set<string>();
  for (const raw of [entity?.phone, notifySettings?.phone, ...numbers.map((n) => n.phone_number)]) {
    const normalized = typeof raw === "string" ? normalizePhone(raw) : null;
    if (normalized) own.add(normalized);
  }
  const refuse = (what: string) => async (): Promise<never> => { throw new Error(`parity dump: ${what} is not called in a dry run`); };
  return {
    mcp: seedMcp(tables, slug),
    agent: refuse("the agent hand-off"),
    ai: refuse("the model gateway"),
    notify: {
      ownNumbers: async () => own,
      normalizePhone,
      text: refuse("a platform text"),
      email: refuse("a platform email"),
    },
    fetch: refuse("fetch") as unknown as RunnerDeps["fetch"],
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    env: { DEFAULT_TIMEZONE: "UTC" },
  };
}

export interface ParityDump {
  parity: number;
  engine: "paperclip";
  definition: { name: string | null; trigger: unknown };
  trigger: { type: string; event: string | null; ref: Record<string, unknown> };
  result: {
    status: RunResult["status"];
    error: string | null;
    dry_run: true;
    waited: { stepIndex: number } | null;
    steps: Array<{ id: string; type: string; name: string; status: string; output: unknown; error?: string }>;
    output: RunResult["output"];
  };
}

/** Run the definition dry against the seed and build the stable dump. */
export async function parityDump(definition: Record<string, unknown>, event: { type?: string; payload?: unknown } | null, seed: ParitySeed = {}, options: { slug?: string } = {}): Promise<ParityDump> {
  const tables = seed.tables ?? {};
  const slug = options.slug || seed.slug || (tables.entity?.[0]?.slug as string | undefined) || "shop";
  const entity = (tables.entity ?? []).find((row) => row.slug === slug) ?? { slug };
  const trigger = { type: event?.type || "manual", payload: event?.payload ?? null };
  const result = await runDefinition({
    definition,
    companyId: "parity",
    business: entity,
    trigger,
    config: seed.config ?? {},
    dryRun: true,
    allowAdminSteps: true,
    deps: seedDeps(seed, slug),
    recorder: null,
  });
  const context = triggerContext(trigger);
  const definitionTrigger = (definition?.trigger ?? null) as { type?: string; event?: string } | null;
  const eventName = context.event ?? (definitionTrigger?.type === "event" ? definitionTrigger.event ?? null : null);
  return stable({
    parity: PARITY_SHAPE_VERSION,
    engine: "paperclip",
    definition: { name: (definition?.name as string | undefined) || null, trigger: definition?.trigger ?? null },
    trigger: { type: trigger.type, event: eventName, ref: context.ref ?? refFor(eventName, trigger.payload) },
    result: {
      status: result.status,
      error: result.error ?? null,
      dry_run: true,
      waited: result.waited ? { stepIndex: result.waited.stepIndex } : null,
      steps: result.steps_log.map((s) => ({ id: s.id, type: s.type, name: s.name, status: s.status, output: s.output ?? null, ...(s.error ? { error: s.error } : {}) })),
      output: result.output ?? { notices: [], logs: [] },
    },
  }) as ParityDump;
}
