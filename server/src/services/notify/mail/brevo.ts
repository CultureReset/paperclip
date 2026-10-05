import type { MailAdapterConfig, MailProvider } from "../mail.js";

/**
 * Brevo transactional email (the account gcr-api-clean's utils/email.js uses
 * today can be configured here). PLATFORM_MAIL_API_URL defaults to Brevo's
 * SMTP-email endpoint; PLATFORM_MAIL_API_KEY is the account's API key.
 */
export const BREVO_DEFAULT_API_URL = "https://api.brevo.com/v3/smtp/email";

export function brevoMailAdapter(config: MailAdapterConfig): MailProvider {
  return {
    name: "brevo",
    async send(message) {
      if (!config.apiKey) return { success: false, reason: "mail_key_missing" };
      if (!config.from) return { success: false, reason: "mail_from_missing" };
      try {
        const response = await config.fetch(config.apiUrl ?? BREVO_DEFAULT_API_URL, {
          method: "POST",
          headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sender: { email: config.from, ...(config.fromName ? { name: config.fromName } : {}) },
            to: [{ email: message.to }],
            subject: message.subject,
            htmlContent: message.html,
          }),
        });
        const text = await response.text();
        let parsed: { messageId?: string; message?: string; code?: string } | null = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (!response.ok) return { success: false, reason: parsed?.message || parsed?.code || `http_${response.status}` };
        return { success: true, id: parsed?.messageId ?? null };
      } catch (error) {
        return { success: false, reason: (error as Error).message };
      }
    },
  };
}
