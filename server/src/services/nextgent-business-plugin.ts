import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { nextgentBusinessLinks, pluginConfig, storeInstallResources, storeInstalls } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { extractSecretRefBindingsFromConfig } from "./plugin-secrets-handler.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { secretService } from "./secrets.js";

/** Registry key of the business-data plugin (packages/plugins/plugin-cybercheck). */
export const BUSINESS_PLUGIN_KEY = "culturereset.cybercheck";

function secretRef(secretId: string) {
  return { type: "secret_ref", secretId, version: "latest" } as const;
}

/**
 * Writes the business-data plugin's per-company config from what the platform
 * already knows, so nobody pastes a token:
 *   apiBaseUrl            ← GCR_API_URL
 *   businessToken         ← the company's business-link secret
 *   agentTokens[agentId]  ← the install token of the store install that created that agent
 * The config is rebuilt from those sources every time, never patched, so it
 * cannot drift from them.
 */
export function nextgentBusinessPlugin(db: Db, options: { config?: NextgentConfig } = {}) {
  const config = options.config ?? readNextgentConfig();
  const registry = pluginRegistryService(db);
  const secrets = secretService(db);

  async function desiredConfig(companyId: string): Promise<Record<string, unknown>> {
    const link = await db
      .select()
      .from(nextgentBusinessLinks)
      .where(eq(nextgentBusinessLinks.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    const tokenInstalls = await db
      .select({ itemId: storeInstalls.itemId, tokenSecretId: storeInstalls.tokenSecretId })
      .from(storeInstalls)
      .where(and(eq(storeInstalls.companyId, companyId), isNotNull(storeInstalls.tokenSecretId)));
    const agentTokens: Record<string, unknown> = {};
    for (const install of tokenInstalls) {
      const agentsOfInstall = await db
        .select({ resourceId: storeInstallResources.resourceId })
        .from(storeInstallResources)
        .where(and(
          eq(storeInstallResources.companyId, companyId),
          eq(storeInstallResources.itemId, install.itemId),
          eq(storeInstallResources.resourceKind, "agent"),
        ));
      for (const agent of agentsOfInstall) agentTokens[agent.resourceId] = secretRef(install.tokenSecretId as string);
    }
    const next: Record<string, unknown> = {};
    if (config.gcrApiUrl) next.apiBaseUrl = config.gcrApiUrl;
    if (link?.businessTokenSecretId) next.businessToken = secretRef(link.businessTokenSecretId);
    if (Object.keys(agentTokens).length > 0) next.agentTokens = agentTokens;
    return next;
  }

  /**
   * Bring one company's plugin config in line. Returns false when the plugin
   * is not installed on this instance yet; boot runs `syncAll` once it is.
   */
  async function sync(companyId: string): Promise<boolean> {
    const plugin = await registry.getByKey(BUSINESS_PLUGIN_KEY);
    if (!plugin || plugin.status === "uninstalled") return false;
    const next = await desiredConfig(companyId);
    const refs = extractSecretRefBindingsFromConfig(next, plugin.manifestJson?.instanceConfigSchema as Record<string, unknown> | undefined);
    await secrets.syncSecretRefsForTarget(companyId, { targetType: "plugin", targetId: plugin.id }, refs, { replaceAll: true });
    await registry.upsertConfig(plugin.id, companyId, { companyId, configJson: next });
    return true;
  }

  return {
    desiredConfig,
    sync,

    /** Boot reconciliation: every linked company, and every company the plugin already has config for. */
    async syncAll(): Promise<number> {
      const plugin = await registry.getByKey(BUSINESS_PLUGIN_KEY);
      if (!plugin || plugin.status === "uninstalled") return 0;
      const linked = await db.select({ companyId: nextgentBusinessLinks.companyId }).from(nextgentBusinessLinks);
      const configured = await db
        .select({ companyId: pluginConfig.companyId })
        .from(pluginConfig)
        .where(eq(pluginConfig.pluginId, plugin.id));
      const companyIds = new Set([...linked, ...configured].map((row) => row.companyId));
      let synced = 0;
      for (const companyId of companyIds) {
        try {
          if (await sync(companyId)) synced += 1;
        } catch (error) {
          logger.warn({ err: error, companyId }, "Could not sync the business-data plugin config for a company");
        }
      }
      return synced;
    },
  };
}
