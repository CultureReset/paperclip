/**
 * The one place that talks to gcr-api-clean.
 *
 * Everything goes through its MCP endpoint (`POST /api/mcp`, JSON-RPC
 * `tools/call`) with the business token as the bearer. That endpoint resolves
 * the business from the token via `business_mcp_tokens` and wraps the same
 * handlers the business dashboard uses, so this plugin holds no database key
 * and never sends a slug.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GcrConnection {
  baseUrl: string;
  token: string;
  fetch: FetchLike;
}

export interface Business {
  slug: string;
  name: string | null;
  industry: string | null;
  can_write: boolean;
  connection?: string;
  sections_available?: number;
}

export interface SectionSummary {
  section: string;
  rows: number;
}

export interface SectionColumn {
  name: string;
  type: string;
  format?: string;
  values?: string[];
  editable: boolean;
}

export interface SectionRows {
  section: string;
  rows: Record<string, unknown>[];
  returned: number;
  total_matching: number | null;
  limit: number;
  offset: number;
}

export class GcrError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "GcrError";
  }
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

let nextId = 1;

function textOf(result: ToolCallResult): string {
  return (result.content ?? []).map((part) => part.text ?? "").join("\n").trim();
}

export function normalizeBaseUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  return value.replace(/\/+$/, "");
}

/** Call one gcr-api-clean MCP tool and return its structured payload. */
export async function callTool<T>(conn: GcrConnection, name: string, args: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await conn.fetch(`${conn.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${conn.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch (error) {
    throw new GcrError(`Could not reach gcr-api-clean at ${conn.baseUrl}: ${(error as Error).message}`);
  }

  type RpcBody = { result?: ToolCallResult; error?: { message?: string } };
  let body: RpcBody | null = null;
  try {
    body = (await response.json()) as RpcBody;
  } catch {
    // Not JSON: a proxy error page, or the wrong URL entirely.
  }

  if (!response.ok) {
    const reason = body?.error?.message ?? `HTTP ${response.status}`;
    throw new GcrError(
      response.status === 401 ? `gcr-api-clean refused the business token: ${reason}` : reason,
      response.status,
    );
  }
  if (!body) throw new GcrError(`gcr-api-clean at ${conn.baseUrl} did not answer with JSON.`, response.status);
  if (body.error) throw new GcrError(body.error.message ?? "gcr-api-clean returned an error.", response.status);

  const result = body.result ?? {};
  if (result.isError) throw new GcrError(textOf(result) || `${name} failed.`, response.status);
  if (result.structuredContent !== undefined) return result.structuredContent as T;

  const text = textOf(result);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const gcr = {
  whoami: (conn: GcrConnection) => callTool<Business>(conn, "whoami"),
  listSections: (conn: GcrConnection, includeEmpty = false) =>
    callTool<{ sections: SectionSummary[]; total_sections: number }>(conn, "list_sections", includeEmpty ? { include_empty: true } : {}),
  describeSection: (conn: GcrConnection, section: string) =>
    callTool<{ section: string; columns: SectionColumn[] }>(conn, "describe_section", { section }),
  readSection: (conn: GcrConnection, args: { section: string; search?: string; limit?: number; offset?: number }) =>
    callTool<SectionRows>(conn, "read_section", args),
  createRow: (conn: GcrConnection, section: string, values: Record<string, unknown>) =>
    callTool<{ section: string; created: Record<string, unknown> }>(conn, "create_row", { section, values }),
  updateRow: (conn: GcrConnection, section: string, id: string | number, values: Record<string, unknown>) =>
    callTool<{ section: string; updated: Record<string, unknown> }>(conn, "update_row", { section, id, values }),
  deleteRow: (conn: GcrConnection, section: string, id: string | number) =>
    callTool<{ section: string; deleted: string | number }>(conn, "delete_row", { section, id }),
};
