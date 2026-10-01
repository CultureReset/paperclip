import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "nextgent.capabilities";
export const PLUGIN_VERSION = "0.1.0";
export const RESEARCH_AGENT_KEY = "research-assistant";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NEXT GENT",
  description: "NEXT GENT capability catalog and managed employees for Paperclip.",
  author: "NEXT GENT",
  categories: ["ui", "automation"],
  capabilities: [
    "agents.read",
    "agents.managed",
    "agents.pause",
    "agents.resume",
    "ui.sidebar.register",
    "ui.page.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  agents: [
    {
      agentKey: RESEARCH_AGENT_KEY,
      displayName: "Research Assistant",
      role: "researcher",
      title: "Research Assistant",
      icon: "search",
      capabilities: "Research businesses, competitors, markets, pricing, reviews, and attach durable reports to Paperclip work.",
      adapterType: "hermes_gateway",
      adapterConfig: {
        apiBaseUrl: "http://127.0.0.1:8642",
        paperclipApiUrl: "http://127.0.0.1:3100",
        sessionKeyStrategy: "issue",
        timeoutSec: 600,
        instructions: "You are the company's research specialist. Complete only the Paperclip work assigned to you. Use your own tools, skills, memory, MCP, browser, and internal subagents when useful. Put durable findings and completion state back on the Paperclip issue. Never claim external actions happened unless their executor reports success."
      },
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: {
        entryFile: "AGENTS.md",
        content: "# Research Assistant\n\nYou are the company's autonomous research specialist. Paperclip is authoritative for company work. Work the assigned issue, use Hermes capabilities internally as needed, attach or record durable results on the issue, and finish the issue with a concise summary. Do not create a second task system."
      }
    }
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "nextgent-sidebar",
        displayName: "NEXT GENT",
        exportName: "SidebarLink",
        order: 30
      },
      {
        type: "page",
        id: "nextgent-capabilities-page",
        displayName: "NEXT GENT",
        exportName: "NextGentPage",
        routePath: "nextgent"
      }
    ]
  }
};

export default manifest;
