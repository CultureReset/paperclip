import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { routineRevisions, routineRuns, routines } from "./routines.js";

/**
 * The step runner's records (DECISIONS #82): one row per step of a "steps"
 * routine run, and the saved state of a run paused at a wait step. The run
 * row itself is `routine_runs` (status running | waiting | completed |
 * skipped | failed); gcr-api-clean's `automation_runs.steps_log` becomes
 * these rows, `automation_waits` becomes `routine_waits`.
 */
export const routineRunSteps = pgTable(
  "routine_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => routineRuns.id, { onDelete: "cascade" }),
    /** Position in the run's log (resumed runs continue the count). */
    position: integer("position").notNull(),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    name: text("name").notNull(),
    /** ok | dry_run | stopped | waiting | failed — gcr-api-clean's step statuses. */
    status: text("status").notNull(),
    ms: integer("ms").notNull().default(0),
    /** The step's output, truncated at the runner's budget. */
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runPositionIdx: index("routine_run_steps_run_position_idx").on(table.runId, table.position),
    companyCreatedIdx: index("routine_run_steps_company_created_idx").on(table.companyId, table.createdAt),
  }),
);

export const routineWaits = pgTable(
  "routine_waits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id").notNull().references(() => routines.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => routineRuns.id, { onDelete: "cascade" }),
    /** The revision the run started on: a run is one version from start to end. */
    routineRevisionId: uuid("routine_revision_id").references(() => routineRevisions.id, { onDelete: "set null" }),
    /** Index of the step to resume at. */
    stepIndex: integer("step_index").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** waiting | running | done | failed | cancelled. Claimed waiting → running before it resumes. */
    state: text("state").notNull().default("waiting"),
    /** { trigger, steps, automation }: the run context so far. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stateDueIdx: index("routine_waits_state_due_idx").on(table.state, table.dueAt),
    routineIdx: index("routine_waits_routine_idx").on(table.routineId),
    runIdx: index("routine_waits_run_idx").on(table.runId),
  }),
);
