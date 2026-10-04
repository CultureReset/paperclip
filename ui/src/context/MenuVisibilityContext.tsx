import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "./CompanyContext";
import { storeApi, type CompanyMenu } from "@/api/store";
import { queryKeys } from "@/lib/queryKeys";

type IsVisible = (path: string) => boolean;

/** Outside the provider (tests, standalone pages) every menu entry shows. */
const MenuVisibilityContext = createContext<IsVisible>(() => true);

function matches(path: string, route: string) {
  return path === route || path.startsWith(`${route}/`) || path.startsWith(`${route}?`);
}

export function isPathVisible(menu: CompanyMenu | undefined, path: string) {
  // Until the menu loads, keep gated entries hidden so they don't flash in and out.
  if (!menu) return !GATED_UNTIL_LOADED.some((route) => matches(path, route));
  const entry = menu.catalog.find((item) => item.paths.some((route) => matches(path, route)));
  // Routes the store does not manage (plugin pages, instance settings) always show.
  return !entry || menu.visible.includes(entry.key);
}

const GATED_UNTIL_LOADED = [
  "/issues", "/projects", "/routines", "/goals", "/artifacts", "/skills", "/workspaces", "/cases",
  "/pipelines", "/agents", "/org", "/apps", "/timeline", "/costs", "/activity", "/decisions", "/status", "/board-chat",
];

/** Which menu entries the selected company sees: the core menu plus what its installs turn on. */
export function MenuVisibilityProvider({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const { data } = useQuery({
    queryKey: queryKeys.store.menu(selectedCompanyId ?? ""),
    queryFn: () => storeApi.menu(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 60_000,
  });
  const isVisible = useCallback<IsVisible>((path) => isPathVisible(data, path), [data]);
  return <MenuVisibilityContext.Provider value={isVisible}>{children}</MenuVisibilityContext.Provider>;
}

export function useMenuVisible(): IsVisible {
  return useContext(MenuVisibilityContext);
}

/** True when at least one of `paths` is visible; used to drop empty sidebar sections. */
export function useAnyMenuVisible(paths: string[]) {
  const isVisible = useMenuVisible();
  return useMemo(() => paths.some(isVisible), [isVisible, paths]);
}
