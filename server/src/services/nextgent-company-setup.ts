import { readFile } from "node:fs/promises";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import type { Agent } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { agentService } from "./agents.js";
import { litellmConfigured, NEXTGENT_SECRET_NAMES, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import type { FetchLike } from "./nextgent-gcr-client.js";
import { nextgentSecrets } from "./nextgent-secrets.js";

/**
 * Account setup job (plan §6), run when a sign-up creates its company:
 *   1. the company's LiteLLM key and budget (contract §8)
 *   2. the company's assistant agent (Jarvis)
 * Each step is independent and idempotent; a missing setting skips that step
 * with a warning. Nothing from the store is installed here.
 */

export type SetupStepResult = "created" | "exists" | "skipped" | "failed";

/**
 * Run the account setup for a new company when this server is a NEXT GENT
 * deployment: on a self-serve sign-up, or whenever any NEXT GENT setup
 * setting is present.
 */
export function shouldRunNextgentAccountSetup(selfServe: boolean, config: NextgentConfig = readNextgentConfig()) {
  return selfServe || litellmConfigured(config) || Boolean(config.assistant.name);
}

/** Marks the assistant agent so setup never creates a second one. */
export const ASSISTANT_METADATA_KEY = "nextgentAssistant";

export function nextgentCompanySetup(db: Db, options: { config?: NextgentConfig; fetch?: FetchLike } = {}) {
  const config = options.config ?? readNextgentConfig();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const secrets = nextgentSecrets(db);
  const agentSvc = agentService(db);

  async function ensureLitellmKey(companyId: string, userId: string | null): Promise<SetupStepResult> {
    if (!litellmConfigured(config)) {
      logger.warn({ companyId }, "LITELLM_URL / LITELLM_MASTER_KEY not set: company runs on the server-wide AI key (dev only)");
      return "skipped";
    }
    if (await secrets.idByName(companyId, NEXTGENT_SECRET_NAMES.litellmKey)) return "exists";
    const body: Record<string, unknown> = { metadata: { company_id: companyId }, key_alias: `company-${companyId}` };
    if (config.litellm.companyBudget !== null) body.max_budget = config.litellm.companyBudget;
    if (config.litellm.budgetDuration) body.budget_duration = config.litellm.budgetDuration;
    const response = await doFetch(`${config.litellm.url}/key/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.litellm.masterKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`LiteLLM /key/generate answered HTTP ${response.status}`);
    const payload = (await response.json()) as { key?: unknown };
    if (typeof payload.key !== "string" || !payload.key) throw new Error("LiteLLM /key/generate returned no key");
    await secrets.put(companyId, NEXTGENT_SECRET_NAMES.litellmKey, payload.key, "Model gateway key for this company's agents", userId);
    return "created";
  }

  async function findAssistant(companyId: string): Promise<string | null> {
    const rows = await db
      .select({ id: agents.id, metadata: agents.metadata })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated")));
    const found = rows.find((row) => (row.metadata as Record<string, unknown> | null)?.[ASSISTANT_METADATA_KEY] === true);
    return found?.id ?? null;
  }

  async function ensureAssistant(companyId: string): Promise<SetupStepResult> {
    const name = config.assistant.name;
    const adapterType = config.assistant.adapterType ?? process.env.PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE?.trim() ?? null;
    if (!name || !adapterType) {
      logger.warn(
        { companyId },
        "NEXTGENT_ASSISTANT_NAME and an adapter (NEXTGENT_ASSISTANT_ADAPTER_TYPE or PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE) are required to create the assistant; skipped",
      );
      return "skipped";
    }
    if (await findAssistant(companyId)) return "exists";
    const created = (await agentSvc.create(companyId, {
      name,
      role: "ceo",
      title: null,
      capabilities: null,
      adapterType,
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      budgetMonthlyCents: 0,
      status: "idle",
      metadata: { [ASSISTANT_METADATA_KEY]: true },
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    })) as Agent;
    if (config.assistant.instructionsFile) {
      const content = await readFile(config.assistant.instructionsFile, "utf8");
      const materialized = await agentInstructionsService().materializeManagedBundle(created, { "AGENTS.md": content }, {
        entryFile: "AGENTS.md",
        replaceExisting: true,
        clearLegacyPromptTemplate: true,
      });
      await agentSvc.update(created.id, { adapterConfig: materialized.adapterConfig }, {
        recordRevision: { source: "nextgent:setup" },
      });
    }
    return "created";
  }

  async function step(name: string, companyId: string, run: () => Promise<SetupStepResult>): Promise<SetupStepResult> {
    try {
      return await run();
    } catch (error) {
      logger.error({ err: error, companyId, step: name }, "NEXT GENT setup step failed; the company was still created");
      return "failed";
    }
  }

  return {
    ensureLitellmKey,
    ensureAssistant,

    /** Run the sign-up setup job. Never throws: a failed step must not undo the sign-up. */
    async runAccountSetup(companyId: string, userId: string | null) {
      const result = {
        litellmKey: await step("litellm_key", companyId, () => ensureLitellmKey(companyId, userId)),
        assistant: await step("assistant", companyId, () => ensureAssistant(companyId)),
      };
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "nextgent-setup",
        action: "nextgent.account_setup",
        entityType: "company",
        entityId: companyId,
        details: result,
      }).catch(() => undefined);
      return result;
    },
  };
}
