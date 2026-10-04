import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { companies, issues } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import { readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";

/** Contract §5 bodies, exactly. */
export const nextgentReceiptSchema = z.object({
  companyId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).nullish(),
  action: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(2_000),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  device: z.string().trim().max(500).nullish(),
  verified: z.boolean(),
  at: z.string().trim().min(1),
  evidence: z.unknown().optional(),
});
export type NextgentReceipt = z.infer<typeof nextgentReceiptSchema>;

export const nextgentConversationSchema = z.object({
  companyId: z.string().trim().min(1),
  channel: z.enum(["voice", "sms"]),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  transcript: z.array(z.object({ role: z.string().trim().min(1), text: z.string(), at: z.string().trim().min(1) })),
  summary: z.string().nullish(),
  outcome: z.string().nullish(),
});
export type NextgentConversation = z.infer<typeof nextgentConversationSchema>;

/** The conversations endpoint accepts this literal in place of a company id: NEXT GENT's own company. */
export const NEXTGENT_PLATFORM_COMPANY_ALIAS = "nextgent";

function display(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * What gcr-api-clean sends back (contract §5): receipts for real-world
 * actions and records of live calls and texts. Both land in the company's
 * Activity; a receipt with a task is also attached to that task.
 */
export function nextgentInboundService(db: Db, options: { config?: NextgentConfig } = {}) {
  const config = options.config ?? readNextgentConfig();
  const issuesSvc = issueService(db);

  async function requireCompany(companyId: string) {
    if (!isUuidLike(companyId)) throw notFound("Company not found");
    const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    return company.id;
  }

  /** A task is named by its id or its identifier (e.g. the one shown in the app), always inside the company. */
  async function findTask(companyId: string, taskId: string) {
    const condition = isUuidLike(taskId) ? eq(issues.id, taskId) : eq(issues.identifier, taskId);
    return db
      .select({ id: issues.id, identifier: issues.identifier })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), condition))
      .then((rows) => rows[0] ?? null);
  }

  return {
    async recordReceipt(receipt: NextgentReceipt) {
      const companyId = await requireCompany(receipt.companyId);
      const task = receipt.taskId ? await findTask(companyId, receipt.taskId) : null;
      if (receipt.taskId && !task) throw notFound("Task not found in this company");
      const id = randomUUID();
      const details = {
        action: receipt.action,
        target: receipt.target,
        oldValue: receipt.oldValue ?? null,
        newValue: receipt.newValue ?? null,
        device: receipt.device ?? null,
        verified: receipt.verified,
        at: receipt.at,
        evidence: receipt.evidence ?? null,
        taskId: task?.id ?? null,
      };
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "nextgent",
        action: "nextgent.receipt",
        entityType: task ? "issue" : "nextgent_receipt",
        entityId: task?.id ?? id,
        issueId: task?.id ?? null,
        details: { receiptId: id, ...details },
      });
      if (task) {
        const body = [
          `**${receipt.verified ? "Verified" : "Not verified"}:** ${receipt.action} — ${receipt.target}`,
          "",
          `- Before: ${display(receipt.oldValue)}`,
          `- After: ${display(receipt.newValue)}`,
          `- Device: ${display(receipt.device)}`,
          `- At: ${receipt.at}`,
        ].join("\n");
        await issuesSvc.addComment(task.id, body, {}, {
          authorType: "system",
          presentation: {
            kind: "system_notice",
            tone: receipt.verified ? "success" : "warning",
            title: "Receipt",
            detailsDefaultOpen: false,
          },
        });
      }
      return { id, taskId: task?.id ?? null };
    },

    async recordConversation(conversation: NextgentConversation) {
      let companyId = conversation.companyId;
      if (companyId === NEXTGENT_PLATFORM_COMPANY_ALIAS) {
        if (!config.platformCompanyId) {
          throw unprocessable("NEXTGENT_PLATFORM_COMPANY_ID is not set, so conversations for \"nextgent\" have nowhere to go");
        }
        companyId = config.platformCompanyId;
      }
      companyId = await requireCompany(companyId);
      const id = randomUUID();
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "nextgent",
        action: "nextgent.conversation",
        entityType: "nextgent_conversation",
        entityId: id,
        details: {
          channel: conversation.channel,
          from: conversation.from,
          to: conversation.to,
          transcript: conversation.transcript,
          summary: conversation.summary ?? null,
          outcome: conversation.outcome ?? null,
        },
      });
      return { id };
    },
  };
}
