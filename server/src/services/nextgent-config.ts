/**
 * NEXT GENT wiring settings, all from the environment. Nothing here has a
 * built-in address, name or limit: an unset value turns its feature off (with
 * a warning where the contract allows a dev fallback) instead of guessing.
 *
 * Every variable is documented in `.env.example` and `nextgent/.env.example`.
 */

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function trimSlash(value: string | null): string | null {
  return value ? value.replace(/\/+$/, "") : null;
}

function positiveInt(env: Env, key: string): number | null {
  const raw = read(env, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function positiveNumber(env: Env, key: string): number | null {
  const raw = read(env, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface NextgentConfig {
  /** gcr-api-clean base URL (GCR_API_URL). */
  gcrApiUrl: string | null;
  /** Shared HMAC secret for service-to-service calls (NEXTGENT_SERVICE_SECRET). */
  serviceSecret: string | null;
  /** Issuer for business tokens; must be the public address gcr-api-clean trusts. */
  publicUrl: string | null;
  litellm: {
    url: string | null;
    masterKey: string | null;
    /** Monthly budget per company key, in the gateway's currency units. */
    companyBudget: number | null;
    /** Budget window for the company key, e.g. "30d". */
    budgetDuration: string | null;
  };
  assistant: {
    /** Name of the per-company assistant agent created at sign-up. */
    name: string | null;
    /** Optional AGENTS.md for it. */
    instructionsFile: string | null;
    /** Adapter it runs on; falls back to the store/teams default adapter setting. */
    adapterType: string | null;
  };
  /** Company that receives conversations addressed to "nextgent" (the concierge). */
  platformCompanyId: string | null;
  /** Business-token lifetime in seconds (contract maximum 300). */
  businessTokenTtlSeconds: number;
}

export const BUSINESS_TOKEN_MAX_TTL_SECONDS = 300;

export function readNextgentConfig(env: Env = process.env): NextgentConfig {
  const ttl = positiveInt(env, "NEXTGENT_BUSINESS_TOKEN_TTL_SECONDS");
  return {
    gcrApiUrl: trimSlash(read(env, "GCR_API_URL")),
    serviceSecret: read(env, "NEXTGENT_SERVICE_SECRET"),
    publicUrl: trimSlash(read(env, "PAPERCLIP_PUBLIC_URL")),
    litellm: {
      url: trimSlash(read(env, "LITELLM_URL")),
      masterKey: read(env, "LITELLM_MASTER_KEY"),
      companyBudget: positiveNumber(env, "LITELLM_COMPANY_BUDGET"),
      budgetDuration: read(env, "LITELLM_BUDGET_DURATION"),
    },
    assistant: {
      name: read(env, "NEXTGENT_ASSISTANT_NAME"),
      instructionsFile: read(env, "NEXTGENT_ASSISTANT_INSTRUCTIONS_FILE"),
      adapterType: read(env, "NEXTGENT_ASSISTANT_ADAPTER_TYPE"),
    },
    platformCompanyId: read(env, "NEXTGENT_PLATFORM_COMPANY_ID"),
    businessTokenTtlSeconds: Math.min(ttl ?? BUSINESS_TOKEN_MAX_TTL_SECONDS, BUSINESS_TOKEN_MAX_TTL_SECONDS),
  };
}

/** gcr-api-clean is reachable for signed calls only when both settings are present. */
export function gcrConfigured(config: NextgentConfig): config is NextgentConfig & { gcrApiUrl: string; serviceSecret: string } {
  return Boolean(config.gcrApiUrl && config.serviceSecret);
}

export function litellmConfigured(config: NextgentConfig) {
  return Boolean(config.litellm.url && config.litellm.masterKey);
}

/** Company-secret names the platform writes. Fixed identifiers, not data. */
export const NEXTGENT_SECRET_NAMES = {
  businessToken: "NEXTGENT_BUSINESS_TOKEN",
  litellmKey: "NEXTGENT_LITELLM_KEY",
  installToken: (installId: string) => `NEXTGENT_INSTALL_TOKEN_${installId.replace(/-/g, "").toUpperCase()}`,
} as const;
