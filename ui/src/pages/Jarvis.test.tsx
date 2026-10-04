// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Jarvis } from "./Jarvis";

const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Navigate: ({ to }: { to: string }) => {
    mockNavigate(to);
    return null;
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("@/context/DialogContext", () => ({
  useDialogActions: () => ({ openOnboarding: vi.fn() }),
}));

vi.mock("@/api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Agent;
}

async function renderJarvis() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Jarvis />
      </QueryClientProvider>,
    );
  });
  // Let the agents query settle.
  for (let i = 0; i < 20 && mockNavigate.mock.calls.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return () => {
    flushSync(() => root.unmount());
    container.remove();
  };
}

describe("Jarvis page", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockAgentsApi.list.mockReset();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("opens the assistant the server recorded, even when another agent carries the display name", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ id: "named", name: "Jarvis", urlKey: "jarvis" }),
      makeAgent({ id: "recorded", name: "Assistant", urlKey: "assistant", metadata: { nextgentAssistant: true } }),
    ]);
    cleanup = await renderJarvis();
    expect(mockNavigate).toHaveBeenCalledWith("/chats/assistant");
  });

  it("falls back to the agent with the display name, then to the first active agent", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ id: "other", name: "Other", urlKey: "other" }),
      makeAgent({ id: "named", name: "jarvis", urlKey: "jarvis" }),
    ]);
    cleanup = await renderJarvis();
    expect(mockNavigate).toHaveBeenCalledWith("/chats/jarvis");
    cleanup();
    cleanup = null;
    mockNavigate.mockReset();
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ id: "gone", name: "Gone", urlKey: "gone", status: "terminated" }),
      makeAgent({ id: "first", name: "First", urlKey: "first" }),
    ]);
    cleanup = await renderJarvis();
    expect(mockNavigate).toHaveBeenCalledWith("/chats/first");
  });
});
