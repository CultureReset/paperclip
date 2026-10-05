import type { StepModule } from "../types.js";

/** An email from the platform address, through the platform mailer (DECISIONS #85). */
export const emailSend: StepModule = {
  type: "email.send",
  async run({ config, dryRun, deps }) {
    const to = String(config.to ?? "").trim();
    if (!to) throw new Error("No email address");
    if (dryRun) return { dry_run: true, would_email: { to, subject: config.subject } };
    return deps.notify.email({ to, subject: String(config.subject ?? ""), html: String(config.html ?? "") });
  },
};
