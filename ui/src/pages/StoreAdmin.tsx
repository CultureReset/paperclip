import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store as StoreIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { storeApi, type StoreAdminItem, type StoreAdvisoryType, type StoreChannel, type StoreItemKind } from "@/api/store";
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

const CONTENTS_EXAMPLE = JSON.stringify(
  {
    skills: [{ key: "booking", name: "Booking", markdown: "# Booking\n\nHow to book a charter." }],
    menu: ["tasks"],
    agents: [{ key: "receptionist", name: "Receptionist", instructions: "Answer calls and book trips." }],
    routines: [{ key: "morning", title: "Morning check", agentKey: "receptionist", cron: "0 8 * * *" }],
  },
  null,
  2,
);

const STATUS_LABELS: Record<StoreAdminItem["status"], string> = {
  draft: "Draft",
  published: "Published",
  retired: "Unpublished",
};

/** Platform admin: create store items, publish them and release updates. */
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
                      {item.versions[0] ? `Latest v${item.versions[0].version} (${item.versions[0].channel})` : "No versions yet"} ·{" "}
                      {item.installCount} {item.installCount === 1 ? "company" : "companies"} installed
                      {item.pluginKey ? ` · ${item.pluginKey}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setVersionFor(item)}>
                      New release
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

      <CoreMenuCard />

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} onError={onError} />
      <NewVersionDialog item={versionFor} onClose={() => setVersionFor(null)} onSaved={refresh} onError={onError} />
    </div>
  );
}

/** Which menu entries every company sees before installing anything. */
function CoreMenuCard() {
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const menuQuery = useQuery({ queryKey: queryKeys.store.adminMenu, queryFn: () => storeApi.menuSettings() });
  const [core, setCore] = useState<string[] | null>(null);
  useEffect(() => {
    if (menuQuery.data) setCore(menuQuery.data.core);
  }, [menuQuery.data]);

  const save = useMutation({
    mutationFn: () => storeApi.setCoreMenu(core ?? []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store"] });
      pushToast({ title: "Core menu saved", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Could not save the core menu", body: err.message, tone: "error" }),
  });

  if (!menuQuery.data || !core) return null;
  const locked = new Set(LOCKED_MENU);
  const dirty = core.slice().sort().join() !== menuQuery.data.core.slice().sort().join();

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="font-medium">Core menu</h2>
          <p className="text-sm text-muted-foreground">
            Every company sees these. Everything else shows up only after a company installs something that turns it on.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {menuQuery.data.catalog.map((entry) => (
            <label key={entry.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={core.includes(entry.key)}
                disabled={locked.has(entry.key)}
                onCheckedChange={(value) =>
                  setCore((current) =>
                    value === true ? [...(current ?? []), entry.key] : (current ?? []).filter((key) => key !== entry.key),
                  )
                }
              />
              {entry.label}
            </label>
          ))}
        </div>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving..." : "Save core menu"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Store and Settings are always on; the server enforces the same. */
const LOCKED_MENU = ["store", "settings"];

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
  const [channel, setChannel] = useState<StoreChannel>("stable");
  const [advisoryType, setAdvisoryType] = useState<StoreAdvisoryType>("enhancement");
  const [required, setRequired] = useState(false);
  const [contents, setContents] = useState("");

  // Start from the previous release's contents so a release only changes what is new.
  useEffect(() => {
    if (!item) return;
    const previous = item.versions[0]?.payload;
    setContents(previous && Object.keys(previous).length > 0 ? JSON.stringify(previous, null, 2) : "");
  }, [item]);

  let parsedContents: Record<string, unknown> | undefined;
  let contentsError: string | null = null;
  if (contents.trim()) {
    try {
      const value = JSON.parse(contents);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Contents must be a JSON object");
      parsedContents = value;
    } catch (err) {
      contentsError = (err as Error).message;
    }
  }

  const save = useMutation({
    mutationFn: () =>
      storeApi.addVersion(item!.id, {
        version,
        channel,
        advisoryType,
        required: advisoryType === "security" && required,
        changelog: changelog || null,
        payload: parsedContents ?? {},
      }),
    onSuccess: (result) => {
      onSaved();
      const companies = (n: number) => `${n} ${n === 1 ? "company" : "companies"}`;
      pushToast({
        title: `Released v${version}`,
        body:
          `Updated ${companies(result.appliedTo)}. Waiting on ${companies(result.pendingFor)} that update manually.` +
          (result.failedFor.length ? ` Failed for ${companies(result.failedFor.length)}; they can retry with Update.` : ""),
        tone: "success",
      });
      setVersion("");
      setChangelog("");
      setChannel("stable");
      setAdvisoryType("enhancement");
      setRequired(false);
      onClose();
    },
    onError,
  });

  const selectClass = "h-9 rounded-md border bg-background px-3 text-sm";

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New release of {item?.name}</DialogTitle>
          <DialogDescription>
            Companies on automatic updates get it right away. Companies on manual updates see an Update button.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="store-version">Version</Label>
            <Input id="store-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="store-channel">Channel</Label>
              <select id="store-channel" className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value as StoreChannel)}>
                <option value="stable">Stable (everyone)</option>
                <option value="fast">Fast (early access only)</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-advisory">Type</Label>
              <select
                id="store-advisory"
                className={selectClass}
                value={advisoryType}
                onChange={(e) => setAdvisoryType(e.target.value as StoreAdvisoryType)}
              >
                <option value="enhancement">New feature</option>
                <option value="bugfix">Bug fix</option>
                <option value="security">Security fix</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-changelog">What changed</Label>
            <Textarea id="store-changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} rows={3} />
          </div>
          {item?.kind !== "plugin" && (
            <div className="grid gap-2">
              <Label htmlFor="store-contents">Contents</Label>
              <Textarea
                id="store-contents"
                value={contents}
                onChange={(e) => setContents(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder={CONTENTS_EXAMPLE}
              />
              <p className="text-xs text-muted-foreground">
                The skills, agents and routines a company gets, plus any extra menu entries it turns on. Anything you
                leave out of a release is removed from companies when they take it.
              </p>
              {contentsError && <p className="text-xs text-destructive">{contentsError}</p>}
            </div>
          )}
          {advisoryType === "security" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} />
              Required: install it for every company, even manual ones
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!version || contentsError !== null || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Releasing..." : "Release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
