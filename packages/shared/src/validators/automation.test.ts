import { describe, expect, it } from "vitest";
import {
  AUTOMATION_CONFIG_FIELD_TYPES,
  AUTOMATION_PLATFORM_EVENTS,
  AUTOMATION_STEP_CATALOGUE,
  AUTOMATION_TRIGGER_TYPES,
  automationStepDescriptor,
} from "../automation-catalogue.js";
import {
  isNextgentEventName,
  nextgentEventSchema,
  piiTemplatePaths,
  validateAutomationDefinition,
} from "./automation.js";

/** gcr-api-clean scripts/test-automations.js DEFINITION, verbatim. */
const DEFINITION = {
  name: "Nightly special",
  trigger: { type: "schedule", every: "day", at: "09:00" },
  config_schema: [{ key: "reminder_phone", label: "Phone", type: "tel", default: "" }],
  steps: [
    { id: "pick", type: "data.query", config: { table: "menu_items", filter: '{"is_active": true}', limit: 5 } },
    { id: "gate", type: "condition", config: { left: "{{ steps.pick.count }}", op: "gt", right: "0" } },
    { id: "post", type: "data.insert", config: { table: "entity_specials", values: '{"title": "Tonight: {{ steps.pick.rows.0.item_name }}"}' } },
    { id: "text", type: "sms.send", config: { to: "{{ config.reminder_phone }}", body: "Posted {{ steps.post.row.title }} for {{ business.name }}" } },
  ],
};

describe("automation step catalogue", () => {
  it("lists the fifteen gcr step types with their fields", () => {
    expect(Object.keys(AUTOMATION_STEP_CATALOGUE).sort()).toEqual([
      "agent", "ai.prompt", "condition", "data.insert", "data.query", "data.update", "email.send",
      "http.request", "log", "message", "notify", "script", "sms.send", "transform", "wait",
    ]);
    for (const descriptor of Object.values(AUTOMATION_STEP_CATALOGUE)) {
      expect(Array.isArray(descriptor.fields)).toBe(true);
      expect(typeof descriptor.label).toBe("string");
    }
    expect(automationStepDescriptor("script")?.adminOnly).toBe(true);
    expect(automationStepDescriptor("http.request")?.adminOnly).toBe(true);
    expect(automationStepDescriptor("wait")?.pausesRun).toBe(true);
    expect(automationStepDescriptor("nope")).toBeNull();
  });

  it("lists four trigger types, the platform events and the config field types", () => {
    expect(AUTOMATION_TRIGGER_TYPES.map((t) => t.type)).toEqual(["manual", "schedule", "event", "webhook"]);
    for (const name of ["booking.created", "booking.changed", "booking.cancelled", "booking.completed", "payment.received", "review.received", "intake.created", "automation.installed"]) {
      expect(AUTOMATION_PLATFORM_EVENTS.some((e) => e.name === name)).toBe(true);
    }
    expect(AUTOMATION_CONFIG_FIELD_TYPES).toEqual(["text", "textarea", "number", "boolean", "select", "tel", "email"]);
  });
});

describe("validateAutomationDefinition (port of gcr validateDefinition)", () => {
  it("a good definition has no problems", () => {
    expect(validateAutomationDefinition(DEFINITION)).toEqual([]);
  });

  it("an unknown step type is caught", () => {
    const problems = validateAutomationDefinition({ ...DEFINITION, steps: [{ id: "x", type: "nope", config: {} }] });
    expect(problems.some((p) => /unknown type/.test(p))).toBe(true);
  });

  it("a duplicate step id is caught", () => {
    const problems = validateAutomationDefinition({ ...DEFINITION, steps: [DEFINITION.steps[0], DEFINITION.steps[0]] });
    expect(problems.some((p) => /used twice/.test(p))).toBe(true);
  });

  it("a required step field is caught", () => {
    const problems = validateAutomationDefinition({ ...DEFINITION, steps: [{ id: "q", type: "data.query", config: {} }] });
    expect(problems.some((p) => /Table is required/.test(p))).toBe(true);
  });

  it("a bad key is caught", () => {
    expect(validateAutomationDefinition({ ...DEFINITION, key: "Not Valid" }).some((p) => /Key must/.test(p))).toBe(true);
  });

  it("a missing name is caught", () => {
    expect(validateAutomationDefinition({ ...DEFINITION, name: "" }).some((p) => /name is required/i.test(p))).toBe(true);
  });

  it("a bad schedule, a missing event and an unknown config type are caught", () => {
    expect(validateAutomationDefinition({ ...DEFINITION, trigger: { type: "schedule", every: "fortnight" } }).some((p) => /hourly, daily or weekly/.test(p))).toBe(true);
    expect(validateAutomationDefinition({ ...DEFINITION, trigger: { type: "event" } }).some((p) => /Pick an event/.test(p))).toBe(true);
    expect(validateAutomationDefinition({ ...DEFINITION, trigger: { type: "later" } }).some((p) => /Unknown trigger type/.test(p))).toBe(true);
    expect(validateAutomationDefinition({ ...DEFINITION, config_schema: [{ key: "x", type: "colour" }] }).some((p) => /unknown type "colour"/.test(p))).toBe(true);
    expect(validateAutomationDefinition({ ...DEFINITION, config_schema: [{ key: "Bad Key" }] }).some((p) => /key must be lowercase/.test(p))).toBe(true);
    expect(validateAutomationDefinition({ ...DEFINITION, config_schema: [{ key: "a" }, { key: "a" }] }).some((p) => /defined twice/.test(p))).toBe(true);
  });

  it("owner definitions may not use the platform-only steps", () => {
    const def = { ...DEFINITION, steps: [{ id: "s", type: "script", config: { code: "return 1" } }] };
    expect(validateAutomationDefinition(def)).toEqual([]);
    expect(validateAutomationDefinition(def, { forOwner: true }).some((p) => /only available to the platform/.test(p))).toBe(true);
    const http = { ...DEFINITION, steps: [{ id: "h", type: "http.request", config: { url: "https://x.test" } }] };
    expect(validateAutomationDefinition(http, { forOwner: true }).some((p) => /only available to the platform/.test(p))).toBe(true);
  });

  it("checks the event name against a known-events list when one is given", () => {
    const known = [...AUTOMATION_PLATFORM_EVENTS, { name: "song-requests.requests.submitted", description: "x" }];
    const listen = (event: string) => ({ ...DEFINITION, trigger: { type: "event", event } });
    expect(validateAutomationDefinition(listen("song-requests.requests.submitted"), { events: known })).toEqual([]);
    expect(validateAutomationDefinition(listen("nope.nothing"), { events: known }).some((p) => /event/i.test(p))).toBe(true);
    // Without a list, validation is as before (the admin builds for every business).
    expect(validateAutomationDefinition(listen("nope.nothing"))).toEqual([]);
  });
});

describe("agent steps may not carry customer fields (DECISIONS #92)", () => {
  const agentStep = (config: Record<string, unknown>) => ({ ...DEFINITION, steps: [{ id: "hand", type: "agent", config: { item_key: "review-agent", ...config } }] });
  it("refuses trigger.payload paths that name PII in instructions or payload", () => {
    for (const bad of ["{{ trigger.payload.customer_name }}", "{{ trigger.payload.booking.customer_email }}", "{{ trigger.payload.booking.details }}", "{{ trigger.payload.guest.phone }}", "{{ trigger.payload.Address }}"]) {
      const problems = validateAutomationDefinition(agentStep({ instructions: `Ask ${bad} for a review` }));
      expect(problems.some((p) => /may not use customer fields/.test(p) && /trigger\.ref/.test(p))).toBe(true);
    }
    expect(validateAutomationDefinition(agentStep({ payload: { booking: "{{ trigger.payload.booking.customer_phone }}" } })).some((p) => /payload may not use customer fields/.test(p))).toBe(true);
    expect(validateAutomationDefinition(agentStep({ payload: '{"who": "{{ trigger.payload.booking.customer_name }}"}' })).some((p) => /payload may not use customer fields/.test(p))).toBe(true);
  });
  it("allows trigger.ref and non-PII payload paths, and other steps keep using the payload", () => {
    expect(validateAutomationDefinition(agentStep({ instructions: "Ask the guest of booking {{ trigger.ref.booking_id }} for a review", payload: { booking: "{{ trigger.ref }}" } }))).toEqual([]);
    expect(validateAutomationDefinition(agentStep({ instructions: "Booking {{ trigger.payload.booking.booking_id }} on {{ trigger.payload.booking.date }}" }))).toEqual([]);
    const messageStep = { ...DEFINITION, steps: [{ id: "m", type: "message", config: { channel: "email", to: "{{ trigger.payload.booking.customer_email }}", body: "hi" } }] };
    expect(validateAutomationDefinition(messageStep)).toEqual([]);
    expect(piiTemplatePaths("{{ trigger.payload.booking.customer_email }} and {{ trigger.ref.date }}")).toEqual(["trigger.payload.booking.customer_email"]);
  });
});

describe("event envelope", () => {
  it("accepts dotted names with dashes and refuses the rest (DECISIONS #54/#55)", () => {
    expect(isNextgentEventName("booking.created")).toBe(true);
    expect(isNextgentEventName("qr-menu.submitted")).toBe(true);
    expect(isNextgentEventName("core-enquiry-form.leads.submitted")).toBe(true);
    expect(isNextgentEventName("booking")).toBe(false);
    expect(isNextgentEventName("Booking.Created")).toBe(false);
    expect(isNextgentEventName(".created")).toBe(false);
    expect(isNextgentEventName("booking..created")).toBe(false);
  });

  it("parses the envelope gcr-api-clean sends and keeps the ref whole", () => {
    const parsed = nextgentEventSchema.safeParse({
      companyId: "6a6f4c2e-9f4b-4f1c-9d7f-1d2b3c4d5e6f",
      event: "booking.completed",
      eventId: "evt-1",
      occurredAt: "2026-10-01T18:30:00.000Z",
      ref: { booking_id: "b-1", date: "2026-10-01", party: 2 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ref).toEqual({ booking_id: "b-1", date: "2026-10-01", party: 2 });
    expect(nextgentEventSchema.safeParse({ companyId: "x", event: "nope", eventId: "1", occurredAt: "now" }).success).toBe(false);
    expect(nextgentEventSchema.safeParse({ companyId: "x", event: "a.b", occurredAt: "now" }).success).toBe(false);
  });
});
