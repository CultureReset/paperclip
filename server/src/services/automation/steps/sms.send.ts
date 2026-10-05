import type { StepModule } from "../types.js";

/**
 * A text from the platform number to the business itself (its listed phone,
 * the owner's notification phone, a number it owns), through the platform
 * notifier (DECISIONS #85). Any other number is refused: customers are
 * messaged with "Message a customer", which keeps consent and the
 * registered-number rules.
 */
export const smsSend: StepModule = {
  type: "sms.send",
  async run({ config, dryRun, deps }) {
    const to = String(config.to ?? "").trim();
    const body = String(config.body ?? "").trim();
    if (!to) throw new Error("No phone number");
    if (!body) throw new Error("Empty message");
    const own = await deps.notify.ownNumbers();
    const normalized = deps.notify.normalizePhone(to);
    if (!normalized || !own.has(normalized)) {
      throw new Error("A text step only goes to the business's own numbers. To text a customer, use \"Message a customer\".");
    }
    if (dryRun) return { dry_run: true, would_text: { to, body } };
    return deps.notify.text({ to, body, kind: "automation" });
  },
};
