import { truthyFlag } from "../template.js";
import type { StepModule } from "../types.js";
import { requireMcp } from "./_data-common.js";

interface SentMessage {
  id?: string | number | null;
  status?: string;
  status_reason?: string | null;
}

/**
 * messages.send through the business MCP's `send_message` (customer
 * messaging stays business-side, SPEC §12.11), with `to_ref` when the
 * definition gives a reference instead of an address so the address never
 * transits Paperclip (DECISIONS #87).
 */
export const message: StepModule = {
  type: "message",
  async run(input) {
    const { config, dryRun } = input;
    const toRef = config.to_ref && typeof config.to_ref === "object" ? (config.to_ref as Record<string, unknown>) : null;
    if (dryRun) return { dry_run: true, would_message: { channel: config.channel, to: config.to, ...(toRef ? { to_ref: toRef } : {}) } };
    const mcp = requireMcp(input);
    const args: Record<string, unknown> = {
      channel: String(config.channel ?? ""),
      body: config.body,
      require_approval: truthyFlag(config.require_approval),
    };
    if (config.to != null && config.to !== "") args.to = config.to;
    if (toRef) args.to_ref = toRef;
    if (config.subject != null && config.subject !== "") args.subject = config.subject;
    const msg = (await mcp.callTool<SentMessage>("send_message", args)) ?? {};
    if (msg.status === "blocked" || msg.status === "failed") {
      throw new Error(`Message not sent (${msg.status_reason || msg.status})`);
    }
    return { message_id: msg.id ?? null, status: msg.status ?? null };
  },
};
