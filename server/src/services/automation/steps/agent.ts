import { asObject } from "../template.js";
import type { StepModule } from "../types.js";

/**
 * Hand the work to one of the company's agents: a routine run dispatched to
 * that agent (DECISIONS #82). The body is recorded as the agent's work:
 * references only, never a customer's details (DECISIONS #87).
 */
export const agent: StepModule = {
  type: "agent",
  async run({ config, dryRun, ctx, deps }) {
    const agentId = config.agent_id ? String(config.agent_id).trim() : null;
    const itemKey = config.item_key ? String(config.item_key).trim() : null;
    const agentKey = config.agent_key ? String(config.agent_key).trim() : null;
    if (!agentId && !itemKey) throw new Error("Name the agent install (item key or agent id)");
    const body: Record<string, unknown> = {
      source: "automation",
      business: { slug: ctx.business?.slug ?? null, name: ctx.business?.name ?? null },
      automation: ctx.automation ?? null,
      run: { id: ctx.runId ?? null, step: ctx.stepId ?? null, at: deps.clock().toISOString() },
      trigger: ctx.trigger,
      instructions: config.instructions ? String(config.instructions) : null,
      payload: asObject(config.payload),
    };
    if (dryRun) return { dry_run: true, would_post: { agent_id: agentId, item_key: itemKey, agent_key: agentKey, body } };
    return deps.agent({ agentId, itemKey, agentKey, body });
  },
};
