import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Store as StoreIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { storeApi, type StoreAdvisoryType, type StoreItemKind, type StoreListing, type StoreSubscription } from "@/api/store";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";

export const STORE_KIND_LABELS: Record<StoreItemKind, string> = {
  plugin: "Plugin",
  pack: "Pack",
  skill: "Skill",
  automation: "Automation",
  connector: "Connector",
};

const ADVISORY_LABELS: Record<StoreAdvisoryType, string> = {
  security: "Security fix",
  bugfix: "Bug fix",
  enhancement: "New feature",
};

/**
 * The company's store: everything the platform admin has published. A company
 * only sees an item inside its workspace after installing it here.
 */
export function Store() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: selectedCompany?.name ?? "Organization", href: "/dashboard" }, { label: "Store" }]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const listingsQuery = useQuery({
    queryKey: queryKeys.store.company(selectedCompanyId ?? ""),
    queryFn: () => storeApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const refresh = () => {
    if (selectedCompanyId) queryClient.invalidateQueries({ queryKey: queryKeys.store.company(selectedCompanyId) });
    // Installing or removing a plugin changes which plugin screens this company sees.
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.uiContributions });
    // ...and which menu entries it has.
    if (selectedCompanyId) queryClient.invalidateQueries({ queryKey: queryKeys.store.menu(selectedCompanyId) });
  };

  const action = useMutation({
    mutationFn: async ({ kind, item }: { kind: StoreActionKind; item: StoreListing }) => {
      if (!selectedCompanyId) return;
      if (kind === "install") await storeApi.install(selectedCompanyId, item.id);
      if (kind === "update") await storeApi.update(selectedCompanyId, item.id);
      if (kind === "uninstall") await storeApi.uninstall(selectedCompanyId, item.id);
    },
    onSuccess: (_result, { kind, item }) => {
      refresh();
      const verb = kind === "install" ? "Installed" : kind === "update" ? "Updated" : "Removed";
      pushToast({ title: `${verb} ${item.name}`, tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Store action failed", body: err.message, tone: "error" }),
  });

  const subscription = useMutation({
    mutationFn: ({ item, change }: { item: StoreListing; change: StoreSubscription }) =>
      storeApi.setSubscription(selectedCompanyId!, item.id, change),
    onSuccess: refresh,
    onError: (err: Error) => pushToast({ title: "Could not change update settings", body: err.message, tone: "error" }),
  });

  const listings = listingsQuery.data ?? [];
  const installed = listings.filter((item) => item.installed);
  const available = listings.filter((item) => !item.installed);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <StoreIcon className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Store</h1>
      </div>

      {listingsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading store...</p>
      ) : listingsQuery.error ? (
        <p className="text-sm text-destructive">{(listingsQuery.error as Error).message}</p>
      ) : listings.length === 0 ? (
        <EmptyState icon={StoreIcon} title="Nothing in the store yet" message="New items show up here as soon as they are published." />
      ) : (
        <>
          {installed.length > 0 && (
            <StoreSection
              title="Installed"
              items={installed}
              busy={action.isPending || subscription.isPending}
              onAction={(kind, item) => action.mutate({ kind, item })}
              onSubscription={(item, change) => subscription.mutate({ item, change })}
            />
          )}
          {available.length > 0 && (
            <StoreSection
              title="Available"
              items={available}
              busy={action.isPending}
              onAction={(kind, item) => action.mutate({ kind, item })}
              onSubscription={() => {}}
            />
          )}
        </>
      )}
    </div>
  );
}

function contentsLine(item: StoreListing) {
  const parts = [
    [item.contents.agents, "agent"],
    [item.contents.skills, "skill"],
    [item.contents.routines, "routine"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`)
    .join(", ");
}

type StoreActionKind = "install" | "update" | "uninstall";

function StoreSection({
  title,
  items,
  busy,
  onAction,
  onSubscription,
}: {
  title: string;
  items: StoreListing[];
  busy: boolean;
  onAction: (kind: StoreActionKind, item: StoreListing) => void;
  onSubscription: (item: StoreListing, change: StoreSubscription) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
                    {item.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{STORE_KIND_LABELS[item.kind]}</Badge>
                    {(item.installedVersion ?? item.latestVersion) && (
                      <Badge variant="secondary">v{item.installedVersion ?? item.latestVersion}</Badge>
                    )}
                    {item.updateAvailable && (
                      <Badge variant={item.updateAdvisory === "security" ? "destructive" : "default"}>
                        {item.updateAdvisory ? ADVISORY_LABELS[item.updateAdvisory] : "Update"}: v{item.latestVersion}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
              {contentsLine(item) && <p className="text-xs text-muted-foreground">Includes {contentsLine(item)}</p>}
              {item.contents.menu.length > 0 && (
                <p className="text-xs text-muted-foreground">Adds to your menu: {item.contents.menu.join(", ")}</p>
              )}
              {item.updateAvailable && item.updateChangelog && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs">{item.updateChangelog}</p>
              )}
              {item.installed && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="grid gap-1">
                    <span className="text-muted-foreground">Updates</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2"
                      value={item.approvalMode ?? "automatic"}
                      disabled={busy}
                      onChange={(e) => onSubscription(item, { approvalMode: e.target.value as "automatic" | "manual" })}
                    >
                      <option value="automatic">Automatic</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="text-muted-foreground">Channel</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2"
                      value={item.channel ?? "stable"}
                      disabled={busy}
                      onChange={(e) => onSubscription(item, { channel: e.target.value as "stable" | "fast" })}
                    >
                      <option value="stable">Stable</option>
                      <option value="fast">Early access</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                {item.installed ? (
                  <>
                    {item.updateAvailable && (
                      <Button size="sm" disabled={busy} onClick={() => onAction("update", item)}>
                        Update
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("uninstall", item)}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button size="sm" disabled={busy || item.status !== "published"} onClick={() => onAction("install", item)}>
                    Install
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
