export const PLUGIN_ID = "culturereset.cybercheck";
export const PLUGIN_VERSION = "0.1.0";

/** Where gcr-api-clean runs in production. Each company can point elsewhere. */
export const DEFAULT_API_BASE_URL = "https://gcr-api-clean.vercel.app";

export const PAGE_ROUTE = "business";

export const SLOT_IDS = {
  page: "cybercheck-business-page",
  sidebar: "cybercheck-business-sidebar",
  dashboardWidget: "cybercheck-business-widget",
} as const;

export const EXPORT_NAMES = {
  page: "BusinessPage",
  sidebar: "BusinessSidebarLink",
  dashboardWidget: "BusinessWidget",
} as const;

export const DATA_KEYS = {
  overview: "overview",
  section: "section",
} as const;

export const ACTION_KEYS = {
  createRow: "create-row",
  updateRow: "update-row",
  deleteRow: "delete-row",
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
