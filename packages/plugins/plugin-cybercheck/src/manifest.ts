import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_API_BASE_URL,
  EXPORT_NAMES,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
} from "./constants.js";

const sectionParam = { type: "string", description: "Section name, e.g. menu_items. Call business_list_sections first." };
const idParam = { type: ["string", "integer"], description: "The row's id, as returned by business_read_section." };

/**
 * One Paperclip company is one business. The company's settings hold the
 * business token minted in gcr-api-clean (`gcr_mcp_…`); gcr-api-clean decides
 * which business that token is, so nothing here ever names a slug.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "CyberCheck Business",
  description: "Shows and edits this company's business data from gcr-api-clean, and gives its agents tools to do the same.",
  author: "CultureReset",
  categories: ["connector", "ui"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiBaseUrl: {
        type: "string",
        title: "gcr-api-clean URL",
        description: "Where the API runs. Leave as is for production.",
        default: DEFAULT_API_BASE_URL,
      },
      businessToken: {
        type: "string",
        format: "secret-ref",
        title: "Business token",
        description: "The gcr_mcp_… token for this company's business. Mint one from POST /api/mcp/tokens while signed in as the owner.",
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.whoami,
      displayName: "Which business",
      description: "The business this company is connected to, and whether its token may write.",
      parametersSchema: { type: "object", properties: {} },
    },
    {
      name: TOOL_NAMES.listSections,
      displayName: "List business sections",
      description: "Every section (table) the business has data in, with a row count for each. Start here.",
      parametersSchema: {
        type: "object",
        properties: { include_empty: { type: "boolean", description: "Also list sections with no rows." } },
      },
    },
    {
      name: TOOL_NAMES.describeSection,
      displayName: "Describe a business section",
      description: "The columns of one section and whether each can be edited. Call before creating or updating rows.",
      parametersSchema: { type: "object", properties: { section: sectionParam }, required: ["section"] },
    },
    {
      name: TOOL_NAMES.readSection,
      displayName: "Read business rows",
      description: "Rows from one section, optionally filtered by text. Quote figures from here rather than estimating.",
      parametersSchema: {
        type: "object",
        properties: {
          section: sectionParam,
          search: { type: "string", description: "Match this text in any text column." },
          limit: { type: "integer", description: "Rows to return, 1-500. Default 50." },
          offset: { type: "integer", description: "Rows to skip. Default 0." },
        },
        required: ["section"],
      },
    },
    {
      name: TOOL_NAMES.createRow,
      displayName: "Add a business row",
      description: "Add one row to a section. The business is stamped on it automatically.",
      parametersSchema: {
        type: "object",
        properties: { section: sectionParam, values: { type: "object", description: "Column name to value." } },
        required: ["section", "values"],
      },
    },
    {
      name: TOOL_NAMES.updateRow,
      displayName: "Change a business row",
      description: "Change the given columns of one row, found by id.",
      parametersSchema: {
        type: "object",
        properties: { section: sectionParam, id: idParam, values: { type: "object", description: "Column name to new value." } },
        required: ["section", "id", "values"],
      },
    },
    {
      name: TOOL_NAMES.deleteRow,
      displayName: "Delete a business row",
      description: "Permanently remove one row by id. There is no undo — confirm with a person first.",
      parametersSchema: {
        type: "object",
        properties: { section: sectionParam, id: idParam },
        required: ["section", "id"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Business",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: "Business",
        exportName: EXPORT_NAMES.sidebar,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Business",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
    ],
  },
};

export default manifest;
