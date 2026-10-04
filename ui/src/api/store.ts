import { api } from "./client";

export type StoreItemKind = "plugin" | "pack" | "skill" | "automation" | "connector";
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
  contents: { skills: number; agents: number; routines: number };
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
}

export interface StoreItemCreate {
  key: string;
  kind: StoreItemKind;
  name: string;
  summary?: string | null;
  description?: string | null;
  pluginKey?: string | null;
}

export const storeApi = {
  // Platform admin
  listAll: () => api.get<StoreAdminItem[]>("/store/admin/items"),
  create: (input: StoreItemCreate) => api.post<StoreAdminItem>("/store/admin/items", input),
  addVersion: (itemId: string, input: StoreRelease) =>
    api.post<{ appliedTo: number; pendingFor: number; failedFor: string[] }>(`/store/admin/items/${itemId}/versions`, input),
  publish: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/publish`, {}),
  retire: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/retire`, {}),

  // Company
  list: (companyId: string) => api.get<StoreListing[]>(`/companies/${companyId}/store`),
  install: (companyId: string, itemId: string, subscription: StoreSubscription = {}) =>
    api.post<unknown>(`/companies/${companyId}/store/${itemId}/install`, subscription),
  setSubscription: (companyId: string, itemId: string, subscription: StoreSubscription) =>
    api.patch<unknown>(`/companies/${companyId}/store/${itemId}`, subscription),
  update: (companyId: string, itemId: string) => api.post<unknown>(`/companies/${companyId}/store/${itemId}/update`, {}),
  uninstall: (companyId: string, itemId: string) => api.delete<void>(`/companies/${companyId}/store/${itemId}`),
};
