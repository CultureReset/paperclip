import { useMemo, useState } from "react";
import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginPageProps,
  type PluginSidebarProps
} from "@paperclipai/plugin-sdk/ui";

type AppRecord = {
  id: string;
  name: string;
  what?: string;
  size?: string;
};

type CatalogResult = {
  store?: {
    ok?: boolean;
    count?: number;
    apps?: AppRecord[];
    message?: string;
  };
  installed?: {
    apps?: string[];
  };
};

type InstallResult = {
  ok?: boolean;
  jobId?: string;
  message?: string;
};

type ProgressResult = {
  state?: string;
  message?: string;
};

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function NextGentPage({ context }: PluginPageProps) {
  const catalog = usePluginData<CatalogResult>(
    "catalog",
    context.companyId ? { companyId: context.companyId } : {}
  );
  const install = usePluginAction("install");
  const progress = usePluginAction("progress");
  const toast = usePluginToast();
  const [working, setWorking] = useState<Record<string, boolean>>({});

  const installed = useMemo(
    () => new Set(catalog.data?.installed?.apps ?? []),
    [catalog.data?.installed?.apps]
  );

  async function add(app: AppRecord) {
    if (!context.companyId || working[app.id]) return;
    setWorking((current) => ({ ...current, [app.id]: true }));
    try {
      const started = await install({
        companyId: context.companyId,
        app: app.id
      }) as InstallResult;
      if (!started.ok || !started.jobId) {
        throw new Error(started.message || "NEXT GENT could not start the install");
      }
      for (let i = 0; i < 600; i += 1) {
        await sleep(1000);
        const state = await progress({
          companyId: context.companyId,
          jobId: started.jobId
        }) as ProgressResult;
        if (state.state === "done") {
          toast({ title: `${app.name} enabled`, tone: "success" });
          await catalog.refresh();
          return;
        }
        if (state.state === "failed") {
          throw new Error(state.message || "Installation failed");
        }
      }
      throw new Error("Installation timed out");
    } catch (error) {
      toast({
        title: `Could not enable ${app.name}`,
        body: error instanceof Error ? error.message : String(error),
        tone: "error"
      });
    } finally {
      setWorking((current) => ({ ...current, [app.id]: false }));
    }
  }

  if (!context.companyId) {
    return <main style={{ padding: 24 }}>Select a company to use NEXT GENT.</main>;
  }

  if (catalog.loading) {
    return <main style={{ padding: 24 }}>Loading NEXT GENT capabilities…</main>;
  }

  if (catalog.error) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>NEXT GENT</h1>
        <p>Store service unavailable: {String(catalog.error)}</p>
      </main>
    );
  }

  const apps = catalog.data?.store?.apps ?? [];

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>NEXT GENT</h1>
        <p style={{ opacity: 0.72, marginTop: 6 }}>
          Add capabilities to this Paperclip company. Paperclip remains the work and agent control plane.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
          gap: 12
        }}
      >
        {apps.map((app) => {
          const isInstalled = installed.has(app.id);
          const isWorking = Boolean(working[app.id]);
          return (
            <section
              key={app.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 16,
                display: "grid",
                gap: 10
              }}
            >
              <div>
                <strong>{app.name}</strong>
                <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                  {app.what || ""}
                </div>
                {app.size ? (
                  <div style={{ opacity: 0.55, fontSize: 11, marginTop: 5 }}>{app.size}</div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={isInstalled || isWorking}
                onClick={() => void add(app)}
                style={{
                  justifySelf: "start",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "7px 14px",
                  background: "transparent",
                  color: "inherit",
                  cursor: isInstalled || isWorking ? "default" : "pointer",
                  opacity: isInstalled ? 0.65 : 1
                }}
              >
                {isInstalled ? "Enabled" : isWorking ? "Enabling…" : "Enable"}
              </button>
            </section>
          );
        })}
      </div>

      {apps.length === 0 ? (
        <p style={{ opacity: 0.72 }}>No Store items are available from the configured NEXT GENT service.</p>
      ) : null}
    </main>
  );
}
