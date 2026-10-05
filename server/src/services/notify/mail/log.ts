import type { MailAdapterConfig, MailProvider } from "../mail.js";

/** Development: the email is written to the log and counted as sent. Never for production. */
export function logMailAdapter(config: MailAdapterConfig): MailProvider {
  return {
    name: "log",
    async send(message) {
      config.log?.("platform email (log adapter, not delivered)", { to: message.to, subject: message.subject });
      return { success: true, id: null };
    },
  };
}
