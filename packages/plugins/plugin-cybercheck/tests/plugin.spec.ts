import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { TOOL_NAMES } from "../src/constants.js";

const TOKEN_REF = { type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111" };

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
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const business = { slug: "flora-bama", name: "Flora-Bama", industry: "restaurant", can_write: true };

describe("CyberCheck Business plugin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares the business page, sidebar link, widget and agent tools", () => {
    const slotTypes = manifest.ui?.slots?.map((s) => s.type);
    expect(slotTypes).toEqual(expect.arrayContaining(["page", "sidebar", "dashboardWidget"]));
    expect(manifest.tools?.map((t) => t.name)).toEqual(Object.values(TOOL_NAMES));
    for (const tool of manifest.tools ?? []) {
      expect(JSON.stringify(tool.parametersSchema)).not.toMatch(/slug/);
    }
  });

  it("reports an unconfigured company instead of failing", async () => {
    const calls = fakeApi({});
    const harness = await harnessWith({});
    const overview = await harness.getData<{ configured: boolean }>("overview", { companyId: "c1" });
    expect(overview.configured).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("loads the business and its sections through /api/mcp with the company's token", async () => {
    const calls = fakeApi({
      whoami: business,
      list_sections: { business: "flora-bama", sections: [{ section: "menu_items", rows: 12 }], total_sections: 1 },
    });
    const harness = await harnessWith({ apiBaseUrl: "https://api.example.test/", businessToken: TOKEN_REF });
    const overview = await harness.getData<{ configured: true; business: typeof business; sections: unknown[]; apiBaseUrl: string }>(
      "overview",
      { companyId: "c1" },
    );
    expect(overview.configured).toBe(true);
    expect(overview.business.name).toBe("Flora-Bama");
    expect(overview.sections).toEqual([{ section: "menu_items", rows: 12 }]);
    expect(overview.apiBaseUrl).toBe("https://api.example.test");
    expect(calls.map((c) => c.url)).toEqual(["https://api.example.test/api/mcp", "https://api.example.test/api/mcp"]);
    expect(calls.every((c) => c.auth?.startsWith("Bearer resolved:"))).toBe(true);
  });

  it("never sends a slug, even when the caller passes one", async () => {
    const calls = fakeApi({ create_row: { section: "faqs", created: { id: 7 } } });
    const harness = await harnessWith({ businessToken: TOKEN_REF });
    await harness.performAction("create-row", {
      companyId: "c1",
      section: "faqs",
      slug: "someone-else",
      values: { question: "Open late?" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gcr-api-clean.vercel.app/api/mcp");
    expect(calls[0].args).toEqual({ section: "faqs", values: { question: "Open late?" } });
  });

  it("loads one section's columns and a page of rows", async () => {
    const calls = fakeApi({
      describe_section: { section: "faqs", columns: [{ name: "question", type: "string", editable: true }] },
      read_section: { section: "faqs", rows: [{ id: 1, question: "Hours?" }], returned: 1, total_matching: 1, limit: 25, offset: 0 },
    });
    const harness = await harnessWith({ businessToken: TOKEN_REF });
    const data = await harness.getData<{ columns: unknown[]; rows: unknown[] }>("section", {
      companyId: "c1",
      section: "faqs",
      search: " hours ",
      limit: 9999,
    });
    expect(data.columns).toHaveLength(1);
    expect(data.rows).toEqual([{ id: 1, question: "Hours?" }]);
    expect(calls.find((c) => c.name === "read_section")?.args).toEqual({ section: "faqs", search: "hours", limit: 500, offset: 0 });
  });

  it("surfaces gcr-api-clean's own error text", async () => {
    fakeApi({ delete_row: new Error("No row 9 in faqs for this business.") });
    const harness = await harnessWith({ businessToken: TOKEN_REF });
    await expect(harness.performAction("delete-row", { companyId: "c1", section: "faqs", id: 9 }))
      .rejects.toThrow("No row 9 in faqs for this business.");
  });

  it("explains a rejected token", async () => {
    fakeApi({}, 401);
    const harness = await harnessWith({ businessToken: TOKEN_REF });
    await expect(harness.getData("overview", { companyId: "c1" })).rejects.toThrow(/refused the business token: Unknown token/);
  });

  it("runs agent tools against the agent's own company", async () => {
    const calls = fakeApi({ whoami: business });
    const harness = await harnessWith({ businessToken: TOKEN_REF });
    const result = await harness.executeTool<{ data?: unknown; error?: string }>(TOOL_NAMES.whoami, {}, { companyId: "c1" });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(business);
    expect(calls[0].name).toBe("whoami");
  });

  it("returns a tool error rather than throwing when the company has no token", async () => {
    fakeApi({});
    const harness = await harnessWith({});
    const result = await harness.executeTool<{ error?: string }>(TOOL_NAMES.listSections, {}, { companyId: "c1" });
    expect(result.error).toMatch(/not connected to a business/);
  });
});
