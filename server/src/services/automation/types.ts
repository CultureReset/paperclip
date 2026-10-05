import type { AutomationDefinition } from "@paperclipai/shared";

/**
 * The step runner's contracts (DECISIONS #81: one module per subsystem, one
 * entry point). The runner (runner.ts) is pure: everything that touches the
 * outside world — the business MCP, agents, the model gateway, mail and
 * texts, the clock, the database — comes in through `RunnerDeps` and
 * `RunRecorder`, so the same code runs in tests, in the parity dump and live.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunNotice {
  title: string;
  message: string;
  level: string;
}

export interface RunOutput {
  notices: RunNotice[];
  logs: string[];
}

export interface RunTrigger {
  type: string;
  payload: unknown;
}

/** The trigger as the run sees it: type, event name, the payload and its non-PII ref (ref.ts). */
export interface RunTriggerContext extends RunTrigger {
  event: string | null;
  ref: Record<string, unknown>;
}

export interface RunAutomationRef {
  id: string | null;
  key: string | null;
  version: string | number | null;
  name: string | null;
}

/** Facts about the business a step may template on; fetched through the business MCP, never stored. */
export interface RunBusiness {
  slug?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  [key: string]: unknown;
}

export interface RunContext {
  companyId: string;
  business: RunBusiness;
  config: Record<string, unknown>;
  trigger: RunTriggerContext;
  steps: Record<string, unknown>;
  now: string;
  output: RunOutput;
  automation: RunAutomationRef | null;
  runId: string | null;
  stepId?: string;
}

/** The business MCP (gcr-api-clean `POST /api/mcp`), called by contract name with the install's token. */
export interface BusinessMcp {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

export interface AgentHandoff {
  /** Which agent of this company: by id, by the store install that created it, or by the store item (and agent key). */
  installId?: string | null;
  agentId?: string | null;
  itemKey?: string | null;
  agentKey?: string | null;
  /** The non-PII body recorded as the agent's work (trigger refs, instructions, details). */
  body: Record<string, unknown>;
}

export interface AgentHandoffResult {
  accepted: boolean;
  agent_id: string;
  run: string | null;
  issue: string | null;
  routine_status: string | null;
}

export interface AiPromptRequest {
  task: string;
  prompt: string;
  system?: string;
  maxTokens: number;
}

export interface TextRequest {
  to: string;
  body: string;
  kind: string;
}

export interface EmailRequest {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  success: boolean;
  reason?: string;
  id?: string | null;
}

export interface RunnerDeps {
  /** Null when the install has no business-data token: data and message steps then fail with the reason. */
  mcp: BusinessMcp | null;
  agent: (handoff: AgentHandoff) => Promise<AgentHandoffResult>;
  ai: (request: AiPromptRequest) => Promise<{ text: string }>;
  notify: {
    /** E.164 numbers that are the business's own: its listed phone, the owner's notification phone, numbers it owns. */
    ownNumbers(): Promise<Set<string>>;
    normalizePhone(value: string): string | null;
    text(request: TextRequest): Promise<SendResult>;
    email(request: EmailRequest): Promise<SendResult>;
  };
  fetch: FetchLike;
  clock: () => Date;
  env: Record<string, string | undefined>;
}

export interface StepRunInput {
  /** The step's config with every {{ path }} rendered. */
  config: Record<string, unknown>;
  /** The step's config as written (scripts must not be templated). */
  raw: Record<string, unknown>;
  ctx: RunContext;
  dryRun: boolean;
  deps: RunnerDeps;
  /** Lines a step wants in the run log (scripts' console.log). */
  capture: (lines: string[]) => void;
}

export interface StepModule {
  type: string;
  run(input: StepRunInput): Promise<unknown>;
  /** When true for the output, the run stops as `skipped` (condition). */
  stopsWhen?: (out: unknown, config: Record<string, unknown>) => boolean;
}

export type StepLogStatus = "ok" | "dry_run" | "stopped" | "waiting" | "failed";

export interface StepLogEntry {
  id: string;
  type: string;
  name: string;
  status: StepLogStatus;
  ms: number;
  output?: unknown;
  error?: string;
}

export type RunStatus = "ok" | "skipped" | "waiting" | "failed";

export interface RunResult {
  status: RunStatus;
  error: string | null;
  dry_run: boolean;
  duration_ms: number;
  steps_log: StepLogEntry[];
  output: RunOutput;
  run_id?: string | null;
  /** An unrecorded run that reached a wait: reported, not saved. */
  waited?: { stepIndex: number; dueAt: string };
}

/** What the runner records for a recorded run; null when a dry run from a builder is not kept. */
export interface RunRecord {
  routineId: string;
  routineRevisionId: string | null;
  triggerId?: string | null;
  source: string;
  idempotencyKey?: string | null;
  automationKey?: string | null;
  automationName?: string | null;
  version?: string | number | null;
}

export interface RunResume {
  runId: string;
  stepIndex: number;
  steps: Record<string, unknown>;
  /** Steps already logged before the wait, so the finished run's log is one piece. */
  stepsLog: StepLogEntry[];
}

/** Persistence the runner needs; implemented over the database in index.ts, in memory in tests. */
export interface RunRecorder {
  createRun(input: { record: RunRecord; companyId: string; trigger: RunTrigger; dryRun: boolean; startedAt: Date }): Promise<string>;
  appendStep(input: { runId: string; companyId: string; position: number; entry: StepLogEntry }): Promise<void>;
  finishRun(input: { runId: string; status: RunStatus; error: string | null; output: RunOutput; durationMs: number; finishedAt: Date | null }): Promise<void>;
  saveWait(input: {
    runId: string;
    companyId: string;
    record: RunRecord;
    stepIndex: number;
    dueAt: string;
    context: { trigger: RunTriggerContext; steps: Record<string, unknown>; automation: RunAutomationRef | null };
  }): Promise<void>;
  touchRoutine(input: { routineId: string; lastRunAt: Date; lastRunStatus: RunStatus }): Promise<void>;
  notifyFailure(input: { companyId: string; runId: string | null; automationName: string | null; error: string }): Promise<void>;
}

export interface RunDefinitionOptions {
  definition: AutomationDefinition | Record<string, unknown>;
  companyId: string;
  business?: RunBusiness | null;
  trigger: RunTrigger;
  config?: Record<string, unknown> | null;
  dryRun?: boolean;
  /** Platform definitions may use admin-only steps; an owner's may not. */
  allowAdminSteps?: boolean;
  record?: RunRecord | null;
  resume?: RunResume | null;
  deps: RunnerDeps;
  recorder: RunRecorder | null;
}
