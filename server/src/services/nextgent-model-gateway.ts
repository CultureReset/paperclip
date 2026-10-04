import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { litellmConfigured, NEXTGENT_SECRET_NAMES, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { nextgentSecrets } from "./nextgent-secrets.js";

/**
 * Per-company model gateway for agent runs (contract §8). When LiteLLM is
 * configured and the company has its key, an agent run's provider variables
 * point at LiteLLM with that key instead of the server-wide AI key. Values an
 * agent, project or routine sets explicitly still win, and a company that
 * picked its own AI connection never comes through here.
 *
 * The variables are the ones the CLI agents already read; their names are
 * fixed by those tools, not configuration.
 */
export const MODEL_GATEWAY_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_KEY"] as const;

let warnedUnconfigured = false;

export function modelGatewayEnvFor(url: string, key: string): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: key,
    // OpenAI-compatible clients expect the versioned base path.
    OPENAI_BASE_URL: `${url}/v1`,
    OPENAI_API_KEY: key,
  };
}

export async function companyModelGatewayEnv(
  db: Db,
  companyId: string,
  config: NextgentConfig = readNextgentConfig(),
): Promise<Record<string, string> | null> {
  if (!litellmConfigured(config)) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn("LiteLLM is not configured: agent runs use the server-wide AI key (dev only)");
    }
    return null;
  }
  const key = await nextgentSecrets(db).valueByName(companyId, NEXTGENT_SECRET_NAMES.litellmKey);
  if (!key) return null;
  return modelGatewayEnvFor(config.litellm.url as string, key);
}

/** Gateway variables fill in what the run does not set itself; explicit settings win. */
export function applyModelGatewayEnv(
  env: Record<string, unknown> | undefined,
  gateway: Record<string, string>,
): Record<string, unknown> {
  return { ...gateway, ...(env ?? {}) };
}
