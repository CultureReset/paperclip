import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  MetricCard,
  Spinner,
  StatusBadge,
  usePluginAction,
  usePluginData,
  usePluginToast,
  useHostNavigation,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS, PAGE_ROUTE } from "../constants.js";
import type { Business, SectionColumn, SectionSummary } from "../gcr.js";

type Overview =
  | { configured: false; message: string }
  | { configured: true; apiBaseUrl: string; business: Business; sections: SectionSummary[] };

interface SectionData {
  section: string;
  columns: SectionColumn[];
  rows: Record<string, unknown>[];
  returned: number;
  total_matching: number | null;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 25;

// ── styles ────────────────────────────────────────────────────────────────

const stack: CSSProperties = { display: "grid", gap: 12 };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--card)" };
const muted: CSSProperties = { color: "var(--muted-foreground)", fontSize: 13 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const input: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 13,
  background: "var(--background)",
  color: "var(--foreground)",
  minWidth: 0,
};
const button: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  background: "var(--background)",
  color: "var(--foreground)",
  cursor: "pointer",
};
const primaryButton: CSSProperties = { ...button, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" };
const dangerButton: CSSProperties = { ...button, color: "var(--destructive)" };
const th: CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 600, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

// ── helpers ───────────────────────────────────────────────────────────────

function label(section: string): string {
  return section.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Turn what was typed back into the column's type before it is sent. */
function coerce(raw: string, column: SectionColumn): unknown {
  if (raw === "") return null;
  const type = column.type.toLowerCase();
  if (type === "integer" || type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") return raw === "true";
  if (type === "object" || type === "array" || type === "json" || type === "jsonb") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

// ── shared pieces ─────────────────────────────────────────────────────────

function NotConnected({ message }: { message: string }) {
  return (
    <div style={card}>
      <strong>Not connected to a business</strong>
      <p style={muted}>{message}</p>
      <ol style={{ ...muted, paddingLeft: 18, margin: 0 }}>
        <li>Sign in to the business dashboard as the owner and mint a token: <code>POST /api/mcp/tokens</code> with <code>{"{ \"scope\": \"write\" }"}</code>.</li>
        <li>Open Settings → Plugins → CyberCheck Business for this company.</li>
        <li>Paste the <code>gcr_mcp_…</code> token into <em>Business token</em> and save.</li>
      </ol>
    </div>
  );
}

function useOverview(companyId: string | null) {
  return usePluginData<Overview>(DATA_KEYS.overview, companyId ? { companyId } : {});
}

// ── row editor ────────────────────────────────────────────────────────────

function RowEditor({
  columns,
  initial,
  onCancel,
  onSave,
}: {
  columns: SectionColumn[];
  initial: Record<string, unknown> | null;
  onCancel: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const editable = columns.filter((c) => c.editable);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((c) => [c.name, display(initial?.[c.name])])),
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values: Record<string, unknown> = {};
    for (const column of editable) {
      const raw = draft[column.name] ?? "";
      // On an edit, send only what changed; on a new row, skip blanks.
      if (initial ? raw === display(initial[column.name]) : raw === "") continue;
      values[column.name] = coerce(raw, column);
    }
    setSaving(true);
    try {
      await onSave(values);
    } catch {
      // Already shown as a toast; keep the form open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...card, ...stack }}>
      <strong>{initial ? `Edit row ${display(initial.id)}` : "New row"}</strong>
      {editable.length === 0 && <span style={muted}>This section has no editable columns.</span>}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {editable.map((column) => (
          <label key={column.name} style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span style={muted}>{column.name} <span style={{ opacity: 0.6 }}>({column.type})</span></span>
            {column.values?.length ? (
              <select
                style={input}
                value={draft[column.name] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [column.name]: e.target.value }))}
              >
                <option value="" />
                {column.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : column.type === "boolean" ? (
              <select
                style={input}
                value={draft[column.name] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [column.name]: e.target.value }))}
              >
                <option value="" />
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                style={input}
                value={draft[column.name] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [column.name]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>
      <div style={row}>
        <button type="submit" style={primaryButton} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" style={button} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

// ── one section ───────────────────────────────────────────────────────────

function SectionView({ companyId, section, canWrite, onChanged }: {
  companyId: string;
  section: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Record<string, unknown> | "new" | null>(null);
  const toast = usePluginToast();
  const createRow = usePluginAction(ACTION_KEYS.createRow);
  const updateRow = usePluginAction(ACTION_KEYS.updateRow);
  const deleteRow = usePluginAction(ACTION_KEYS.deleteRow);

  useEffect(() => {
    setSearch("");
    setSearchInput("");
    setOffset(0);
    setEditing(null);
  }, [section]);

  const data = usePluginData<SectionData>(DATA_KEYS.section, { companyId, section, search, offset, limit: PAGE_SIZE });

  const visibleColumns = useMemo(() => {
    const columns = data.data?.columns ?? [];
    const hidden = new Set(["entity_slug"]);
    return columns.filter((c) => !hidden.has(c.name)).slice(0, 8);
  }, [data.data?.columns]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast({ title: done, tone: "success" });
      setEditing(null);
      data.refresh();
      onChanged();
    } catch (error) {
      toast({ title: "That did not work", body: errorText(error), tone: "error" });
      throw error;
    }
  }

  const total = data.data?.total_matching ?? null;
  const rows = data.data?.rows ?? [];

  return (
    <div style={stack}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{label(section)}</h2>
        <form
          style={row}
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(searchInput.trim());
          }}
        >
          <input style={input} placeholder="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          <button type="submit" style={button}>Search</button>
          {canWrite && <button type="button" style={primaryButton} onClick={() => setEditing("new")}>Add row</button>}
        </form>
      </div>

      {editing && data.data && (
        <RowEditor
          key={editing === "new" ? "new" : display(editing.id)}
          columns={data.data.columns}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(values) =>
            editing === "new"
              ? run(() => createRow({ companyId, section, values }), "Row added")
              : run(() => updateRow({ companyId, section, id: editing.id as string | number, values }), "Row saved")
          }
        />
      )}

      {data.error && <div style={{ ...card, color: "var(--destructive)" }}>{data.error.message}</div>}
      {data.loading && !data.data && <Spinner label="Loading rows" />}

      {data.data && (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {visibleColumns.map((c) => <th key={c.name} style={th}>{c.name}</th>)}
                {canWrite && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td style={{ ...td, ...muted }} colSpan={visibleColumns.length + 1}>No rows{search ? ` match “${search}”` : ""}.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={display(r.id) || i}>
                  {visibleColumns.map((c) => <td key={c.name} style={td} title={display(r[c.name])}>{display(r[c.name])}</td>)}
                  {canWrite && (
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ ...row, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        <button type="button" style={button} onClick={() => setEditing(r)}>Edit</button>
                        <button
                          type="button"
                          style={dangerButton}
                          onClick={() => {
                            if (!window.confirm(`Delete row ${display(r.id)} from ${label(section)}? There is no undo.`)) return;
                            void run(() => deleteRow({ companyId, section, id: r.id as string | number }), "Row deleted").catch(() => {});
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.data && (
        <div style={{ ...row, justifyContent: "space-between" }}>
          <span style={muted}>
            {rows.length ? `${offset + 1}–${offset + rows.length}` : "0"}{total !== null ? ` of ${total}` : ""}
          </span>
          <div style={row}>
            <button type="button" style={button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <button
              type="button"
              style={button}
              disabled={total !== null ? offset + rows.length >= total : rows.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── slots ─────────────────────────────────────────────────────────────────

export function BusinessPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const overview = useOverview(companyId);
  const [selected, setSelected] = useState<string | null>(null);

  const sections = overview.data?.configured ? overview.data.sections : [];
  useEffect(() => {
    if (!selected && sections.length) setSelected(sections[0].section);
  }, [selected, sections]);

  if (!companyId) return <div style={card}>Pick a company first.</div>;
  if (overview.loading && !overview.data) return <Spinner label="Connecting to the business" />;
  if (overview.error) return <div style={{ ...card, color: "var(--destructive)" }}>{overview.error.message}</div>;
  if (!overview.data) return null;
  if (!overview.data.configured) return <NotConnected message={overview.data.message} />;

  const { business } = overview.data;
  const totalRows = sections.reduce((sum, s) => sum + s.rows, 0);

  return (
    <div style={{ ...stack, padding: 16 }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{business.name ?? business.slug}</h1>
          <span style={muted}>{[business.industry, business.slug].filter(Boolean).join(" · ")}</span>
        </div>
        <StatusBadge label={business.can_write ? "Read and write" : "Read only"} status={business.can_write ? "ok" : "info"} />
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        <MetricCard label="Sections with data" value={sections.length} />
        <MetricCard label="Rows" value={totalRows} />
      </div>

      {sections.length === 0 ? (
        <div style={{ ...card, ...muted }}>This business has no data in any section yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(180px, 220px) minmax(0, 1fr)" }}>
          <nav style={{ ...card, padding: 6, alignSelf: "start", display: "grid", gap: 2 }}>
            {sections.map((s) => (
              <button
                key={s.section}
                type="button"
                onClick={() => setSelected(s.section)}
                style={{
                  ...row,
                  justifyContent: "space-between",
                  flexWrap: "nowrap",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 13,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--foreground)",
                  background: selected === s.section ? "var(--accent)" : "transparent",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(s.section)}</span>
                <span style={muted}>{s.rows}</span>
              </button>
            ))}
          </nav>
          {selected && (
            <SectionView
              companyId={companyId}
              section={selected}
              canWrite={business.can_write}
              onChanged={overview.refresh}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function BusinessSidebarLink(_props: PluginSidebarProps) {
  const nav = useHostNavigation();
  const href = nav.resolveHref(`/${PAGE_ROUTE}`);
  const active = typeof window !== "undefined" && window.location.pathname === href;
  return (
    <a
      {...nav.linkProps(`/${PAGE_ROUTE}`)}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      ].join(" ")}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18" />
        <path d="M5 21V8l7-5 7 5v13" />
        <path d="M9 21v-6h6v6" />
      </svg>
      <span className="flex-1 truncate">Business</span>
    </a>
  );
}

export function BusinessWidget({ context }: PluginWidgetProps) {
  const overview = useOverview(context.companyId);
  const nav = useHostNavigation();

  if (overview.loading && !overview.data) return <Spinner size="sm" label="Loading business" />;
  if (overview.error) return <div style={{ ...muted, color: "var(--destructive)" }}>{overview.error.message}</div>;
  if (!overview.data) return null;
  if (!overview.data.configured) {
    return <div style={muted}>Not connected to a business yet. Add its token in the CyberCheck Business plugin settings.</div>;
  }

  const { business, sections } = overview.data;
  return (
    <section style={stack} aria-label="Business">
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong>{business.name ?? business.slug}</strong>
        <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ fontSize: 13 }}>Open</a>
      </div>
      <div style={muted}>{sections.length} sections · {sections.reduce((n, s) => n + s.rows, 0)} rows</div>
      <div style={{ ...row, ...muted }}>
        {sections.slice(0, 5).map((s) => <span key={s.section}>{label(s.section)} {s.rows}</span>)}
      </div>
    </section>
  );
}
