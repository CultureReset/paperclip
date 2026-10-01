import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginManagedAgentResolution
} from "@paperclipai/plugin-sdk";
import { RESEARCH_AGENT_KEY } from "./manifest.js";

type CatalogItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  provisioned: boolean;
  configured: boolean;
  status: string;
  agentId: string | null;
  setupMessage?: string;
};

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = typeof params.companyId === "string" ? params.companyId.trim() : "";
  if (!companyId) throw new Error("companyId is required");
  return companyId;
}

function hasHermesApiKey(resolution: PluginManagedAgentResolution): boolean {
  const value = resolution.agent?.adapterConfig?.apiKey;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref" &&
    typeof (value as { secretId?: unknown }).secretId === "string"
  );
}

function itemFromResolution(resolution: PluginManagedAgentResolution): CatalogItem {
  const configured = hasHermesApiKey(resolution);
  const agent = resolution.agent;
  return {
    id: RESEARCH_AGENT_KEY,
    name: "Research Assistant",
    description: "Hermes-powered autonomous research employee managed by Paperclip.",
    enabled: agent?.status === "idle" || agent?.status === "running",
    provisioned: Boolean(resolution.agentId),
    configured,
    status: agent?.status ?? resolution.status,
    agentId: resolution.agentId,
    setupMessage: configured
      ? undefined
      : "Enter the Hermes API key once in Research Assistant → Configuration. Paperclip stores it as a secret reference."
  };
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.data.register("catalog", async (params) => {
      const companyId = requireCompanyId(params);
      const research = await ctx.agents.managed.get(RESEARCH_AGENT_KEY, companyId);
      return { items: [itemFromResolution(research)] };
    });

    ctx.actions.register("enable", async (params) => {
      const companyId = requireCompanyId(params);
      const key = typeof params.id === "string" ? params.id : "";
      if (key !== RESEARCH_AGENT_KEY) throw new Error("Unknown NEXT GENT capability");

      let resolution = await ctx.agents.managed.reconcile(RESEARCH_AGENT_KEY, companyId);
      if (!resolution.agentId) {
        return {
          ok: false,
          item: itemFromResolution(resolution),
          message: resolution.approvalId
            ? "Paperclip is waiting for the required managed-agent approval."
            : "Paperclip could not provision the Research Assistant."
        };
      }

      if (resolution.agent?.status === "paused") {
        await ctx.agents.resume(resolution.agentId, companyId);
        resolution = await ctx.agents.managed.get(RESEARCH_AGENT_KEY, companyId);
      }

      const item = itemFromResolution(resolution);
      return {
        ok: true,
        item,
        message: item.configured
          ? "Research Assistant enabled."
          : "Research Assistant provisioned. Add the Hermes API key in its Paperclip configuration before assigning work."
      };
    });

    ctx.actions.register("disable", async (params) => {
      const companyId = requireCompanyId(params);
      const key = typeof params.id === "string" ? params.id : "";
      if (key !== RESEARCH_AGENT_KEY) throw new Error("Unknown NEXT GENT capability");

      const resolution = await ctx.agents.managed.get(RESEARCH_AGENT_KEY, companyId);
      if (resolution.agentId && resolution.agent?.status !== "paused") {
        await ctx.agents.pause(resolution.agentId, companyId);
      }
      const current = await ctx.agents.managed.get(RESEARCH_AGENT_KEY, companyId);
      return {
        ok: true,
        item: itemFromResolution(current),
        message: "Research Assistant disabled. Paperclip history, tasks, and results were preserved."
      };
    });
  },

  async onHealth() {
    return { status: "ok", message: "NEXT GENT capability catalog ready" };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
