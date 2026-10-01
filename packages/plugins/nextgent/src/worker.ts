import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext
} from "@paperclipai/plugin-sdk";

type NextGentConfig = {
  storeBaseUrl?: string;
};

const DEFAULT_STORE_URL = "http://127.0.0.1:7790";

async function configFor(ctx: PluginContext, companyId?: string): Promise<Required<NextGentConfig>> {
  const config = await ctx.config.get(companyId) as NextGentConfig | null;
  return {
    storeBaseUrl: (config?.storeBaseUrl || DEFAULT_STORE_URL).replace(/\/$/, "")
  };
}

function companyId(params: Record<string, unknown>): string {
  const value = typeof params.companyId === "string" ? params.companyId : "";
  if (!value) throw new Error("companyId is required");
  return value;
}

async function storeCall(
  ctx: PluginContext,
  currentCompanyId: string,
  key: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const config = await configFor(ctx, currentCompanyId);
  const response = await ctx.http.fetch(`${config.storeBaseUrl}/api/capability`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, args })
  });
  const body = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`NEXT GENT Store returned non-JSON (${response.status}): ${body.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(
      typeof parsed.message === "string"
        ? parsed.message
        : `NEXT GENT Store returned ${response.status}`
    );
  }
  return parsed;
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    ctx.data.register("catalog", async (params) => {
      const id = companyId(params);
      const [store, installed] = await Promise.all([
        storeCall(ctx, id, "apps.browse"),
        storeCall(ctx, id, "apps.installed").catch(() => ({ apps: [] }))
      ]);
      return { store, installed };
    });

    ctx.actions.register("install", async (params) => {
      const id = companyId(params);
      const app = typeof params.app === "string" ? params.app : "";
      if (!app) throw new Error("app is required");
      return await storeCall(ctx, id, "apps.add", { app });
    });

    ctx.actions.register("progress", async (params) => {
      const id = companyId(params);
      const jobId = typeof params.jobId === "string" ? params.jobId : "";
      if (!jobId) throw new Error("jobId is required");
      return await storeCall(ctx, id, "apps.progress", { jobId });
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "NEXT GENT Paperclip surface ready"
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
