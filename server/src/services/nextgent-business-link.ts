import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, nextgentBusinessLinks, storeInstalls } from "@paperclipai/db";
import { isUniqueViolation } from "../db-errors.js";
import { conflict, HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { NEXTGENT_SECRET_NAMES, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { nextgentBusinessPlugin } from "./nextgent-business-plugin.js";
import { gcrClient, type FetchLike, type GcrLinkRequest } from "./nextgent-gcr-client.js";
import { nextgentSecrets } from "./nextgent-secrets.js";

export type BusinessLinkInput =
  | { entitySlug: string; create?: undefined }
  | { entitySlug?: undefined; create: NonNullable<GcrLinkRequest["create"]> };

/**
 * The business-link setup job (plan §6, "once the business is linked").
 * After the owner picks, creates or claims a business in the app, Paperclip
 * asks gcr-api-clean to link it (signed), keeps the business token it gets
 * back as a company secret for the agents' business-data tools, and records
 * the slug and forwarding address on the company. The token never leaves the
 * server. Unlink tears the same things down.
 */
export function nextgentBusinessLinkService(db: Db, options: { config?: NextgentConfig; fetch?: FetchLike } = {}) {
  const config = options.config ?? readNextgentConfig();
  const gcr = gcrClient({ config, fetch: options.fetch });
  const secrets = nextgentSecrets(db);
  const plugin = nextgentBusinessPlugin(db, { config });

  async function get(companyId: string) {
    return db
      .select()
      .from(nextgentBusinessLinks)
      .where(eq(nextgentBusinessLinks.companyId, companyId))
      .then((rows) => rows[0] ?? null);
  }

  /** The signed-in owner's email, sent so gcr-api-clean can notify them. Paperclip holds no phone number. */
  async function ownerContact(userId: string | null): Promise<{ email: string } | null> {
    if (!userId) return null;
    const user = await db
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);
    return user?.email ? { email: user.email } : null;
  }

  async function syncPlugin(companyId: string) {
    try {
      if (!(await plugin.sync(companyId))) {
        logger.warn({ companyId }, "Business-data plugin is not installed yet; its config is written at the next boot");
      }
    } catch (error) {
      logger.error({ err: error, companyId }, "Could not write the business-data plugin config");
    }
  }

  return {
    get,

    async link(companyId: string, input: BusinessLinkInput, userId: string | null) {
      if (!gcr.configured) throw new HttpError(503, "Business linking is not configured on this server");
      const notify = await ownerContact(userId);
      const request = {
        companyId,
        ...(input.create ? { create: input.create } : { entitySlug: input.entitySlug }),
        ...(notify ? { notify } : {}),
      };
      let linked = await gcr.link(request);
      if (typeof linked?.entitySlug !== "string" || !linked.entitySlug) {
        throw new HttpError(502, "gcr-api-clean returned an incomplete link");
      }
      // The token is returned once. A repeat call answers without one; if this
      // server does not hold it (lost, or never stored), ask for a fresh one.
      const held = await secrets.idByName(companyId, NEXTGENT_SECRET_NAMES.businessToken);
      if (!linked.businessToken && !held) {
        linked = await gcr.link({ companyId, entitySlug: linked.entitySlug, rotateToken: true });
      }
      if (typeof linked?.entitySlug !== "string" || !linked.entitySlug) {
        throw new HttpError(502, "gcr-api-clean returned an incomplete link");
      }
      const forwardingAddress = typeof linked.forwardingAddress === "string" ? linked.forwardingAddress : null;
      // One business, one company: never keep a token for a business another company holds.
      const holder = await db
        .select({ companyId: nextgentBusinessLinks.companyId })
        .from(nextgentBusinessLinks)
        .where(eq(nextgentBusinessLinks.entitySlug, linked.entitySlug))
        .then((rows) => rows[0] ?? null);
      if (holder && holder.companyId !== companyId) throw conflict("That business is already linked to another account");
      const secretId = linked.businessToken
        ? await secrets.put(
            companyId,
            NEXTGENT_SECRET_NAMES.businessToken,
            linked.businessToken,
            "Business token for this company's agents (issued by gcr-api-clean)",
            userId,
          )
        : held;
      if (!secretId) throw new HttpError(502, "gcr-api-clean did not return the business token");
      try {
        await db
          .insert(nextgentBusinessLinks)
          .values({ companyId, entitySlug: linked.entitySlug, forwardingAddress, businessTokenSecretId: secretId, linkedByUserId: userId })
          .onConflictDoUpdate({
            target: nextgentBusinessLinks.companyId,
            set: { entitySlug: linked.entitySlug, forwardingAddress, businessTokenSecretId: secretId, linkedByUserId: userId, updatedAt: new Date() },
          });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict("That business is already linked to another account");
        throw error;
      }
      await syncPlugin(companyId);
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "nextgent",
        action: "nextgent.business_linked",
        entityType: "company",
        entityId: companyId,
        details: { entitySlug: linked.entitySlug, created: Boolean(input.create) },
      });
      return { entitySlug: linked.entitySlug, forwardingAddress };
    },

    /** Teardown: gcr-api-clean revokes and (optionally) exports; Paperclip drops its secrets and the link. */
    async unlink(companyId: string, exportData: boolean, userId: string | null) {
      const existing = await get(companyId);
      let upstream: Record<string, unknown> = {};
      if (gcr.configured) {
        upstream = await gcr.unlink({ companyId, export: exportData });
      } else {
        logger.warn({ companyId }, "GCR_API_URL / NEXTGENT_SERVICE_SECRET not set: unlinking locally only");
      }
      const installTokens = await db
        .select({ id: storeInstalls.id, tokenSecretId: storeInstalls.tokenSecretId })
        .from(storeInstalls)
        .where(eq(storeInstalls.companyId, companyId));
      await db.delete(nextgentBusinessLinks).where(eq(nextgentBusinessLinks.companyId, companyId));
      for (const install of installTokens) {
        if (!install.tokenSecretId) continue;
        await db.update(storeInstalls).set({ tokenSecretId: null, updatedAt: new Date() }).where(eq(storeInstalls.id, install.id));
      }
      // Config first, so nothing is left pointing at a secret being deleted.
      await syncPlugin(companyId);
      await secrets.remove(existing?.businessTokenSecretId ?? (await secrets.idByName(companyId, NEXTGENT_SECRET_NAMES.businessToken)));
      for (const install of installTokens) await secrets.remove(install.tokenSecretId);
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "nextgent",
        action: "nextgent.business_unlinked",
        entityType: "company",
        entityId: companyId,
        details: { entitySlug: existing?.entitySlug ?? null, export: exportData },
      });
      const exportUrl = typeof upstream.exportUrl === "string" ? upstream.exportUrl : null;
      return { unlinked: true, entitySlug: existing?.entitySlug ?? null, ...(exportUrl ? { exportUrl } : {}) };
    },
  };
}
