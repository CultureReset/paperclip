import { api } from "./client";

/** Mirrors STORE_ITEM_KINDS on the server (the database constraint). */
export type StoreItemKind = "plugin" | "pack" | "skill" | "automation" | "connector" | "agent" | "app" | "layout";
export type StoreItemStatus = "draft" | "published" | "retired";
export type StoreChannel = "stable" | "fast";
export type StoreAdvisoryType = "security" | "bugfix" | "enhancement";
export type StoreApprovalMode = "automatic" | "manual";

export interface StoreItemVersion {
  id: string;
  itemId: string;
  version: string;
  channel: StoreChannel;
  advisoryType: StoreAdvisoryType;
  required: boolean;
  changelog: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** An item as the platform admin sees it. */
export interface StoreAdminItem {
  id: string;
  key: string;
  kind: StoreItemKind;
  name: string;
  summary: string | null;
  description: string | null;
  iconUrl: string | null;
  pluginKey: string | null;
  status: StoreItemStatus;
  latestVersionId: string | null;
  installCount: number;
  versions: StoreItemVersion[];
}

/** An item as a company sees it in its store. */
export interface StoreListing {
  id: string;
  key: string;
  kind: StoreItemKind;
  name: string;
  summary: string | null;
  description: string | null;
  iconUrl: string | null;
  status: StoreItemStatus;
  latestVersion: string | null;
  installed: boolean;
  installedVersion: string | null;
  channel: StoreChannel | null;
  approvalMode: StoreApprovalMode | null;
  updateAvailable: boolean;
  updateAdvisory: StoreAdvisoryType | null;
  updateChangelog: string | null;
  contents: { skills: number; agents: number; routines: number; menu: string[] };
  /** The install row, null before install. */
  installId: string | null;
  installEnabled: boolean | null;
  /** The release shown: the installed one, or the latest on the channel. */
  versionId: string | null;
  /** An app's manifest (installed release, else latest); null for other kinds. */
  app: Record<string, unknown> | null;
  price: { amountCents: number; currency: string | null; interval: string | null; model: string | null } | null;
  approvedPermissions: string[];
}

export interface StoreRelease {
  version: string;
  channel: StoreChannel;
  advisoryType: StoreAdvisoryType;
  required: boolean;
  changelog?: string | null;
  payload?: Record<string, unknown>;
}

export interface StoreSubscription {
  channel?: StoreChannel;
  approvalMode?: StoreApprovalMode;
  /** Install only: optional permissions the owner declines. */
  declinedPermissions?: string[];
}

export interface StoreItemCreate {
  key: string;
  kind: StoreItemKind;
  name: string;
  summary?: string | null;
  description?: string | null;
  pluginKey?: string | null;
}

export interface MenuEntry {
  key: string;
  label: string;
  paths: string[];
}

export interface CompanyMenu {
  catalog: MenuEntry[];
  core: string[];
  visible: string[];
}

export const storeApi = {
  // Platform admin
  listAll: () => api.get<StoreAdminItem[]>("/store/admin/items"),
  create: (input: StoreItemCreate) => api.post<StoreAdminItem>("/store/admin/items", input),
  addVersion: (itemId: string, input: StoreRelease) =>
    api.post<{ appliedTo: number; pendingFor: number; failedFor: string[] }>(`/store/admin/items/${itemId}/versions`, input),
  publish: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/publish`, {}),
  retire: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/retire`, {}),

  menuSettings: () => api.get<{ catalog: MenuEntry[]; core: string[] }>("/store/admin/menu"),
  setCoreMenu: (core: string[]) => api.put<{ core: string[] }>("/store/admin/menu", { core }),

  // Company
  menu: (companyId: string) => api.get<CompanyMenu>(`/companies/${companyId}/menu`),
  list: (companyId: string) => api.get<StoreListing[]>(`/companies/${companyId}/store`),
  install: (companyId: string, itemId: string, subscription: StoreSubscription = {}) =>
    api.post<unknown>(`/companies/${companyId}/store/${itemId}/install`, subscription),
  setSubscription: (companyId: string, itemId: string, subscription: StoreSubscription) =>
    api.patch<unknown>(`/companies/${companyId}/store/${itemId}`, subscription),
  update: (companyId: string, itemId: string) => api.post<unknown>(`/companies/${companyId}/store/${itemId}/update`, {}),
  uninstall: (companyId: string, itemId: string) => api.delete<void>(`/companies/${companyId}/store/${itemId}`),
};
