import type { BusinessMcp, FetchLike } from "./types.js";

/**
 * The business MCP client the data and message steps use: gcr-api-clean
 * `POST /api/mcp` (JSON-RPC `tools/call`) with the install's token as the
 * bearer (SPEC §12.11: the one business door). gcr-api-clean resolves the
 * business from the token, so no slug ever travels. The same wire shape as
 * packages/plugins/plugin-cybercheck/src/gcr.ts, kept here because the
 * server's step runner cannot import a plugin.
 */
export class BusinessMcpError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "BusinessMcpError";
  }
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function textOf(result: ToolCallResult): string {
  return (result.content ?? []).map((part) => part.text ?? "").join("\n").trim();
}

let nextId = 1;

export function businessMcpClient(input: { baseUrl: string; token: string; fetch?: FetchLike }): BusinessMcp {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init));
  return {
    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${input.token}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
        });
      } catch (error) {
        throw new BusinessMcpError(`Could not reach gcr-api-clean at ${baseUrl}: ${(error as Error).message}`);
      }
      type RpcBody = { result?: ToolCallResult; error?: { message?: string } };
      let body: RpcBody | null = null;
      try {
        body = (await response.json()) as RpcBody;
      } catch {
        body = null;
      }
      if (!response.ok) {
        const reason = body?.error?.message ?? `HTTP ${response.status}`;
        throw new BusinessMcpError(response.status === 401 ? `gcr-api-clean refused the install token: ${reason}` : reason, response.status);
      }
      if (!body) throw new BusinessMcpError(`gcr-api-clean at ${baseUrl} did not answer with JSON.`, response.status);
      if (body.error) throw new BusinessMcpError(body.error.message ?? "gcr-api-clean returned an error.", response.status);
      const result = body.result ?? {};
      if (result.isError) throw new BusinessMcpError(textOf(result) || `${name} failed.`, response.status);
      if (result.structuredContent !== undefined) return result.structuredContent as T;
      const text = textOf(result);
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    },
  };
}
