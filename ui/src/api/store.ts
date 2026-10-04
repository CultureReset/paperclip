import { api } from "./client";

export type StoreItemKind = "plugin" | "pack" | "skill" | "automation" | "connector";
export type StoreItemStatus = "draft" | "published" | "retired";

export interface StoreItemVersion {
  id: string;
  itemId: string;
  version: string;
  changelog: string | null;
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
  updateAvailable: boolean;
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
  addVersion: (itemId: string, input: { version: string; changelog?: string | null; push: boolean }) =>
    api.post<{ pushedTo: number }>(`/store/admin/items/${itemId}/versions`, input),
  publish: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/publish`, {}),
  retire: (itemId: string) => api.post<StoreAdminItem>(`/store/admin/items/${itemId}/retire`, {}),

  // Company
  list: (companyId: string) => api.get<StoreListing[]>(`/companies/${companyId}/store`),
  install: (companyId: string, itemId: string) => api.post<unknown>(`/companies/${companyId}/store/${itemId}/install`, {}),
  update: (companyId: string, itemId: string) => api.post<unknown>(`/companies/${companyId}/store/${itemId}/update`, {}),
  uninstall: (companyId: string, itemId: string) => api.delete<void>(`/companies/${companyId}/store/${itemId}`),
};
