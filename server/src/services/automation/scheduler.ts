import { defaultTimezone } from "./definition.js";

/**
 * gcr-api-clean's schedule triggers ({ every: hour|day|week, at: "HH:MM",
 * day_of_week, timezone }) mapped onto Paperclip's cron triggers, and the
 * port of gcr's `isDue` for the parity tests. Minutes are ignored on purpose,
 * as in gcr: "at 09:00" means "in the 9 o'clock hour, once that day".
 */
export interface ScheduleTrigger {
  type?: string;
  every?: string;
  at?: string;
  day_of_week?: number | string;
  timezone?: string;
}

export function scheduleHour(trigger: ScheduleTrigger): number {
  const hour = Number(String(trigger.at ?? "09:00").split(":")[0]);
  return Number.isFinite(hour) ? Math.min(Math.max(Math.floor(hour), 0), 23) : 0;
}

/** hour → every hour on the hour; day → at the hour daily; week → at the hour on the weekday (0 Sunday … 6). */
export function scheduleToCron(trigger: ScheduleTrigger): string {
  const every = trigger.every || "day";
  if (every === "hour") return "0 * * * *";
  const hour = scheduleHour(trigger);
  if (every === "week") {
    const day = Number(trigger.day_of_week ?? 1);
    return `0 ${hour} * * ${Number.isFinite(day) ? Math.min(Math.max(Math.floor(day), 0), 6) : 1}`;
  }
  return `0 ${hour} * * *`;
}

/**
 * The timezone a trigger runs in: the business's own when the bridge knows
 * it (a business fact, read from gcr-api-clean), else the trigger's, else the
 * server default (AUTOMATION_DEFAULT_TIMEZONE / DEFAULT_TIMEZONE / UTC).
 */
export function scheduleTimezone(trigger: ScheduleTrigger, businessTimezone: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  return businessTimezone?.trim() || trigger.timezone?.trim() || defaultTimezone(env);
}

function localParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { hour: Number(parts.hour) % 24, dow, dayKey: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Is a schedule trigger due right now, given when it last ran? (gcr isDue, for parity.) */
export function isDue(trigger: ScheduleTrigger | null | undefined, now = new Date(), lastRunAt: string | Date | null = null, env: Record<string, string | undefined> = process.env): boolean {
  if (!trigger || trigger.type !== "schedule") return false;
  const tz = trigger.timezone || defaultTimezone(env);
  const last = lastRunAt ? new Date(lastRunAt) : null;
  const every = trigger.every || "day";
  const atHour = scheduleHour(trigger);
  const local = localParts(now, tz);
  if (every === "hour") return !last || now.getTime() - last.getTime() >= 50 * 60 * 1000;
  if (local.hour !== atHour) return false;
  if (every === "day") return !last || localParts(last, tz).dayKey !== local.dayKey;
  if (every === "week") {
    const wanted = Number(trigger.day_of_week ?? 1);
    return local.dow === wanted && (!last || now.getTime() - last.getTime() >= 6 * 24 * 60 * 60 * 1000);
  }
  return false;
}
