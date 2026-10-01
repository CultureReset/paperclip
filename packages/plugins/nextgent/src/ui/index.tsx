import { useMemo, useState } from "react";
import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginPageProps,
  type PluginSidebarProps
} from "@paperclipai/plugin-sdk/ui";

type CatalogItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  provisioned: boolean;
  configured: boolean;
  status: string;
  agentId: string | null;
  setupMessage?: string;
};

type CatalogData = { items: CatalogItem[] };
type ActionResult = { ok?: boolean; message?: string; item?: CatalogItem };

export function SidebarLink(_props: PluginSidebarProps) {
  const navigation = useHostNavigation();
  return (
    <a
      {...navigation.linkProps("/nextgent")}
      className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
      style={{ textDecoration: "none" }}
    >
      <span aria-hidden="true">◇</span>
      <span className="flex-1 truncate">NEXT GENT</span>
    </a>
  );
}

export function NextGentPage({ context }: PluginPageProps) {
  const catalog = usePluginData<CatalogData>(
    "catalog",
    context.companyId ? { companyId: context.companyId } : {}
  );
  const enable = usePluginAction("enable");
  const disable = usePluginAction("disable");
  const toast = usePluginToast();
  const [working, setWorking] = useState<Record<string, boolean>>({});

  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data?.items]);

  async function change(item: CatalogItem, nextEnabled: boolean) {
    if (!context.companyId || working[item.id]) return;
    setWorking((current) => ({ ...current, [item.id]: true }));
    try {
      const action = nextEnabled ? enable : disable;
      const result = await action({
        companyId: context.companyId,
        id: item.id
      }) as ActionResult;

      toast({
        title: result.ok === false ? "NEXT GENT needs attention" : result.message || item.name,
        body: result.item?.setupMessage,
        tone: result.ok === false ? "warn" : "success"
      });
      await catalog.refresh();
    } catch (error) {
      toast({
        title: `Could not ${nextEnabled ? "enable" : "disable"} ${item.name}`,
        body: error instanceof Error ? error.message : String(error),
        tone: "error"
      });
    } finally {
      setWorking((current) => ({ ...current, [item.id]: false }));
    }
  }

  if (!context.companyId) {
    return <main style={{ padding: 24 }}>Select a company to use NEXT GENT.</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0 }}>NEXT GENT</h1>
        <p style={{ opacity: 0.72, marginTop: 6, maxWidth: 720 }}>
          Add prepared AI capabilities to this Paperclip company. Paperclip remains the company, work, agent, budget, approval, and history control plane.
        </p>
      </header>

      {catalog.loading ? <p>Loading capabilities…</p> : null}
      {catalog.error ? <p>Capability catalog error: {String(catalog.error)}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14
        }}
      >
        {items.map((item) => {
          const busy = Boolean(working[item.id]);
          return (
            <section
              key={item.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 16,
                display: "grid",
                gap: 12
              }}
            >
              <div>
                <strong style={{ fontSize: 16 }}>{item.name}</strong>
                <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                  {item.description}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                <span>Status: {item.enabled ? "Enabled" : item.provisioned ? "Disabled" : "Not installed"}</span>
                <span>•</span>
                <span>Runtime: Hermes</span>
              </div>

              {item.setupMessage ? (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10,
                    fontSize: 12,
                    opacity: 0.85
                  }}
                >
                  {item.setupMessage}
                </div>
              ) : null}

              <button
                type="button"
                disabled={busy}
                onClick={() => void change(item, !item.enabled)}
                style={{
                  justifySelf: "start",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "7px 14px",
                  background: "transparent",
                  color: "inherit",
                  cursor: busy ? "default" : "pointer"
                }}
              >
                {busy ? "Working…" : item.enabled ? "Disable" : "Enable"}
              </button>
            </section>
          );
        })}
      </div>
    </main>
  );
}
