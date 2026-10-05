import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeInstallResources, storeInstalls, storeItems, storeItemVersions } from "@paperclipai/db";
import { conflict, HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { NEXTGENT_SECRET_NAMES, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { nextgentBusinessPlugin } from "./nextgent-business-plugin.js";
import { gcrClient, type FetchLike, type GcrBusinessKind, type GcrEntitlement } from "./nextgent-gcr-client.js";
import { nextgentSecrets } from "./nextgent-secrets.js";
import { routineService } from "./routines.js";
import {
  PLATFORM_RESOURCE_KEY_PREFIX,
  storeContentService,
  storeNextgentSectionSchema,
  type StoreNextgentSection,
} from "./store-content.js";

type ItemRow = typeof storeItems.$inferSelect;
type InstallRow = typeof storeInstalls.$inferSelect;
type VersionRow = typeof storeItemVersions.$inferSelect;

/** Each skipped step is logged once per process, not once per install. */
const warnedSkips = new Set<string>();

/** Resource key of the routine an automation hands work to. */
export const HANDOFF_ROUTINE_KEY = `${PLATFORM_RESOURCE_KEY_PREFIX}nextgent-handoff`;

/** Actions that change things or reach people get the warning badge on the consent screen. */
const CHANGING_ACTIONS = new Set(["write", "send"]);

/**
 * Kinds gcr-api-clean projects into the business whether or not the release
 * declares a NEXT GENT section (Step 3 contract §A): their install is always
 * registered, and every version move and switch is sent on.
 */
const PROJECTED_KINDS = new Set(["app", "layout"]);
export function isProjectedKind(kind: string) {
  return PROJECTED_KINDS.has(kind);
}

function manifestField(payload: unknown, field: "app" | "layout"): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[field];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The release's app manifest (`payload.app`) when it carries one. */
export function appManifestOf(payload: unknown): Record<string, unknown> | null {
  return manifestField(payload, "app");
}

/**
 * What gcr-api-clean projects for an install of `kind`: a layout's `layout`
 * (`payload.layout`), anything else's `app`. A layout never sends `app`
 * (gcr-api-clean layoutFrom, DECISIONS #31).
 */
function projectedManifest(kind: string, payload: unknown): { app: Record<string, unknown> } | { layout: Record<string, unknown> } | Record<never, never> {
  if (kind === "layout") {
    const layout = manifestField(payload, "layout");
    return layout ? { layout } : {};
  }
  const app = manifestField(payload, "app");
  return app ? { app } : {};
}

/** Whether gcr-api-clean has been told about this install (it was activated at least once). */
export function registeredUpstream(install: { approvedPermissions: unknown; tokenSecretId: string | null }) {
  return install.approvedPermissions !== null || install.tokenSecretId !== null;
}

/** The release's NEXT GENT section, or null when it declares none (or is not valid). */
export function nextgentSectionOf(payload: unknown): StoreNextgentSection | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>).nextgent;
  if (raw === undefined || raw === null) return null;
  const parsed = storeNextgentSectionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** Every permission a release declares, required and optional. */
export function permissionsOf(section: StoreNextgentSection | null): string[] {
  return sorted((section?.permissions ?? []).map((entry) => entry.permission));
}

export function requiredPermissionsOf(section: StoreNextgentSection | null): string[] {
  return sorted((section?.permissions ?? []).filter((entry) => !entry.optional).map((entry) => entry.permission));
}

export function optionalPermissionsOf(section: StoreNextgentSection | null): string[] {
  return sorted((section?.permissions ?? []).filter((entry) => entry.optional).map((entry) => entry.permission));
}

/**
 * Required permissions a release asks for that the owner has not approved:
 * these hold an update until the owner says yes. New optional ones never
 * block; they are simply not granted until the owner grants them.
 */
export function newPermissions(approved: string[] | null | undefined, section: StoreNextgentSection | null): string[] {
  const have = new Set(approved ?? []);
  return requiredPermissionsOf(section).filter((permission) => !have.has(permission));
}

/** What an install is granted at first install: everything required, plus the optional ones not declined. */
export function initialGrant(section: StoreNextgentSection | null, declined: string[] = []): string[] {
  const no = new Set(declined);
  return sorted([...requiredPermissionsOf(section), ...optionalPermissionsOf(section).filter((permission) => !no.has(permission))]);
}

/**
 * What an install is granted on a release: what it had that the release still
 * declares, plus the release's required ones (only reached once they are approved).
 */
export function carriedGrant(approved: string[] | null | undefined, section: StoreNextgentSection | null): string[] {
  const declared = new Set(permissionsOf(section));
  return sorted([...(approved ?? []).filter((permission) => declared.has(permission)), ...requiredPermissionsOf(section)]);
}

export function samePermissions(a: string[] | null | undefined, b: string[]) {
  const left = sorted(a ?? []);
  const right = sorted(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** What the install screen shows: "Needs access to", with a badge for anything that writes or acts. */
export function describePermissions(section: StoreNextgentSection | null) {
  return (section?.permissions ?? []).map((entry) => {
    const [resource, action] = entry.permission.split(":");
    return {
      permission: entry.permission,
      resource,
      action,
      reason: entry.reason,
      optional: entry.optional === true,
      changesThings: CHANGING_ACTIONS.has(action),
    };
  });
}

export interface StoreCharge {
  priceCents: number | null;
  interval: string | null;
}

function chargeOf(entitlement: GcrEntitlement | null): StoreCharge | null {
  if (!entitlement) return null;
  return {
    priceCents: typeof entitlement.priceCents === "number" ? entitlement.priceCents : null,
    interval: typeof entitlement.interval === "string" ? entitlement.interval : null,
  };
}

/**
 * The store's link to gcr-api-clean (plan §7): entitlement and price before an
 * install, a scoped token per install, the "give this to an agent" routine for
 * automations, and revocation on uninstall. Without GCR_API_URL and
 * NEXTGENT_SERVICE_SECRET every step is skipped with a warning (dev).
 */
export function nextgentStoreBridge(db: Db, options: { config?: NextgentConfig; fetch?: FetchLike } = {}) {
  const config = options.config ?? readNextgentConfig();
  const gcr = gcrClient({ config, fetch: options.fetch });
  const secrets = nextgentSecrets(db);
  const plugin = nextgentBusinessPlugin(db, { config });
  const content = storeContentService(db);
  const routines = routineService(db);

  function warnSkipped(what: string, context: Record<string, unknown>) {
    if (warnedSkips.has(what)) return;
    warnedSkips.add(what);
    logger.warn(context, `GCR_API_URL / NEXTGENT_SERVICE_SECRET not set: ${what} skipped (dev only)`);
  }

  async function lookupEntitlement(companyId: string, itemKey: string): Promise<GcrEntitlement | null> {
    if (!gcr.configured) {
      warnSkipped("entitlement check", { companyId, itemKey });
      return null;
    }
    return gcr.entitlement(companyId, itemKey);
  }

  async function syncPlugin(companyId: string) {
    try {
      await plugin.sync(companyId);
    } catch (error) {
      logger.error({ err: error, companyId }, "Could not write the business-data plugin config after an install change");
    }
  }

  /** The agent an automation hands work to: in this release, or in another installed item. */
  async function handoffAgentId(companyId: string, item: ItemRow, handoff: NonNullable<StoreNextgentSection["handoff"]>) {
    let itemId = item.id;
    if (handoff.itemKey && handoff.itemKey !== item.key) {
      const other = await db.select().from(storeItems).where(eq(storeItems.key, handoff.itemKey)).then((rows) => rows[0] ?? null);
      if (!other) throw conflict(`This automation needs "${handoff.itemKey}", which is not in the store`);
      itemId = other.id;
    }
    const binding = await db
      .select()
      .from(storeInstallResources)
      .where(and(
        eq(storeInstallResources.companyId, companyId),
        eq(storeInstallResources.itemId, itemId),
        eq(storeInstallResources.resourceKind, "agent"),
        eq(storeInstallResources.resourceKey, handoff.agentKey),
      ))
      .then((rows) => rows[0] ?? null);
    if (!binding) {
      throw conflict(
        handoff.itemKey && handoff.itemKey !== item.key
          ? `Install "${handoff.itemKey}" first: this automation hands work to its agent`
          : `This automation's agent "${handoff.agentKey}" was not created`,
      );
    }
    return binding.resourceId;
  }

  /** Create the agent's routine with an HMAC-signed webhook trigger; the secret is only available now. */
  async function createHandoffRoutine(companyId: string, item: ItemRow, section: StoreNextgentSection, userId: string | null) {
    const handoff = section.handoff;
    if (!handoff) return null;
    const assigneeAgentId = await handoffAgentId(companyId, item, handoff);
    const routine = await routines.create(companyId, {
      title: handoff.title ?? item.name,
      description: `Work handed over by the "${item.name}" automation.`,
      assigneeAgentId,
      priority: "medium",
      status: "active",
      concurrencyPolicy: "always_enqueue",
      catchUpPolicy: "skip_missed",
      variables: [],
    }, { userId });
    const { secretMaterial } = await routines.createTrigger(routine.id, {
      kind: "webhook",
      signingMode: "hmac_sha256",
      replayWindowSec: 300,
      enabled: true,
    }, { userId });
    await content.bind(companyId, item.id, "routine", HANDOFF_ROUTINE_KEY, routine.id);
    if (!secretMaterial) throw new HttpError(500, "Routine webhook was created without its secret");
    return { webhookUrl: secretMaterial.webhookUrl, webhookSecret: secretMaterial.webhookSecret };
  }

  async function storeInstallToken(install: InstallRow, token: string, userId: string | null) {
    const secretId = await secrets.put(
      install.companyId,
      NEXTGENT_SECRET_NAMES.installToken(install.id),
      token,
      "Business-data token for one store install (issued by gcr-api-clean)",
      userId,
    );
    await db.update(storeInstalls).set({ tokenSecretId: secretId, updatedAt: new Date() }).where(eq(storeInstalls.id, install.id));
    return secretId;
  }

  return {
    /** Before install: refuse when the plan does not allow it; otherwise what will be charged. */
    async assertEntitled(companyId: string, itemKey: string): Promise<StoreCharge | null> {
      const entitlement = await lookupEntitlement(companyId, itemKey);
      if (entitlement && !entitlement.allowed) {
        throw new HttpError(402, entitlement.reason ?? "This item is not included in the business's plan", {
          code: "not_entitled",
          ...chargeOf(entitlement),
        });
      }
      return chargeOf(entitlement);
    },

    /**
     * Forward an item's price to gcr-api-clean's billing. Returns its answer,
     * or null when gcr-api-clean is not configured (dev: price kept locally only).
     */
    async setPrice(itemKey: string, price: { amountCents: number; currency: string; interval: string | null; model: string | null }) {
      if (!gcr.configured) {
        warnSkipped("price forwarding", { itemKey });
        return null;
      }
      return gcr.setItemPrice(itemKey, price);
    },

    /**
     * The kinds of the linked businesses, from gcr-api-clean, most common
     * first. Business kinds are business state (DECISIONS #32): without
     * gcr-api-clean there are none, never a local copy.
     */
    async businessKinds(): Promise<GcrBusinessKind[]> {
      if (!gcr.configured) {
        warnSkipped("business kinds", {});
        return [];
      }
      const kinds = await gcr.businessKinds();
      return kinds.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    },

    /** The consent screen: permissions with reasons, and the charge, without installing. */
    async consent(companyId: string, item: ItemRow, version: VersionRow | null) {
      const section = nextgentSectionOf(version?.payload);
      const entitlement = await lookupEntitlement(companyId, item.key);
      return {
        itemId: item.id,
        itemKey: item.key,
        name: item.name,
        version: version?.version ?? null,
        kind: section?.kind ?? null,
        needsAccessTo: describePermissions(section),
        allowed: entitlement ? entitlement.allowed : true,
        reason: entitlement?.reason ?? null,
        charge: chargeOf(entitlement),
      };
    },

    /**
     * Tell gcr-api-clean about a new install (or new permissions on an existing
     * one) and keep the token it returns. The routine webhook goes with the
     * first activation only; gcr-api-clean keeps it.
     */
    async activate(input: {
      item: ItemRow;
      install: InstallRow;
      version: VersionRow;
      userId: string | null;
      firstActivation: boolean;
      /** The permissions granted to this install (see initialGrant / carriedGrant). */
      permissions: string[];
    }) {
      const section = nextgentSectionOf(input.version.payload);
      // An app or a layout is registered even without a section: gcr-api-clean
      // keeps its projection (the manifest, the switch) for the business's page.
      const projected = isProjectedKind(input.item.kind);
      const registered = section !== null || projected;
      const permissions = sorted(input.permissions);
      const optionalGranted = optionalPermissionsOf(section).filter((permission) => permissions.includes(permission));
      await db
        .update(storeInstalls)
        .set({ approvedPermissions: registered ? permissions : null, updatedAt: new Date() })
        .where(eq(storeInstalls.id, input.install.id));
      if (!registered) return null;
      if (!gcr.configured) {
        warnSkipped("install registration", { companyId: input.install.companyId, itemKey: input.item.key });
        return null;
      }
      const kind = section?.kind ?? (input.item.kind as "app" | "layout");
      const routine = input.firstActivation && section ? await createHandoffRoutine(input.install.companyId, input.item, section, input.userId) : null;
      const result = await gcr.install({
        companyId: input.install.companyId,
        installId: input.install.id,
        itemKey: input.item.key,
        kind,
        version: input.version.version,
        permissions,
        // Which of those the owner could have declined; gcr-api-clean may ignore it.
        optionalPermissions: optionalGranted,
        ...(routine ? { routine } : {}),
        ...projectedManifest(input.item.kind, input.version.payload),
        enabled: input.install.enabled,
      });
      if (typeof result?.token === "string" && result.token && kind !== "automation") {
        await storeInstallToken(input.install, result.token, input.userId);
      }
      // Rewritten with or without a token: an agent whose install got none is
      // listed as having no token, so the plugin refuses instead of falling
      // back to the company's business token.
      await syncPlugin(input.install.companyId);
      await logActivity(db, {
        companyId: input.install.companyId,
        actorType: input.userId ? "user" : "system",
        actorId: input.userId ?? "store",
        action: "nextgent.install_authorized",
        entityType: "store_item",
        entityId: input.item.id,
        details: { itemKey: input.item.key, kind, version: input.version.version, permissions },
      });
      return { charged: result?.charged === true };
    },

    /**
     * A version move that changes no permissions: gcr-api-clean is told the new
     * version and the manifest it carries (`PATCH` with `app`, or `layout` for a
     * layout), so the projection follows the release. Nothing to tell for an install it never got.
     */
    async moveVersion(item: ItemRow, install: InstallRow, version: VersionRow) {
      if (!registeredUpstream(install)) return null;
      if (!gcr.configured) {
        warnSkipped("install version update", { companyId: install.companyId, installId: install.id });
        return null;
      }
      return gcr.patchInstall(install.id, { version: version.version, ...projectedManifest(item.kind, version.payload) });
    },

    /** The owner's switch: gcr-api-clean's projection is turned on or off with it (`PATCH { enabled }`). */
    async setEnabled(install: InstallRow, enabled: boolean) {
      if (!registeredUpstream(install)) return null;
      if (!gcr.configured) {
        warnSkipped("install switch", { companyId: install.companyId, installId: install.id });
        return null;
      }
      return gcr.patchInstall(install.id, { enabled });
    },

    /**
     * Uninstall: gcr-api-clean revokes the token and disables the automation
     * first. For an app it switches the projection off and keeps the app's
     * data (DECISIONS #22); the `DELETE` keeps that meaning.
     */
    async deactivate(install: InstallRow) {
      if (registeredUpstream(install)) {
        if (gcr.configured) {
          try {
            await gcr.uninstall(install.id);
          } catch (error) {
            // Already gone upstream is fine; anything else stops the uninstall.
            if (!(error instanceof HttpError && error.status === 404)) throw error;
          }
        } else {
          warnSkipped("install revocation", { companyId: install.companyId, installId: install.id });
        }
      }
      return async () => {
        await syncPlugin(install.companyId);
        await secrets.remove(install.tokenSecretId);
      };
    },
  };
}

export type NextgentStoreBridge = ReturnType<typeof nextgentStoreBridge>;
