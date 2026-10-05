import { describe, expect, it } from "vitest";
import { isDue, scheduleTimezone, scheduleToCron } from "../services/automation/scheduler.js";

/** Port of gcr scripts/test-automations.js "Schedules" (DEFAULT_TIMEZONE=America/Chicago), plus the cron mapping. */
const env = { DEFAULT_TIMEZONE: "America/Chicago" };
const chicago9 = new Date("2026-09-14T14:30:00Z"); // 09:30 Central, a Monday
const chicago10 = new Date("2026-09-14T15:30:00Z");

describe("schedules (port of gcr isDue)", () => {
  it("daily at 09:00 is due in the 9 o'clock hour, once a day", () => {
    expect(isDue({ type: "schedule", every: "day", at: "09:00" }, chicago9, null, env)).toBe(true);
    expect(isDue({ type: "schedule", every: "day", at: "09:00" }, chicago10, null, env)).toBe(false);
    expect(isDue({ type: "schedule", every: "day", at: "09:00" }, chicago9, "2026-09-14T14:05:00Z", env)).toBe(false);
    expect(isDue({ type: "schedule", every: "day", at: "09:00" }, new Date("2026-09-15T14:30:00Z"), "2026-09-14T14:05:00Z", env)).toBe(true);
  });
  it("hourly after 50 minutes; weekly on the day; manual never", () => {
    expect(isDue({ type: "schedule", every: "hour" }, chicago10, chicago9.toISOString(), env)).toBe(true);
    expect(isDue({ type: "schedule", every: "week", day_of_week: 1, at: "09:00" }, chicago9, null, env)).toBe(true);
    expect(isDue({ type: "schedule", every: "week", day_of_week: 2, at: "09:00" }, chicago9, null, env)).toBe(false);
    expect(isDue({ type: "manual" }, chicago9, null, env)).toBe(false);
  });
});

describe("schedule → cron mapping", () => {
  it("maps hour, day-at and week-on, ignoring minutes", () => {
    expect(scheduleToCron({ every: "hour" })).toBe("0 * * * *");
    expect(scheduleToCron({ every: "day", at: "09:30" })).toBe("0 9 * * *");
    expect(scheduleToCron({})).toBe("0 9 * * *");
    expect(scheduleToCron({ every: "week", at: "17:00", day_of_week: 5 })).toBe("0 17 * * 5");
    expect(scheduleToCron({ every: "week", at: "17:00" })).toBe("0 17 * * 1");
  });
  it("takes the business's timezone first, then the trigger's, then the server default", () => {
    expect(scheduleTimezone({ timezone: "Europe/Paris" }, "America/Chicago", env)).toBe("America/Chicago");
    expect(scheduleTimezone({ timezone: "Europe/Paris" }, null, env)).toBe("Europe/Paris");
    expect(scheduleTimezone({}, null, env)).toBe("America/Chicago");
    expect(scheduleTimezone({}, null, { AUTOMATION_DEFAULT_TIMEZONE: "Asia/Tokyo", ...env })).toBe("Asia/Tokyo");
    expect(scheduleTimezone({}, null, {})).toBe("UTC");
  });
});
