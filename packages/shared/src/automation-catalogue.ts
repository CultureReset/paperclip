/**
 * The automation step catalogue: what each step type is called, how a builder
 * draws it and which of its fields are required. Ported from gcr-api-clean
 * `lib/automationEngine.js` STEP_TYPES / TRIGGER_TYPES / EVENTS /
 * CONFIG_FIELD_TYPES (DECISIONS #82). This is data; how a step RUNS lives in
 * the server's step registry (`server/src/services/automation/steps`), one
 * file per type, keyed by the same `type` string.
 *
 * `fields` use the descriptor shape the admin console's SchemaForm reads:
 * { key, label, type, help, required, options, placeholder, default }.
 */

export interface AutomationStepField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "json" | "code";
  help?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  default?: unknown;
  rows?: number;
}

export interface AutomationStepDescriptor {
  label: string;
  description: string;
  category: "Data" | "Logic" | "AI" | "Connect" | "Notify";
  icon: string;
  /** A dry run must not execute this step; it reports what it WOULD have done instead. */
  sideEffect: boolean;
  /** Only the platform's builder has it; refused in an owner's definition. */
  adminOnly?: boolean;
  /** The runner saves the run instead of going on (wait). */
  pausesRun?: boolean;
  fields: AutomationStepField[];
}

export const AUTOMATION_STEP_CATALOGUE: Readonly<Record<string, AutomationStepDescriptor>> = {
  "data.query": {
    label: "Read this business's data",
    description: "Rows from one of the business's own tables — menu items, events, bookings, anything keyed by its slug.",
    category: "Data",
    icon: "🔎",
    sideEffect: false,
    fields: [
      { key: "table", label: "Table", type: "text", required: true, placeholder: "menu_items", help: "Any slug-keyed table. Checked against the live schema at run time." },
      { key: "filter", label: "Filter", type: "json", placeholder: '{ "is_active": true }', help: "Column = value pairs, all of which must match. Optional." },
      { key: "order_by", label: "Order by", type: "text", placeholder: "created_at" },
      { key: "descending", label: "Newest first", type: "boolean", default: true },
      { key: "limit", label: "Limit", type: "number", default: 100 },
    ],
  },
  "data.insert": {
    label: "Add a row",
    description: "Insert one row into one of the business's tables. The slug is stamped by the server.",
    category: "Data",
    icon: "➕",
    sideEffect: true,
    fields: [
      { key: "table", label: "Table", type: "text", required: true, placeholder: "entity_specials" },
      { key: "values", label: "Values", type: "json", required: true, placeholder: '{ "title": "Tonight: {{ steps.pick.rows.0.item_name }}" }' },
    ],
  },
  "data.update": {
    label: "Update a row",
    description: "Change one of the business's rows by id. A row belonging to another business matches nothing.",
    category: "Data",
    icon: "✏️",
    sideEffect: true,
    fields: [
      { key: "table", label: "Table", type: "text", required: true },
      { key: "id", label: "Row id", type: "text", required: true, placeholder: "{{ steps.query.rows.0.id }}" },
      { key: "values", label: "Values", type: "json", required: true, placeholder: '{ "is_active": false }' },
    ],
  },
  condition: {
    label: "Only continue if…",
    description: "Compare two values. When the check fails the run stops (or carries on, if you say so).",
    category: "Logic",
    icon: "🔀",
    sideEffect: false,
    fields: [
      { key: "left", label: "Value", type: "text", required: true, placeholder: "{{ steps.query.count }}" },
      {
        key: "op", label: "Check", type: "select", required: true, default: "gt",
        options: [
          { value: "eq", label: "equals" }, { value: "ne", label: "does not equal" },
          { value: "gt", label: "is greater than" }, { value: "lt", label: "is less than" },
          { value: "contains", label: "contains" }, { value: "empty", label: "is empty" },
          { value: "not_empty", label: "is not empty" }, { value: "truthy", label: "is true / set" },
        ],
      },
      { key: "right", label: "Compared to", type: "text", placeholder: "0" },
      {
        key: "on_fail", label: "When it fails", type: "select", default: "stop",
        options: [{ value: "stop", label: "stop the run" }, { value: "continue", label: "carry on" }],
      },
    ],
  },
  transform: {
    label: "Set values",
    description: "Build named values from templates, for later steps to use as {{ steps.<id>.<name> }}.",
    category: "Logic",
    icon: "🧮",
    sideEffect: false,
    fields: [
      { key: "assign", label: "Values", type: "json", required: true, placeholder: '{ "greeting": "Hi {{ business.name }}", "count": "{{ steps.query.count }}" }' },
    ],
  },
  script: {
    adminOnly: true,
    label: "Run a script",
    description: "A short JavaScript function with everything from the run in scope. Synchronous; whatever it returns becomes this step's output.",
    category: "Logic",
    icon: "📜",
    sideEffect: false,
    fields: [
      {
        key: "code", label: "Code", type: "code", required: true, rows: 12,
        default: "// input, config, steps, business, trigger are in scope.\n// Return a value; later steps can read it as {{ steps.<id>.<key> }}.\nreturn { ok: true };",
        help: "Plain JavaScript, no require, no network, no await. Two-second limit.",
      },
    ],
  },
  "ai.prompt": {
    label: "Ask the AI",
    description: "Send a prompt to whichever model AI Config assigns to the task, and keep the answer.",
    category: "AI",
    icon: "🤖",
    sideEffect: true,
    fields: [
      { key: "prompt", label: "Prompt", type: "textarea", required: true, rows: 6, placeholder: "Write a two-sentence special for {{ business.name }} featuring {{ steps.pick.rows.0.item_name }}." },
      { key: "system", label: "Instructions", type: "textarea", rows: 3, placeholder: "You write short, upbeat copy for {{ business.name }}." },
      { key: "task", label: "AI Config task", type: "text", default: "automation", help: "Which provider/model row in AI Config to use." },
      { key: "max_tokens", label: "Max tokens", type: "number", default: 400 },
    ],
  },
  "http.request": {
    adminOnly: true,
    label: "Call a URL",
    description: "POST or GET anything — Zapier, Make, Slack, your own server.",
    category: "Connect",
    icon: "🌐",
    sideEffect: true,
    fields: [
      { key: "url", label: "URL", type: "text", required: true, placeholder: "https://hooks.zapier.com/…" },
      {
        key: "method", label: "Method", type: "select", default: "POST",
        options: [{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }, { value: "PUT", label: "PUT" }, { value: "PATCH", label: "PATCH" }],
      },
      { key: "headers", label: "Headers", type: "json", placeholder: '{ "Authorization": "Bearer …" }' },
      { key: "body", label: "Body", type: "json", placeholder: '{ "business": "{{ business.name }}", "rows": "{{ steps.query.rows }}" }' },
    ],
  },
  "sms.send": {
    label: "Text the business",
    description: "A text from the platform number to the business itself: its listed phone, the owner's notification phone, or a number it owns. To text a customer, use \"Message a customer\", which keeps the consent and registered-number rules.",
    category: "Notify",
    icon: "💬",
    sideEffect: true,
    fields: [
      { key: "to", label: "To", type: "text", required: true, default: "{{ business.phone }}", help: "The business's own numbers only (its listed phone, the owner's notification phone, or a number it owns). Any other number is refused." },
      { key: "body", label: "Message", type: "textarea", required: true, rows: 4 },
    ],
  },
  "email.send": {
    label: "Send an email",
    description: "From the platform address.",
    category: "Notify",
    icon: "✉️",
    sideEffect: true,
    fields: [
      { key: "to", label: "To", type: "text", required: true, default: "{{ business.email }}" },
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "html", label: "Body (HTML allowed)", type: "textarea", required: true, rows: 6 },
    ],
  },
  wait: {
    label: "Wait",
    description: "Pause the run, then carry on with the next step. The wait is saved; the scheduled check picks it up when it is due.",
    category: "Logic",
    icon: "⏳",
    sideEffect: false,
    pausesRun: true,
    fields: [
      { key: "minutes", label: "Minutes", type: "number", required: true, default: 60, help: "Checked by the scheduled run, so the run carries on at the first check after this." },
    ],
  },
  agent: {
    label: "Give this to an agent",
    description: "Hand the work to one of the business's agents. The run is recorded as work for that agent.",
    category: "Connect",
    icon: "🧑‍💼",
    sideEffect: true,
    fields: [
      { key: "item_key", label: "Agent install (store item)", type: "text", default: "{{ automation.key }}", help: "The store item whose install created the agent. Defaults to this automation's own install." },
      { key: "agent_key", label: "Agent key", type: "text", help: "Which agent of that install, when it created more than one." },
      { key: "agent_id", label: "Agent id", type: "text", help: "Optional. A specific agent of this business, instead of looking it up by item." },
      { key: "instructions", label: "What to do", type: "textarea", rows: 4, placeholder: "Ask the customer of booking {{ trigger.payload.ref.booking_id }} for a review." },
      { key: "payload", label: "Details", type: "json", placeholder: '{ "booking": "{{ trigger.payload.ref }}" }' },
    ],
  },
  message: {
    label: "Message a customer",
    description: "messages.send: an email, or a text from the business's registered number to a customer who agreed to texts.",
    category: "Notify",
    icon: "📨",
    sideEffect: true,
    fields: [
      {
        key: "channel", label: "Channel", type: "select", required: true, default: "email",
        options: [{ value: "email", label: "email" }, { value: "sms", label: "text" }],
      },
      { key: "to", label: "To", type: "text", required: true, placeholder: "{{ trigger.payload.customer_email }}" },
      { key: "to_ref", label: "To (by reference)", type: "json", help: "Instead of an address: a reference gcr-api-clean resolves, e.g. { \"contract\": \"booking.records\", \"id\": \"{{ trigger.payload.ref.booking_id }}\" }." },
      { key: "subject", label: "Subject (email)", type: "text" },
      { key: "body", label: "Message", type: "textarea", required: true, rows: 4 },
      { key: "require_approval", label: "Owner approves first", type: "boolean", default: false },
    ],
  },
  notify: {
    label: "Post a note on the dashboard",
    description: "Leaves a message the business sees in this automation's run history — no text, no email.",
    category: "Notify",
    icon: "📌",
    sideEffect: false,
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "message", label: "Message", type: "textarea", rows: 3 },
      {
        key: "level", label: "Tone", type: "select", default: "info",
        options: [{ value: "info", label: "info" }, { value: "success", label: "good news" }, { value: "warning", label: "needs attention" }],
      },
    ],
  },
  log: {
    label: "Log a line",
    description: "Writes a line into the run log. Handy while building.",
    category: "Logic",
    icon: "📝",
    sideEffect: false,
    fields: [{ key: "message", label: "Message", type: "text", required: true }],
  },
};

export type AutomationStepType = keyof typeof AUTOMATION_STEP_CATALOGUE;

export function automationStepDescriptor(type: unknown): AutomationStepDescriptor | null {
  if (typeof type !== "string") return null;
  return Object.prototype.hasOwnProperty.call(AUTOMATION_STEP_CATALOGUE, type) ? AUTOMATION_STEP_CATALOGUE[type] : null;
}

export const AUTOMATION_TRIGGER_TYPES = [
  { type: "manual", label: "Run by hand", description: "From the business dashboard or the admin console." },
  { type: "schedule", label: "On a schedule", description: "Hourly, daily at a time, or weekly on a day. Checked once an hour." },
  { type: "event", label: "When something happens", description: "Fired by the platform — a new intake request, for instance." },
  { type: "webhook", label: "When a URL is called", description: "Each business gets its own URL; whatever is POSTed to it becomes the trigger payload." },
] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number]["type"];

/** `every` values a schedule trigger accepts. */
export const AUTOMATION_SCHEDULE_EVERY = ["hour", "day", "week"] as const;

/**
 * Events the platform emits. Installed apps add their own: each events.emits
 * entry of an installed manifest, named `<manifest id>.<event>` (DECISIONS
 * #47, #55) — the registry of valid app events is the set of installed
 * manifests, not a list.
 */
export const AUTOMATION_PLATFORM_EVENTS = [
  { name: "intake.created", description: "A business submitted its links through the intake form." },
  { name: "automation.installed", description: "This automation was just pushed to the business." },
  { name: "booking.created", description: "A booking arrived — forwarded email, the booking page, or entered by hand." },
  { name: "booking.changed", description: "A booking's date, time or party changed." },
  { name: "booking.cancelled", description: "A booking was cancelled." },
  { name: "booking.completed", description: "A booking's end time passed and it was not cancelled (found by the scheduled check)." },
  { name: "payment.received", description: "A payment was detected — claimed from an email, or verified by the payment provider." },
  { name: "review.received", description: "A customer left a review." },
] as const;

export interface AutomationKnownEvent {
  name: string;
  description: string;
  app?: string;
}

export const AUTOMATION_CONFIG_FIELD_TYPES = ["text", "textarea", "number", "boolean", "select", "tel", "email"] as const;
export type AutomationConfigFieldType = (typeof AUTOMATION_CONFIG_FIELD_TYPES)[number];

/** Run modes a routine may have: an agent issue per run, or the deterministic step runner (DECISIONS #82). */
export const ROUTINE_MODES = ["agent", "steps"] as const;
export type RoutineMode = (typeof ROUTINE_MODES)[number];
