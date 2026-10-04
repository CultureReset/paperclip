export const PLUGIN_ID = "culturereset.cybercheck";
export const PLUGIN_VERSION = "0.2.0";

/**
 * Config keys the platform writes for each company. Nobody pastes these: the
 * server's business-link setup job fills them in (see
 * server/src/services/nextgent-business-link.ts).
 */
export const CONFIG_KEYS = {
  /** Where gcr-api-clean runs, copied from the server's GCR_API_URL. */
  apiBaseUrl: "apiBaseUrl",
  /** secret_ref to the company's business token (read + write, used by Jarvis). */
  businessToken: "businessToken",
  /** agentId → secret_ref of that agent's own store-install token. */
  agentTokens: "agentTokens",
} as const;

/**
 * Agent tools. Each one is a thin pass-through to the gcr-api-clean MCP tool
 * of the same name, so a Paperclip agent works on the company's business with
 * exactly the rights its token grants and nothing more.
 */
export const TOOL_NAMES = {
  whoami: "business_whoami",
  listSections: "business_list_sections",
  describeSection: "business_describe_section",
  readSection: "business_read_section",
  createRow: "business_create_row",
  updateRow: "business_update_row",
  deleteRow: "business_delete_row",
} as const;
