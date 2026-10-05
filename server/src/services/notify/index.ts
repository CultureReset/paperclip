import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { nextgentBusinessLinks, notificationLog, notificationSettings } from "@paperclipai/db";
import { badRequest } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import type { EmailRequest, FetchLike, SendResult, TextRequest } from "../automation/types.js";
import { readNextgentConfig, type NextgentConfig } from "../nextgent-config.js";
import { mailProvider, type MailProvider } from "./mail.js";
import { normalizePhone } from "./phone.js";
import { platformTextSender, type TextSender } from "./text.js";

/**
 * Owner notifications — the entry point of the notify module (DECISIONS #81,
 * #85), a port of gcr-api-clean lib/notify.js. What reaches a company's owner
 * when something needs them:
 *
 *   review          an item is waiting in the review queue
 *   unknown_sender  forwarded mail from a sender this business has not seen
 *   approval        something is waiting for the owner's yes
 *   failed_action   something the platform tried for them did not work
 *
 * Email goes through mail.ts (provider from env); texts through text.ts
 * (gcr-api-clean's signed platform-text endpoint). Where it goes:
 * notification_settings for the company, else the business's listed contact
 * when the caller can supply it. Only a company linked to a business is
 * notified. Every attempt is logged to notification_log, the skipped ones
 * with why; with a `ref`, the same item is never announced twice.
 *
 * notifyOwner() never throws: a notification failing must not fail the thing
 * that triggered it.
 */
export const NOTIFICATION_KINDS = Object.freeze(["review", "unknown_sender", "approval", "failed_action"] as const);
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface OwnerNotice {
  kind: string;
  title: string;
  body?: string | null;
  ref?: string | null;
  /** An absolute link, or a path under OWNER_APP_URL. */
  link?: string | null;
}

export interface NotifyResult {
  sent: boolean;
  channels?: Record<string, string>;
  skipped?: string;
}

export interface ContactFallback {
  email?: string | null;
  phone?: string | null;
}

export interface NotifyServiceOptions {
  config?: NextgentConfig;
  fetch?: FetchLike;
  mail?: MailProvider;
  text?: TextSender;
  env?: Record<string, string | undefined>;
  /** The business's own listed contact (a business fact, read through the bridge), used when settings name none. */
  contactFallback?: (companyId: string) => Promise<ContactFallback | null>;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** An absolute link, or a path joined to OWNER_APP_URL, or nothing. */
export function linkFor(link: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = env.OWNER_APP_URL?.trim();
  return base ? `${base.replace(/\/+$/, "")}/${String(link).replace(/^\/+/, "")}` : null;
}

export function emailHtml({ title, body, link }: { title: string; body?: string | null; link?: string | null }): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px">
<h2 style="font-size:18px">${esc(title)}</h2>
${body ? `<p style="white-space:pre-wrap">${esc(body)}</p>` : ""}
${link ? `<p><a href="${esc(link)}">Open it</a></p>` : ""}
</div>`;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface NotificationSettingsPatch {
  email?: string | null;
  phone?: string | null;
  email_on?: boolean;
  sms_on?: boolean;
  muted_kinds?: string[];
}

export function notifyService(db: Db, options: NotifyServiceOptions = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readNextgentConfig(env);
  const mail = options.mail ?? mailProvider({ env, fetch: options.fetch, log: (message, details) => logger.info(details, message) });
  const text = options.text ?? platformTextSender({ config, fetch: options.fetch });

  async function isClaimed(companyId: string) {
    const link = await db.select({ companyId: nextgentBusinessLinks.companyId }).from(nextgentBusinessLinks).where(eq(nextgentBusinessLinks.companyId, companyId)).then((rows) => rows[0] ?? null);
    return link !== null;
  }

  async function settingsRow(companyId: string) {
    return db.select().from(notificationSettings).where(eq(notificationSettings.companyId, companyId)).then((rows) => rows[0] ?? null);
  }

  async function contactsFor(companyId: string) {
    const settings = await settingsRow(companyId);
    let email = settings?.email ?? null;
    let phone = settings?.phone ?? null;
    if ((!email || !phone) && options.contactFallback) {
      const fallback = await options.contactFallback(companyId).catch(() => null);
      email = email || fallback?.email || null;
      phone = phone || fallback?.phone || null;
    }
    return {
      email: settings?.emailOn === false ? null : email,
      phone: settings?.smsOn === false ? null : phone,
      muted: new Set(settings?.mutedKinds ?? []),
    };
  }

  async function alreadySent(companyId: string, kind: string, ref: string | null | undefined) {
    if (!ref) return false;
    const found = await db
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(and(eq(notificationLog.companyId, companyId), eq(notificationLog.kind, kind), eq(notificationLog.ref, String(ref))))
      .limit(1);
    return found.length > 0;
  }

  async function log(companyId: string, kind: string, ref: string | null | undefined, title: string, channels: Record<string, string>) {
    try {
      await db.insert(notificationLog).values({ companyId, kind, ref: ref ? String(ref) : null, title, channels });
    } catch (error) {
      // The log is for visibility; it must not take the notification down.
      logger.warn({ err: error, companyId, kind }, "notification log write failed");
    }
  }

  /** A text from the platform number, logged under the company's business by gcr-api-clean. */
  async function sendText(companyId: string, request: TextRequest & { ref?: string | null }): Promise<SendResult> {
    const to = normalizePhone(request.to, env);
    if (!to) return { success: false, reason: "not_a_phone_number" };
    return text.send({ companyId, to, body: request.body, kind: request.kind, ref: request.ref ?? null });
  }

  async function sendEmail(request: EmailRequest): Promise<SendResult> {
    return mail.send(request);
  }

  return {
    KINDS: NOTIFICATION_KINDS,
    sendText,
    sendEmail,
    normalizePhone: (value: unknown) => normalizePhone(value, env),

    /**
     * The numbers that are the business's own, for the sms.send step: the
     * owner's notification phone and whatever the caller knows of the
     * business's listed numbers (business facts, read through the bridge).
     */
    async ownNumbers(companyId: string, known: Array<string | null | undefined> = []): Promise<Set<string>> {
      const settings = await settingsRow(companyId);
      const out = new Set<string>();
      for (const raw of [settings?.phone, ...known]) {
        const normalized = normalizePhone(raw, env);
        if (normalized) out.add(normalized);
      }
      return out;
    },

    /** Tell a company's owner about something. Never throws. */
    async notifyOwner(companyId: string, notice: OwnerNotice): Promise<NotifyResult> {
      try {
        const { kind, title, body, ref, link } = notice;
        if (!companyId) return { sent: false, skipped: "no_business" };
        if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return { sent: false, skipped: "unknown_kind" };
        if (!title) return { sent: false, skipped: "no_title" };

        if (!(await isClaimed(companyId))) return { sent: false, skipped: "not_claimed" };
        if (await alreadySent(companyId, kind, ref)) return { sent: false, skipped: "duplicate" };

        const to = await contactsFor(companyId);
        if (to.muted.has(kind)) {
          await log(companyId, kind, ref, title, { skipped: "muted" });
          return { sent: false, skipped: "muted" };
        }

        const url = linkFor(link, env);
        const channels: Record<string, string> = {};
        if (to.email) {
          const r = await sendEmail({ to: to.email, subject: title, html: emailHtml({ title, body, link: url }) });
          channels.email = r.success ? "sent" : r.reason || "failed";
        }
        if (to.phone) {
          const r = await sendText(companyId, { to: to.phone, body: [title, url].filter(Boolean).join(" "), kind: `notify_${kind}`, ref: ref ?? null });
          channels.sms = r.success ? "sent" : r.reason || "failed";
        }
        if (!to.email && !to.phone) channels.skipped = "no_contact";

        await log(companyId, kind, ref, title, channels);
        const sent = channels.email === "sent" || channels.sms === "sent";
        return { sent, channels };
      } catch (error) {
        logger.error({ err: error, companyId, kind: notice.kind }, "owner notification failed");
        return { sent: false, skipped: "error" };
      }
    },

    /** Tell the platform operator (PLATFORM_ADMIN_EMAIL). */
    async notifyPlatform(notice: { title: string; body?: string | null; link?: string | null }): Promise<NotifyResult> {
      try {
        const to = env.PLATFORM_ADMIN_EMAIL?.trim();
        if (!to) return { sent: false, skipped: "no_admin_email" };
        const r = await sendEmail({ to, subject: notice.title, html: emailHtml({ title: notice.title, body: notice.body, link: linkFor(notice.link, env) }) });
        return { sent: r.success };
      } catch (error) {
        logger.error({ err: error }, "platform notification failed");
        return { sent: false, skipped: "error" };
      }
    },

    async getSettings(companyId: string) {
      const row = await settingsRow(companyId);
      return row
        ? { email: row.email, phone: row.phone, email_on: row.emailOn, sms_on: row.smsOn, muted_kinds: row.mutedKinds ?? [], updated_at: row.updatedAt }
        : null;
    },

    /** The owner's settings; validated like gcr's PUT /api/notify-settings. */
    async updateSettings(companyId: string, patch: NotificationSettingsPatch, userId: string | null) {
      const row: Partial<typeof notificationSettings.$inferInsert> = { updatedAt: new Date(), updatedByUserId: userId };
      if (patch.email !== undefined) {
        const email = patch.email ? String(patch.email).trim() : null;
        if (email && !EMAIL_PATTERN.test(email)) throw badRequest("That is not an email address.");
        row.email = email;
      }
      if (patch.phone !== undefined) {
        const phone = patch.phone ? normalizePhone(patch.phone, env) : null;
        if (patch.phone && !phone) throw badRequest("That is not a phone number.");
        row.phone = phone;
      }
      if (patch.email_on !== undefined) row.emailOn = !!patch.email_on;
      if (patch.sms_on !== undefined) row.smsOn = !!patch.sms_on;
      if (patch.muted_kinds !== undefined) {
        if (!Array.isArray(patch.muted_kinds) || patch.muted_kinds.some((k) => !(NOTIFICATION_KINDS as readonly string[]).includes(k))) {
          throw badRequest(`muted_kinds must be a list of: ${NOTIFICATION_KINDS.join(", ")}`);
        }
        row.mutedKinds = patch.muted_kinds;
      }
      await db
        .insert(notificationSettings)
        .values({ companyId, ...row })
        .onConflictDoUpdate({ target: notificationSettings.companyId, set: row });
      return this.getSettings(companyId);
    },

    /** The last notifications, newest first (the Settings screen shows 20). */
    async recent(companyId: string, limit = 20) {
      const rows = await db
        .select({ kind: notificationLog.kind, title: notificationLog.title, channels: notificationLog.channels, ref: notificationLog.ref, created_at: notificationLog.createdAt })
        .from(notificationLog)
        .where(eq(notificationLog.companyId, companyId))
        .orderBy(desc(notificationLog.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows;
    },
  };
}

export type NotifyService = ReturnType<typeof notifyService>;
