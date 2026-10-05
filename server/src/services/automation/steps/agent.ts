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
    const installId = config.install_id ? String(config.install_id).trim() : null;
    const agentId = config.agent_id ? String(config.agent_id).trim() : null;
    const itemKey = config.item_key ? String(config.item_key).trim() : null;
    const agentKey = config.agent_key ? String(config.agent_key).trim() : null;
    if (!installId && !agentId && !itemKey) throw new Error("Name the agent install (item key or install id)");
    // The trigger goes as ids and a non-PII summary (ref.ts), never the payload:
    // the agent reads the customer's record through the business MCP.
    const body: Record<string, unknown> = {
      source: "automation",
      business: { slug: ctx.business?.slug ?? null, name: ctx.business?.name ?? null },
      automation: ctx.automation ?? null,
      run: { id: ctx.runId ?? null, step: ctx.stepId ?? null, at: deps.clock().toISOString() },
      trigger: { type: ctx.trigger.type, event: ctx.trigger.event ?? null, ref: ctx.trigger.ref ?? {} },
      instructions: config.instructions ? String(config.instructions) : null,
      payload: asObject(config.payload),
    };
    // The same report gcr prints (DECISIONS #91): the install named, and the body.
    if (dryRun) return { dry_run: true, would_post: { install_id: installId, body } };
    return deps.agent({ installId, agentId, itemKey, agentKey, body });
  },
};
