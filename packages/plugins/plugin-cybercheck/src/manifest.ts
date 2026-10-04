import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { CONFIG_KEYS, PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const sectionParam = { type: "string", description: "Section name, e.g. menu_items. Call business_list_sections first." };
const idParam = { type: ["string", "integer"], description: "The row's id, as returned by business_read_section." };

/**
 * Platform infrastructure, installed for every company (not a store item).
 * One Paperclip company is one business. The business-link setup job stores
 * the company's business token as a company secret and binds it here;
 * gcr-api-clean decides which business that token is, so nothing here ever
 * names a slug. Agents installed from the store get their own, narrower
 * install token, bound per agent under `agentTokens`.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Business data",
  description: "Gives each company's agents tools to read and change that company's business data in gcr-api-clean.",
  author: "CultureReset",
  categories: ["connector"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      [CONFIG_KEYS.apiBaseUrl]: {
        type: "string",
        title: "gcr-api-clean URL",
        description: "Written by the platform from the server's GCR_API_URL.",
      },
      [CONFIG_KEYS.businessToken]: {
        type: "string",
        format: "secret-ref",
        title: "Business token",
        description: "Written by the platform when the company is linked to its business.",
      },
      [CONFIG_KEYS.agentTokens]: {
        type: "object",
        title: "Agent install tokens",
        description: "Written by the platform when an agent is installed from the store.",
        additionalProperties: { type: "string", format: "secret-ref" },
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.whoami,
      displayName: "Which business",
      description: "The business this company is connected to, and whether this agent's token may write.",
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
};

export default manifest;
