import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { gcrClient, type FetchLike } from "./nextgent-gcr-client.js";

/** gcr-api-clean's template for a team invite (templates/email/team-invite.json there). */
export const TEAM_INVITE_TEMPLATE = "team-invite";

export interface InviteEmailResult {
  emailSent: boolean;
  emailError?: string;
}

/** The owner app's link that accepts an invite; the host comes from OWNER_APP_URL. */
export function inviteAcceptUrl(ownerAppUrl: string, token: string) {
  return `${ownerAppUrl.replace(/\/+$/, "")}/#/invite/${encodeURIComponent(token)}`;
}

/**
 * Email an invite link through gcr-api-clean's signed POST /api/nextgent/email.
 * Never throws: the invite exists either way, and the result says whether
 * the email went out.
 */
export async function sendInviteEmail(
  db: Db,
  input: { companyId: string; to: string; token: string; businessName: string; inviterUserId: string | null; role: string | null },
  options: { config?: NextgentConfig; fetch?: FetchLike; ownerAppUrl?: string | null } = {},
): Promise<InviteEmailResult> {
  const config = options.config ?? readNextgentConfig();
  const ownerAppUrl = options.ownerAppUrl !== undefined ? options.ownerAppUrl : process.env.OWNER_APP_URL?.trim() || null;
  if (!ownerAppUrl) return { emailSent: false, emailError: "OWNER_APP_URL is not set, so there is no link to send" };
  const gcr = gcrClient({ config, fetch: options.fetch });
  if (!gcr.configured) return { emailSent: false, emailError: "Email is not configured on this server" };
  try {
    const inviter = input.inviterUserId
      ? await db
          .select({ name: authUsers.name, email: authUsers.email })
          .from(authUsers)
          .where(eq(authUsers.id, input.inviterUserId))
          .then((rows) => rows[0] ?? null)
      : null;
    const result = await gcr.sendEmail({
      companyId: input.companyId,
      to: input.to,
      template: TEAM_INVITE_TEMPLATE,
      data: {
        business_name: input.businessName,
        inviter: inviter?.name || inviter?.email || input.businessName,
        role: input.role ?? "",
        accept_link: inviteAcceptUrl(ownerAppUrl, input.token),
      },
    });
    if (result && typeof result === "object" && (result as { sent?: unknown }).sent === false) {
      return { emailSent: false, emailError: "The email could not be sent" };
    }
    return { emailSent: true };
  } catch (error) {
    logger.warn({ err: error, companyId: input.companyId }, "Invite email was not sent; the invite still exists");
    return { emailSent: false, emailError: error instanceof Error ? error.message : "The email could not be sent" };
  }
}
