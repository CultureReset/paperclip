import { describe, expect, it } from "vitest";
import { renderOnboardingGreeting } from "./onboarding-greeting.js";

describe("renderOnboardingGreeting", () => {
  it("introduces the agent by name as the user's primary assistant", async () => {
    const greeting = await renderOnboardingGreeting({
      agentName: "Nova",
      organizationName: "Acme",
    });

    expect(greeting).toContain(
      "Welcome to NEXT GENT! I'm Nova, your primary assistant.",
    );
    // No goal quote and no "give me one moment" — the agent is not about to run.
    expect(greeting).not.toContain("aiming for");
    expect(greeting).not.toContain("one moment");
    // The assistant coordinates the owner's request without implying a run has started.
    expect(greeting).toContain("Tell me what you want done");
  });

  it("drops the name gracefully when no agent name is set", async () => {
    const greeting = await renderOnboardingGreeting({
      agentName: null,
      organizationName: "Acme",
    });

    expect(greeting).toContain(
      "Welcome to NEXT GENT! I'm your primary assistant.",
    );
    expect(greeting).not.toContain("{{agentName}}");
  });

  it("trims whitespace/blank names to the no-name phrasing", async () => {
    const greeting = await renderOnboardingGreeting({ agentName: "   " });

    expect(greeting).toContain("I'm your primary assistant.");
  });
});
