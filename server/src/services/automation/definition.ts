import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeInstalls, storeItemVersions } from "@paperclipai/db";
import {
  AUTOMATION_CONFIG_FIELD_TYPES,
  AUTOMATION_PLATFORM_EVENTS,
  AUTOMATION_STEP_CATALOGUE,
  AUTOMATION_TRIGGER_TYPES,
  automationDefinitionSchema,
  validateAutomationDefinition,
  type AutomationDefinition,
  type AutomationKnownEvent,
  type ValidateAutomationOptions,
} from "@paperclipai/shared";

/**
 * Definitions: parsing, validation and the catalogue a builder reads. The
 * rules live in @paperclipai/shared (validateAutomationDefinition); this
 * module adds what needs the database — the events a company's installed
 * apps declare — and the server's settings (timezones).
 */

export { validateAutomationDefinition };
export type { AutomationDefinition, ValidateAutomationOptions };

/** The timezone a schedule is read in when neither the business nor the trigger names one: AUTOMATION_DEFAULT_TIMEZONE, else DEFAULT_TIMEZONE, else UTC. */
export function defaultTimezone(env: Record<string, string | undefined> = process.env): string {
  return env.AUTOMATION_DEFAULT_TIMEZONE?.trim() || env.DEFAULT_TIMEZONE?.trim() || "UTC";
}

export function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [defaultTimezone()];
  }
}

/** Parse a definition's shape; throws zod's error on a malformed one. */
export function parseAutomationDefinition(value: unknown): AutomationDefinition {
  return automationDefinitionSchema.parse(value);
}

/** The `automation` section of a store release payload, or null when it has none (or it is malformed). */
export function automationOf(payload: unknown): AutomationDefinition | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>).automation;
  if (raw === undefined || raw === null) return null;
  const parsed = automationDefinitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `events.emits` of an app manifest, exactly as declared (`<manifest id>.<event>`, DECISIONS #55). */
export function declaredEvents(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const events = (manifest as { events?: { emits?: unknown } }).events?.emits;
  return Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [];
}

export function automationDefinitions(db: Db) {
  /**
   * The events of the company's installed, switched-on apps, read live from
   * the installed releases' manifests: install an app and its events are
   * here, remove it and they are gone. Never throws.
   */
  async function appEventsFor(companyId: string): Promise<AutomationKnownEvent[]> {
    try {
      const rows = await db
        .select({ payload: storeItemVersions.payload, enabled: storeInstalls.enabled })
        .from(storeInstalls)
        .innerJoin(storeItemVersions, eq(storeItemVersions.id, storeInstalls.versionId))
        .where(and(eq(storeInstalls.companyId, companyId), eq(storeInstalls.enabled, true)));
      const out: AutomationKnownEvent[] = [];
      for (const row of rows) {
        const payload = row.payload as Record<string, unknown> | null;
        const manifest = payload?.app && typeof payload.app === "object" ? (payload.app as Record<string, unknown>) : null;
        if (!manifest) continue;
        for (const event of declaredEvents(manifest)) {
          out.push({ name: event, description: `Emitted by the ${String(manifest.name ?? manifest.id ?? "installed")} app.`, app: String(manifest.id ?? "") });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async function knownEvents(companyId: string): Promise<AutomationKnownEvent[]> {
    return [...AUTOMATION_PLATFORM_EVENTS, ...(await appEventsFor(companyId))];
  }

  /**
   * The catalogue as a builder reads it. forOwner leaves out the platform-only
   * steps; `events` (knownEvents for a company) replaces the platform list.
   */
  function catalogue(options: { forOwner?: boolean; events?: AutomationKnownEvent[] | null; env?: Record<string, string | undefined> } = {}) {
    const forOwner = options.forOwner === true;
    return {
      steps: Object.entries(AUTOMATION_STEP_CATALOGUE)
        .filter(([, s]) => !(forOwner && s.adminOnly))
        .map(([type, s]) => ({
          type, label: s.label, description: s.description, category: s.category, icon: s.icon,
          side_effect: !!s.sideEffect, fields: s.fields,
        })),
      triggers: AUTOMATION_TRIGGER_TYPES,
      events: Array.isArray(options.events) ? options.events : [...AUTOMATION_PLATFORM_EVENTS],
      config_field_types: AUTOMATION_CONFIG_FIELD_TYPES,
      timezones: timezones(),
      default_timezone: defaultTimezone(options.env),
    };
  }

  return { appEventsFor, knownEvents, catalogue, validate: validateAutomationDefinition, parse: parseAutomationDefinition };
}

export type AutomationDefinitions = ReturnType<typeof automationDefinitions>;
