import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { TOOL_NAMES } from "../src/constants.js";

const COMPANY_TOKEN = { type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111" };
const AGENT_TOKEN = { type: "secret_ref", secretId: "22222222-2222-4222-8222-222222222222" };
const API = "https://gcr.example.test";

interface Call {
  url: string;
  auth: string | null;
  name: string;
  args: Record<string, unknown>;
}

/** Stand in for gcr-api-clean's /api/mcp, answering each tool from `answers`. */
function fakeApi(answers: Record<string, unknown>, status = 200) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), auth: headers.get("authorization"), name: body.params.name, args: body.params.arguments });
    if (status !== 200) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32600, message: "Unknown token." } }), { status });
    }
    const answer = answers[body.params.name];
    const result = answer instanceof Error
      ? { content: [{ type: "text", text: answer.message }], isError: true }
      : { content: [{ type: "text", text: JSON.stringify(answer) }], structuredContent: answer };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function harnessWith(config: Record<string, unknown>) {
  const harness = createTestHarness({ manifest, config });
  // Resolve each secret to a value that names it, so tests can see which token was sent.
  harness.ctx.secrets.resolve = async (ref) => `token-for-${typeof ref === "string" ? ref : ref.secretId}`;
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const business = { slug: "example-business", name: "Example", industry: "example", can_write: true };

describe("business data plugin (platform infrastructure)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares agent tools only: no page, sidebar or dashboard widget", () => {
    expect(manifest.ui?.slots ?? []).toHaveLength(0);
    expect(manifest.capabilities).not.toContain("ui.page.register");
    expect(manifest.tools?.map((t) => t.name)).toEqual(Object.values(TOOL_NAMES));
    for (const tool of manifest.tools ?? []) {
      expect(JSON.stringify(tool.parametersSchema)).not.toMatch(/slug|company/i);
    }
  });

  it("has no built-in gcr-api-clean address", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//);
  });

  it("runs tools through /api/mcp with the company's business token", async () => {
    const calls = fakeApi({ whoami: business });
    const harness = await harnessWith({ apiBaseUrl: `${API}/`, businessToken: COMPANY_TOKEN });
    const result = await harness.executeTool<{ data?: unknown; error?: string }>(TOOL_NAMES.whoami, {}, { companyId: "c1", agentId: "jarvis" });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(business);
    expect(calls[0].url).toBe(`${API}/api/mcp`);
    expect(calls[0].auth).toMatch(/^Bearer /);
    expect(calls[0].auth).toContain(COMPANY_TOKEN.secretId);
  });

  it("uses an installed agent's own token instead of the company token", async () => {
    const calls = fakeApi({ whoami: business });
    const harness = await harnessWith({
      apiBaseUrl: API,
      businessToken: COMPANY_TOKEN,
      agentTokens: { "agent-b": AGENT_TOKEN },
    });
    await harness.executeTool(TOOL_NAMES.whoami, {}, { companyId: "c1", agentId: "agent-b" });
    await harness.executeTool(TOOL_NAMES.whoami, {}, { companyId: "c1", agentId: "agent-a" });
    expect(calls[0].auth).toContain(AGENT_TOKEN.secretId);
    expect(calls[1].auth).toContain(COMPANY_TOKEN.secretId);
  });

  it("never sends a slug, even when the caller passes one", async () => {
    const calls = fakeApi({ create_row: { section: "faqs", created: { id: 7 } } });
    const harness = await harnessWith({ apiBaseUrl: API, businessToken: COMPANY_TOKEN });
    await harness.executeTool(
      TOOL_NAMES.createRow,
      { section: "faqs", slug: "someone-else", values: { question: "Open late?" } },
      { companyId: "c1", agentId: "a1" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ section: "faqs", values: { question: "Open late?" } });
  });

  it("clamps paging and trims search", async () => {
    const calls = fakeApi({ read_section: { section: "faqs", rows: [], returned: 0, total_matching: 0, limit: 500, offset: 0 } });
    const harness = await harnessWith({ apiBaseUrl: API, businessToken: COMPANY_TOKEN });
    await harness.executeTool(TOOL_NAMES.readSection, { section: "faqs", search: " hours ", limit: 9999 }, { companyId: "c1" });
    expect(calls[0].args).toEqual({ section: "faqs", search: "hours", limit: 500, offset: 0 });
  });

  it("surfaces gcr-api-clean's own error text as a tool error", async () => {
    fakeApi({ delete_row: new Error("No row 9 in faqs for this business.") });
    const harness = await harnessWith({ apiBaseUrl: API, businessToken: COMPANY_TOKEN });
    const result = await harness.executeTool<{ error?: string }>(TOOL_NAMES.deleteRow, { section: "faqs", id: 9 }, { companyId: "c1" });
    expect(result.error).toBe("No row 9 in faqs for this business.");
  });

  it("explains a rejected token", async () => {
    fakeApi({}, 401);
    const harness = await harnessWith({ apiBaseUrl: API, businessToken: COMPANY_TOKEN });
    const result = await harness.executeTool<{ error?: string }>(TOOL_NAMES.whoami, {}, { companyId: "c1" });
    expect(result.error).toMatch(/refused the business token: Unknown token/);
  });

  it("returns a tool error rather than calling out when the company is not linked", async () => {
    const calls = fakeApi({});
    const harness = await harnessWith({ apiBaseUrl: API });
    const result = await harness.executeTool<{ error?: string }>(TOOL_NAMES.listSections, {}, { companyId: "c1" });
    expect(result.error).toMatch(/not linked to a business/);
    expect(calls).toHaveLength(0);
  });

  it("refuses to guess an address when none is configured", async () => {
    const calls = fakeApi({});
    const harness = await harnessWith({ businessToken: COMPANY_TOKEN });
    const result = await harness.executeTool<{ error?: string }>(TOOL_NAMES.whoami, {}, { companyId: "c1" });
    expect(result.error).toMatch(/no gcr-api-clean URL/);
    expect(calls).toHaveLength(0);
  });
});
