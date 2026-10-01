import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "nextgent.store";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NEXT GENT",
  description: "Install and manage NEXT GENT capabilities from inside Paperclip.",
  author: "NEXT GENT",
  categories: ["ui", "automation", "connector"],
  capabilities: [
    "http.outbound",
    "ui.sidebar.register",
    "ui.page.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      storeBaseUrl: {
        type: "string",
        title: "NEXT GENT Store service",
        description: "Server-side URL for the existing nextgent-store service.",
        default: "http://127.0.0.1:7790"
      }
    }
  },
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
        id: "nextgent-store-page",
        displayName: "NEXT GENT",
        exportName: "NextGentPage",
        routePath: "nextgent"
      }
    ]
  }
};

export default manifest;
