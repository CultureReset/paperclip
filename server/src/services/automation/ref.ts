import type { RunTrigger } from "./types.js";

/**
 * The ids and non-PII summary of an event's payload — a port of gcr-api-clean
 * `lib/eventOutbox.js` refFor, one rule in both engines (DECISIONS #87, #91).
 *
 * `ref` never carries a customer's name, email, phone, notes or the record
 * itself (#37). It is built from an allow-list of keys, and a value that looks
 * like an email address or a phone number is dropped even under an allowed
 * key. gcr-api-clean posts events to Paperclip with `ref` already built; the
 * same function here covers the parity dump (gcr's local payload shape) and
 * anything that reaches the runner with a payload but no ref.
 */

const REF_KEYS = Object.freeze([
  "booking_id", "date", "end_date", "start_time", "end_time", "party", "status", "source", "changed", "ended_at",
  "payment_id", "amount_cents", "currency",
  "review_id", "rating",
  "app", "install_id", "table", "record_id",
  "request_id",
]);
const EMAILISH = /@/;
const PHONEISH = /^\+?\d[\d\s().-]{6,}$/;
const DATEISH = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;
const MAX_REF_STRING = 120;

const looksLikePhone = (s: string) => PHONEISH.test(s) && !DATEISH.test(s) && s.replace(/\D/g, "").length >= 7;

function refScalar(v: unknown): string | number | boolean | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > MAX_REF_STRING || EMAILISH.test(s) || looksLikePhone(s)) return undefined;
  return s;
}

function pickRef(candidate: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REF_KEYS) {
    const v = candidate[key];
    if (v === undefined || v === null) continue;
    if (key === "changed") {
      const list = Array.isArray(v) ? v.map(refScalar).filter((x): x is string => typeof x === "string") : [];
      if (list.length) out.changed = list;
      continue;
    }
    const s = refScalar(v);
    if (s !== undefined) out[key] = s;
  }
  return out;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

export function refFor(event: string | null, payload: unknown): Record<string, unknown> {
  const p = rec(payload) ?? {};
  const c: Rec = {};
  const b = rec(p.booking);
  if (b) {
    Object.assign(c, {
      booking_id: b.booking_id ?? b.id, date: b.date, end_date: b.end_date, start_time: b.start_time, end_time: b.end_time,
      party: b.party, status: b.status, source: b.source,
    });
    if (Array.isArray(p.changed)) c.changed = p.changed;
    if (p.ended_at) c.ended_at = p.ended_at;
  }
  const pay = rec(p.payment);
  if (pay) Object.assign(c, { payment_id: pay.id ?? pay.payment_id, amount_cents: pay.amount_cents ?? pay.amount, currency: pay.currency, source: pay.source, status: pay.status, booking_id: pay.booking_id });
  const r = rec(p.review);
  if (r) Object.assign(c, { review_id: r.review_id ?? r.id, rating: r.rating, booking_id: r.booking_id });
  if (typeof p.app === "string") {
    const record = rec(p.record);
    Object.assign(c, { app: p.app, install_id: p.installId ?? p.install_id, table: p.table, source: p.source, record_id: record ? record.id : undefined });
  }
  if (event === "intake.created") c.request_id = p.request_id ?? p.id;
  return pickRef(c);
}

export interface TriggerContext {
  type: string;
  event: string | null;
  payload: unknown;
  ref: Record<string, unknown>;
}

/**
 * The trigger as templates and steps see it: { type, event, payload, ref }
 * (gcr `triggerContext`). A payload that already carries `ref` (the envelope
 * gcr-api-clean posts) keeps it; otherwise the ref is built from the payload.
 */
export function triggerContext(trigger: RunTrigger | null | undefined): TriggerContext {
  const type = trigger?.type || "manual";
  const payload = trigger?.payload ?? null;
  const p = rec(payload);
  const event = typeof p?.event === "string" ? p.event : null;
  const given = rec(p?.ref);
  return { type, event, payload, ref: given ? pickRef(given) : refFor(event, payload) };
}
