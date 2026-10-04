import type { Db } from "@paperclipai/db";
import { getConfiguredSecretProvider } from "../secrets/configured-provider.js";
import { secretService } from "./secrets.js";

/**
 * Company secrets the platform writes for NEXT GENT (business token, LiteLLM
 * key, install tokens). Values are written once and never returned by any
 * NEXT GENT endpoint.
 */
export function nextgentSecrets(db: Db) {
  const secrets = secretService(db);

  return {
    /** Create the named secret, or rotate it to `value` when it already exists. Returns the secret id. */
    async put(companyId: string, name: string, value: string, description: string, userId: string | null): Promise<string> {
      const existing = await secrets.getByName(companyId, name);
      if (existing && existing.status === "active") {
        await secrets.rotate(existing.id, { value }, { userId });
        return existing.id;
      }
      const created = await secrets.create(
        companyId,
        { name, provider: getConfiguredSecretProvider(), value, description },
        { userId },
      );
      return created.id;
    },

    async idByName(companyId: string, name: string): Promise<string | null> {
      const existing = await secrets.getByName(companyId, name);
      return existing && existing.status === "active" ? existing.id : null;
    },

    async valueByName(companyId: string, name: string): Promise<string | null> {
      const existing = await secrets.getByName(companyId, name);
      if (!existing || existing.status !== "active") return null;
      return secrets.resolveSecretValue(companyId, existing.id, "latest");
    },

    async remove(secretId: string | null | undefined) {
      if (!secretId) return;
      const existing = await secrets.getById(secretId);
      if (!existing || existing.status === "deleted") return;
      await secrets.remove(secretId);
    },
  };
}
