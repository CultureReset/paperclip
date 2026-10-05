import { z } from "zod";
import {
  AUTOMATION_CONFIG_FIELD_TYPES,
  AUTOMATION_SCHEDULE_EVERY,
  AUTOMATION_TRIGGER_TYPES,
  automationStepDescriptor,
  type AutomationKnownEvent,
} from "../automation-catalogue.js";

/**
 * An automation definition — a trigger, an ordered list of steps and the
 * settings a business may fill in (SPEC §7 "automations are data"). The zod
 * schema checks the SHAPE loosely so a draft can be saved mid-edit;
 * `validateAutomationDefinition` is the port of gcr-api-clean's
 * `validateDefinition` and lists the problems a builder shows and a publish
 * refuses.
 */

export const AUTOMATION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const AUTOMATION_STEP_ID_PATTERN = /^[a-z0-9_]{1,40}$/i;
export const AUTOMATION_CONFIG_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

export const automationTriggerSchema = z
  .object({
    type: z.enum(AUTOMATION_TRIGGER_TYPES.map((t) => t.type) as [string, ...string[]]),
    /** schedule: hour | day | week (default day). */
    every: z.string().optional(),
    /** schedule: "HH:MM"; minutes are ignored (checked hourly). */
    at: z.string().optional(),
    /** schedule, weekly: 0 (Sunday) – 6. */
    day_of_week: z.number().int().min(0).max(6).optional(),
    /** schedule: IANA zone; the business's own when it has one. */
    timezone: z.string().optional(),
    /** event: the event name listened for. */
    event: z.string().optional(),
  })
  .passthrough();

export const automationStepSchema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    continue_on_error: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .passthrough();

export const automationConfigFieldSchema = z
  .object({
    key: z.string(),
    label: z.string().optional(),
    type: z.string().optional(),
    help: z.string().optional(),
    required: z.boolean().optional(),
    options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])).optional(),
    placeholder: z.string().optional(),
    default: z.unknown().optional(),
  })
  .passthrough();

export const automationDefinitionSchema = z
  .object({
    name: z.string().optional(),
    key: z.string().optional(),
    description: z.string().nullish(),
    icon: z.string().nullish(),
    category: z.string().nullish(),
    kind: z.string().nullish(),
    trigger: automationTriggerSchema,
    steps: z.array(automationStepSchema),
    config_schema: z.array(automationConfigFieldSchema).optional().default([]),
  })
  .passthrough();

export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;
export type AutomationStep = z.infer<typeof automationStepSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationConfigField = z.infer<typeof automationConfigFieldSchema>;

export interface ValidateAutomationOptions {
  /** Refuse the platform-only steps (script, http.request). */
  forOwner?: boolean;
  /**
   * The list an event trigger may name (the platform events plus the
   * business's installed apps' events). Without it the event name is not
   * checked: the admin builds for every business, and an app's event exists
   * wherever that app is installed.
   */
  events?: AutomationKnownEvent[] | null;
}

/**
 * Port of gcr-api-clean `validateDefinition` (lib/automationEngine.js). The
 * wording of every problem is kept so the builders show the same text.
 */
export function validateAutomationDefinition(def: Record<string, unknown> | null | undefined, options: ValidateAutomationOptions = {}): string[] {
  const { forOwner = false, events = null } = options;
  const d = (def ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!d.name || !String(d.name).trim()) problems.push("A name is required.");
  if (d.key && !AUTOMATION_KEY_PATTERN.test(String(d.key))) problems.push("Key must be lowercase letters, numbers and hyphens.");

  const trigger = (d.trigger && typeof d.trigger === "object" ? d.trigger : {}) as Record<string, unknown>;
  if (!AUTOMATION_TRIGGER_TYPES.some((t) => t.type === trigger.type)) problems.push(`Unknown trigger type: ${String(trigger.type)}`);
  if (trigger.type === "schedule" && !(AUTOMATION_SCHEDULE_EVERY as readonly string[]).includes(String(trigger.every ?? "day"))) {
    problems.push("Schedule must be hourly, daily or weekly.");
  }
  if (trigger.type === "event" && !trigger.event) problems.push("Pick an event to listen for.");
  if (trigger.type === "event" && trigger.event && Array.isArray(events) && !events.some((e) => e.name === trigger.event)) {
    problems.push(`No installed app or platform event is called "${String(trigger.event)}".`);
  }

  const steps = Array.isArray(d.steps) ? (d.steps as unknown[]) : [];
  const ids = new Set<string>();
  steps.forEach((raw, i) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const descriptor = automationStepDescriptor(s.type);
    if (!descriptor) { problems.push(`Step ${i + 1}: unknown type "${String(s.type)}".`); return; }
    if (forOwner && descriptor.adminOnly) { problems.push(`Step ${i + 1}: "${descriptor.label}" is only available to the platform.`); return; }
    const id = String(s.id ?? "");
    if (!AUTOMATION_STEP_ID_PATTERN.test(id)) problems.push(`Step ${i + 1}: needs an id (letters, numbers, underscores).`);
    if (ids.has(id)) problems.push(`Step ${i + 1}: id "${id}" is used twice.`);
    ids.add(id);
    const config = (s.config && typeof s.config === "object" ? s.config : {}) as Record<string, unknown>;
    for (const f of descriptor.fields) {
      const v = config[f.key];
      if (f.required && (v == null || v === "")) problems.push(`Step "${String(s.name || id)}": ${f.label} is required.`);
    }
  });

  const schema = Array.isArray(d.config_schema) ? (d.config_schema as unknown[]) : [];
  const keys = new Set<unknown>();
  schema.forEach((raw, i) => {
    const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!AUTOMATION_CONFIG_KEY_PATTERN.test(String(f.key ?? ""))) problems.push(`Setting ${i + 1}: key must be lowercase letters, numbers, underscores.`);
    if (keys.has(f.key)) problems.push(`Setting "${String(f.key)}" is defined twice.`);
    keys.add(f.key);
    if (!(AUTOMATION_CONFIG_FIELD_TYPES as readonly string[]).includes(String(f.type ?? "text"))) problems.push(`Setting "${String(f.key)}": unknown type "${String(f.type)}".`);
  });
  return problems;
}

/* ── the event envelope gcr-api-clean posts (DECISIONS #87) ─────────────── */

/**
 * Event and contract names: dotted, each segment `[a-z][a-z0-9_-]*`, at
 * least two segments (DECISIONS #54/#55). Dashes are allowed because app keys
 * carry them (`qr-menu.submitted`).
 */
export const NEXTGENT_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export function isNextgentEventName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && NEXTGENT_EVENT_NAME_PATTERN.test(value);
}

/**
 * `POST /api/nextgent/events`: one business event, ids and a non-PII summary
 * only. `ref` carries ids plus what a step may reason about (date, party,
 * status, source, app, table, record id); never a customer's name, email or
 * phone — those are fetched at run time through the business MCP.
 */
export const nextgentEventSchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  event: z.string().trim().refine(isNextgentEventName, "Event names are dotted lowercase segments, e.g. booking.created"),
  /** Unique per occurrence; the fan-out is idempotent on it. */
  eventId: z.string().trim().min(1).max(200),
  occurredAt: z.string().trim().min(1).max(100),
  ref: z.record(z.string(), z.unknown()).optional().nullable(),
});
export type NextgentEvent = z.infer<typeof nextgentEventSchema>;
