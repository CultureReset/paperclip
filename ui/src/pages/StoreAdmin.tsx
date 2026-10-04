import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store as StoreIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { storeApi, type StoreAdminItem, type StoreItemKind } from "@/api/store";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { STORE_KIND_LABELS } from "./Store";

const KINDS = Object.keys(STORE_KIND_LABELS) as StoreItemKind[];

const STATUS_LABELS: Record<StoreAdminItem["status"], string> = {
  draft: "Draft",
  published: "Published",
  retired: "Unpublished",
};

/** Platform admin: create store items, add versions, publish and push updates. */
export function StoreAdmin() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [versionFor, setVersionFor] = useState<StoreAdminItem | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Organization", href: "/dashboard" },
      { label: "Settings", href: "/company/settings" },
      { label: "Store publishing" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const itemsQuery = useQuery({ queryKey: queryKeys.store.admin, queryFn: () => storeApi.listAll() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["store"] });
  const onError = (err: Error) => pushToast({ title: "Store change failed", body: err.message, tone: "error" });

  const publish = useMutation({
    mutationFn: (item: StoreAdminItem) => (item.status === "published" ? storeApi.retire(item.id) : storeApi.publish(item.id)),
    onSuccess: (_result, item) => {
      refresh();
      pushToast({ title: item.status === "published" ? `Unpublished ${item.name}` : `Published ${item.name}`, tone: "success" });
    },
    onError,
  });

  const items = itemsQuery.data ?? [];

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StoreIcon className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Store publishing</h1>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New item
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        What you publish here appears in every company's Store. A company only sees an item in its workspace after it
        installs it.
      </p>

      {itemsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : itemsQuery.error ? (
        <p className="text-sm text-destructive">{(itemsQuery.error as Error).message}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={StoreIcon} title="No store items yet" message="Create an item, add a version, then publish it." action="New item" onAction={() => setCreateOpen(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="outline">{STORE_KIND_LABELS[item.kind]}</Badge>
                      <Badge variant={item.status === "published" ? "default" : "secondary"}>{STATUS_LABELS[item.status]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.versions[0] ? `Latest v${item.versions[0].version}` : "No versions yet"} ·{" "}
                      {item.installCount} {item.installCount === 1 ? "company" : "companies"} installed
                      {item.pluginKey ? ` · ${item.pluginKey}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setVersionFor(item)}>
                      New version
                    </Button>
                    <Button
                      size="sm"
                      variant={item.status === "published" ? "outline" : "default"}
                      disabled={publish.isPending}
                      onClick={() => publish.mutate(item)}
                    >
                      {item.status === "published" ? "Unpublish" : "Publish"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} onError={onError} />
      <NewVersionDialog item={versionFor} onClose={() => setVersionFor(null)} onSaved={refresh} onError={onError} />
    </div>
  );
}

function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (err: Error) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<StoreItemKind>("pack");
  const [summary, setSummary] = useState("");
  const [pluginKey, setPluginKey] = useState("");

  const create = useMutation({
    mutationFn: () =>
      storeApi.create({
        name,
        key,
        kind,
        summary: summary || null,
        pluginKey: kind === "plugin" ? pluginKey : null,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setKey("");
      setSummary("");
      setPluginKey("");
    },
    onError,
  });

  const keyFromName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New store item</DialogTitle>
          <DialogDescription>It stays a draft until you add a version and publish it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="store-name">Name</Label>
            <Input
              id="store-name"
              value={name}
              onChange={(e) => {
                const next = e.target.value;
                if (key === keyFromName(name)) setKey(keyFromName(next));
                setName(next);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-key">Key</Label>
            <Input id="store-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="front-desk" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-kind">Type</Label>
            <select
              id="store-kind"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as StoreItemKind)}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {STORE_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {kind === "plugin" && (
            <div className="grid gap-2">
              <Label htmlFor="store-plugin-key">Plugin key</Label>
              <Input
                id="store-plugin-key"
                value={pluginKey}
                onChange={(e) => setPluginKey(e.target.value)}
                placeholder="The plugin's id from Settings → Plugins"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="store-summary">Short description</Label>
            <Textarea id="store-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name || !key || (kind === "plugin" && !pluginKey) || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewVersionDialog({
  item,
  onClose,
  onSaved,
  onError,
}: {
  item: StoreAdminItem | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (err: Error) => void;
}) {
  const { pushToast } = useToastActions();
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [push, setPush] = useState(true);

  const save = useMutation({
    mutationFn: () => storeApi.addVersion(item!.id, { version, changelog: changelog || null, push }),
    onSuccess: (result) => {
      onSaved();
      pushToast({
        title: `Saved v${version}`,
        body: push ? `Pushed to ${result.pushedTo} ${result.pushedTo === 1 ? "company" : "companies"}.` : undefined,
        tone: "success",
      });
      setVersion("");
      setChangelog("");
      onClose();
    },
    onError,
  });

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New version of {item?.name}</DialogTitle>
          <DialogDescription>The newest version is what new installs get.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="store-version">Version</Label>
            <Input id="store-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-changelog">What changed</Label>
            <Textarea id="store-changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} rows={3} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={push} onCheckedChange={(value) => setPush(value === true)} />
            Push this version to every company that installed it
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!version || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving..." : "Save version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
