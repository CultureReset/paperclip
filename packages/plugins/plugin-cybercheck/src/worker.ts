import { definePlugin, runWorker, type PluginContext, type ToolResult, type ToolRunContext } from "@paperclipai/plugin-sdk";
import { CONFIG_KEYS, TOOL_NAMES } from "./constants.js";
import { gcr, GcrError, normalizeBaseUrl, type GcrConnection } from "./gcr.js";
import manifest from "./manifest.js";

interface SecretRefBinding {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
}

/** Raised when a company has not been linked to its business yet. */
export class NotConfiguredError extends Error {
  constructor(detail = "This company is not linked to a business yet. Link it from the app's onboarding.") {
    super(detail);
    this.name = "NotConfiguredError";
  }
}

function isSecretRefBinding(value: unknown): value is SecretRefBinding {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { type?: unknown }).type === "secret_ref"
    && typeof (value as { secretId?: unknown }).secretId === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSection(params: Record<string, unknown>): string {
  const section = typeof params.section === "string" ? params.section.trim() : "";
  if (!section) throw new Error("A section is required.");
  return section;
}

function requireRowId(params: Record<string, unknown>): string | number {
  const id = params.id;
  if ((typeof id === "string" && id.trim()) || typeof id === "number") return id;
  throw new Error("A row id is required.");
}

function valuesOf(params: Record<string, unknown>): Record<string, unknown> {
  const values = params.values;
  if (!isRecord(values)) throw new Error("Values must be an object of column name to value.");
  return values;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Build the connection for one agent run. The company comes from the run,
 * never from tool arguments. An agent installed from the store uses its own
 * install token (limited to what the owner approved); every other agent of
 * the company, Jarvis included, uses the company's business token. Tokens
 * are resolved at call time and never stored or logged.
 */
export async function connectionFor(
  ctx: PluginContext,
  run: Pick<ToolRunContext, "companyId"> & Partial<Pick<ToolRunContext, "agentId">>,
): Promise<GcrConnection> {
  const companyId = run.companyId;
  if (!companyId) throw new Error("A company is required.");
  const config = await ctx.config.get(companyId);
  const baseUrl = normalizeBaseUrl(config[CONFIG_KEYS.apiBaseUrl], "");
  if (!baseUrl) throw new NotConfiguredError("The platform has no gcr-api-clean URL configured for this company.");

  const agentTokens = isRecord(config[CONFIG_KEYS.agentTokens]) ? config[CONFIG_KEYS.agentTokens] as Record<string, unknown> : {};
  const agentRef = run.agentId ? agentTokens[run.agentId] : undefined;
  let token: string | null = null;
  if (run.agentId && isSecretRefBinding(agentRef)) {
    token = await ctx.secrets.resolve(agentRef, { companyId, configPath: `${CONFIG_KEYS.agentTokens}.${run.agentId}` });
  } else if (isSecretRefBinding(config[CONFIG_KEYS.businessToken])) {
    token = await ctx.secrets.resolve(config[CONFIG_KEYS.businessToken] as SecretRefBinding, {
      companyId,
      configPath: CONFIG_KEYS.businessToken,
    });
  }
  if (!token) throw new NotConfiguredError();
  return { baseUrl, token, fetch: (url, init) => ctx.http.fetch(url, init) };
}

function toolFailure(error: unknown): ToolResult {
  return { error: error instanceof Error ? error.message : String(error) };
}

function toolSuccess(data: unknown): ToolResult {
  return { content: JSON.stringify(data, null, 2), data };
}

const plugin = definePlugin({
  async setup(ctx) {
    const declarations = new Map((manifest.tools ?? []).map((tool) => [tool.name, tool]));
    const registerTool = (name: string, run: (conn: GcrConnection, args: Record<string, unknown>) => Promise<unknown>) => {
      const declaration = declarations.get(name);
      if (!declaration) throw new Error(`Tool ${name} is not declared in the manifest.`);
      ctx.tools.register(name, declaration, async (params, runCtx) => {
        try {
          const args = isRecord(params) ? params : {};
          return toolSuccess(await run(await connectionFor(ctx, runCtx), args));
        } catch (error) {
          return toolFailure(error);
        }
      });
    };

    registerTool(TOOL_NAMES.whoami, (conn) => gcr.whoami(conn));
    registerTool(TOOL_NAMES.listSections, (conn, args) => gcr.listSections(conn, args.include_empty === true));
    registerTool(TOOL_NAMES.describeSection, (conn, args) => gcr.describeSection(conn, requireSection(args)));
    registerTool(TOOL_NAMES.readSection, (conn, args) => gcr.readSection(conn, {
      section: requireSection(args),
      search: typeof args.search === "string" && args.search.trim() ? args.search.trim() : undefined,
      limit: clampInt(args.limit, 50, 1, 500),
      offset: clampInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    }));
    registerTool(TOOL_NAMES.createRow, (conn, args) => gcr.createRow(conn, requireSection(args), valuesOf(args)));
    registerTool(TOOL_NAMES.updateRow, (conn, args) => gcr.updateRow(conn, requireSection(args), requireRowId(args), valuesOf(args)));
    registerTool(TOOL_NAMES.deleteRow, (conn, args) => gcr.deleteRow(conn, requireSection(args), requireRowId(args)));

    ctx.logger.info("Business data tools ready");
  },

  async onHealth() {
    return { status: "ok", message: "Business data tools ready" };
  },
});

export { GcrError };
export default plugin;
runWorker(plugin, import.meta.url);
