import type { EmailRequest, FetchLike, SendResult } from "../automation/types.js";
import { brevoMailAdapter } from "./mail/brevo.js";
import { logMailAdapter } from "./mail/log.js";

/**
 * The platform mailer (DECISIONS #85): one interface, one adapter chosen by
 * name from the environment. Nothing in the notifier knows which provider is
 * behind it.
 *
 *   PLATFORM_MAIL_PROVIDER   the adapter's name (one of the registry's keys;
 *                            unset: email is off and every send is skipped
 *                            with reason "mail_unconfigured")
 *   PLATFORM_MAIL_API_KEY    the provider's key
 *   PLATFORM_MAIL_API_URL    the provider's endpoint (each adapter documents its default)
 *   PLATFORM_MAIL_FROM       the sender address; PLATFORM_MAIL_FROM_NAME its display name
 */
export interface MailAdapterConfig {
  apiKey: string | null;
  apiUrl: string | null;
  from: string | null;
  fromName: string | null;
  fetch: FetchLike;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export interface MailProvider {
  readonly name: string;
  send(message: EmailRequest): Promise<SendResult>;
}

export type MailAdapterFactory = (config: MailAdapterConfig) => MailProvider;

/** Every adapter this server can be configured with, by the name PLATFORM_MAIL_PROVIDER takes. */
export const MAIL_ADAPTERS: Readonly<Record<string, MailAdapterFactory>> = {
  brevo: brevoMailAdapter,
  log: logMailAdapter,
};

export function mailProviderName(env: Record<string, string | undefined> = process.env): string | null {
  const name = env.PLATFORM_MAIL_PROVIDER?.trim().toLowerCase();
  return name ? name : null;
}

/** A mailer that always skips, with the reason; used when no provider is set. */
export function unconfiguredMail(reason = "mail_unconfigured"): MailProvider {
  return { name: "none", async send() { return { success: false, reason }; } };
}

export function mailProvider(options: { env?: Record<string, string | undefined>; fetch?: FetchLike; log?: MailAdapterConfig["log"] } = {}): MailProvider {
  const env = options.env ?? process.env;
  const name = mailProviderName(env);
  if (!name) return unconfiguredMail();
  const factory = MAIL_ADAPTERS[name];
  if (!factory) return unconfiguredMail(`mail_provider_unknown:${name}`);
  return factory({
    apiKey: env.PLATFORM_MAIL_API_KEY?.trim() || null,
    apiUrl: env.PLATFORM_MAIL_API_URL?.trim().replace(/\/+$/, "") || null,
    from: env.PLATFORM_MAIL_FROM?.trim() || null,
    fromName: env.PLATFORM_MAIL_FROM_NAME?.trim() || null,
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    log: options.log,
  });
}
