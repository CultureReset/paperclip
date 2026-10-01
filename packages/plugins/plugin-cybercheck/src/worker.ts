import { definePlugin, runWorker, type PluginContext, type ToolResult } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS, DEFAULT_API_BASE_URL, TOOL_NAMES } from "./constants.js";
import { gcr, GcrError, normalizeBaseUrl, type GcrConnection } from "./gcr.js";
import manifest from "./manifest.js";

interface SecretRefBinding {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
}

/** Raised when a company has not been given a business token yet. */
export class NotConfiguredError extends Error {
  constructor() {
    super("This company is not connected to a business yet. Add its business token in the CyberCheck Business plugin settings.");
    this.name = "NotConfiguredError";
  }
}

function isSecretRefBinding(value: unknown): value is SecretRefBinding {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { type?: unknown }).type === "secret_ref"
    && typeof (value as { secretId?: unknown }).secretId === "string";
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (!companyId) throw new Error("A company is required.");
  return companyId;
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
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Values must be an object of column name to value.");
  return values as Record<string, unknown>;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Build the connection for one company from its own settings. The token is
 * resolved at call time and never stored or logged.
 */
async function connectionFor(ctx: PluginContext, companyId: string): Promise<GcrConnection> {
  const config = await ctx.config.get(companyId);
  if (!isSecretRefBinding(config.businessToken)) throw new NotConfiguredError();
  const token = await ctx.secrets.resolve(config.businessToken, { companyId, configPath: "businessToken" });
  if (!token) throw new NotConfiguredError();
  return {
    baseUrl: normalizeBaseUrl(config.apiBaseUrl, DEFAULT_API_BASE_URL),
    token,
    fetch: (url, init) => ctx.http.fetch(url, init),
  };
}

function toolFailure(error: unknown): ToolResult {
  return { error: error instanceof Error ? error.message : String(error) };
}

function toolSuccess(data: unknown): ToolResult {
  return { content: JSON.stringify(data, null, 2), data };
}

const plugin = definePlugin({
  async setup(ctx) {
    /**
     * Everything the business page and the dashboard widget need on first
     * paint: who the business is and which sections hold data. A company
     * without a token gets `configured: false` rather than an error, so the
     * page can say how to connect instead of failing.
     */
    ctx.data.register(DATA_KEYS.overview, async (params) => {
      const companyId = requireCompanyId(params);
      let conn: GcrConnection;
      try {
        conn = await connectionFor(ctx, companyId);
      } catch (error) {
        if (error instanceof NotConfiguredError) return { configured: false, message: error.message };
        throw error;
      }
      const [business, sections] = await Promise.all([
        gcr.whoami(conn),
        gcr.listSections(conn, params.includeEmpty === true),
      ]);
      return { configured: true, apiBaseUrl: conn.baseUrl, business, sections: sections.sections ?? [] };
    });

    /** One section: its columns and a page of rows. */
    ctx.data.register(DATA_KEYS.section, async (params) => {
      const companyId = requireCompanyId(params);
      const section = requireSection(params);
      const conn = await connectionFor(ctx, companyId);
      const search = typeof params.search === "string" && params.search.trim() ? params.search.trim() : undefined;
      const [columns, rows] = await Promise.all([
        gcr.describeSection(conn, section),
        gcr.readSection(conn, {
          section,
          search,
          limit: clampInt(params.limit, 25, 1, 500),
          offset: clampInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER),
        }),
      ]);
      return { ...rows, section, columns: columns.columns ?? [] };
    });

    ctx.actions.register(ACTION_KEYS.createRow, async (params) => {
      const conn = await connectionFor(ctx, requireCompanyId(params));
      return gcr.createRow(conn, requireSection(params), valuesOf(params));
    });

    ctx.actions.register(ACTION_KEYS.updateRow, async (params) => {
      const conn = await connectionFor(ctx, requireCompanyId(params));
      return gcr.updateRow(conn, requireSection(params), requireRowId(params), valuesOf(params));
    });

    ctx.actions.register(ACTION_KEYS.deleteRow, async (params) => {
      const conn = await connectionFor(ctx, requireCompanyId(params));
      return gcr.deleteRow(conn, requireSection(params), requireRowId(params));
    });

    /**
     * Agent tools. The company comes from the agent's run, never from the
     * tool's arguments, so an agent can only touch its own company's business.
     */
    const declarations = new Map((manifest.tools ?? []).map((tool) => [tool.name, tool]));
    const registerTool = (name: string, run: (conn: GcrConnection, args: Record<string, unknown>) => Promise<unknown>) => {
      const declaration = declarations.get(name);
      if (!declaration) throw new Error(`Tool ${name} is not declared in the manifest.`);
      ctx.tools.register(name, declaration, async (params, runCtx) => {
        try {
          const args = params && typeof params === "object" ? params as Record<string, unknown> : {};
          return toolSuccess(await run(await connectionFor(ctx, runCtx.companyId), args));
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
      search: typeof args.search === "string" ? args.search : undefined,
      limit: clampInt(args.limit, 50, 1, 500),
      offset: clampInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    }));
    registerTool(TOOL_NAMES.createRow, (conn, args) => gcr.createRow(conn, requireSection(args), valuesOf(args)));
    registerTool(TOOL_NAMES.updateRow, (conn, args) => gcr.updateRow(conn, requireSection(args), requireRowId(args), valuesOf(args)));
    registerTool(TOOL_NAMES.deleteRow, (conn, args) => gcr.deleteRow(conn, requireSection(args), requireRowId(args)));

    ctx.logger.info("CyberCheck Business plugin ready");
  },

  async onHealth() {
    return { status: "ok", message: "CyberCheck Business plugin ready" };
  },
});

export { GcrError };
export default plugin;
runWorker(plugin, import.meta.url);
