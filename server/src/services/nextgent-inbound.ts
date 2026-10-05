import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { activityLog, companies, issues } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import { readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";

/**
 * Contract §5 bodies. `target` may be empty or missing (DECISIONS #79): the
 * relay's receipts name the capability or action instead, and what came is
 * stored as it came.
 */
export const nextgentReceiptSchema = z.object({
  companyId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).nullish(),
  action: z.string().trim().min(1).max(500),
  target: z.string().trim().max(2_000).nullish(),
  capability: z.string().trim().max(500).nullish(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  device: z.string().trim().max(500).nullish(),
  verified: z.boolean(),
  at: z.string().trim().min(1),
  evidence: z.unknown().optional(),
});
export type NextgentReceipt = z.infer<typeof nextgentReceiptSchema>;

const shortString = (max: number) => z.string().trim().min(1).max(max).nullish();

/**
 * A conversation REFERENCE (DECISIONS #34): which call or text happened,
 * when, over which channel, and how it ended. The transcript and the
 * customer's number stay in gcr-api-clean (`live_conversations`). The old
 * shape (`from`, `to`, `transcript`, `summary`) is still accepted so an older
 * gcr-api-clean is not refused and retried forever, but none of it is stored.
 */
export const nextgentConversationSchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  conversationId: shortString(200),
  channel: z.enum(["voice", "sms"]),
  mode: shortString(100),
  threadId: shortString(200),
  startedAt: shortString(100),
  endedAt: shortString(100),
  turns: z.number().int().min(0).nullish(),
  outcome: shortString(500),
  from: z.string().nullish(),
  to: z.string().nullish(),
  transcript: z.array(z.unknown()).nullish(),
  summary: z.string().nullish(),
});
export type NextgentConversation = z.infer<typeof nextgentConversationSchema>;

/** The fields of a conversation that Paperclip keeps; nothing else from the body reaches the database. */
export function conversationReference(conversation: NextgentConversation) {
  return {
    conversationId: conversation.conversationId ?? null,
    channel: conversation.channel,
    mode: conversation.mode ?? null,
    threadId: conversation.threadId ?? null,
    startedAt: conversation.startedAt ?? null,
    endedAt: conversation.endedAt ?? null,
    turns: conversation.turns ?? conversation.transcript?.length ?? null,
    outcome: conversation.outcome ?? null,
  };
}

/** Activity action receipts are stored under. */
export const RECEIPT_ACTION = "nextgent.receipt";

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
    /**
     * Receipts recorded for a company, newest first: the contract §5 fields,
     * the receipt id, and the task it is attached to (id and identifier).
     */
    async listReceipts(companyId: string, page: { limit: number; offset: number }) {
      const where = and(eq(activityLog.companyId, companyId), eq(activityLog.action, RECEIPT_ACTION));
      const [{ total }] = await db.select({ total: count() }).from(activityLog).where(where);
      const rows = await db
        .select({ id: activityLog.id, details: activityLog.details, createdAt: activityLog.createdAt, entityType: activityLog.entityType, entityId: activityLog.entityId })
        .from(activityLog)
        .where(where)
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(page.limit)
        .offset(page.offset);
      const taskIdOf = (row: (typeof rows)[number]) => (row.entityType === "issue" ? row.entityId : null);
      const taskIds = [...new Set(rows.map(taskIdOf).filter((id): id is string => Boolean(id)))];
      const tasks = taskIds.length
        ? await db.select({ id: issues.id, identifier: issues.identifier, title: issues.title }).from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, taskIds)))
        : [];
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const receipts = rows.map((row) => {
        const d = (row.details ?? {}) as Record<string, unknown>;
        const taskId = taskIdOf(row);
        const task = taskId ? taskById.get(taskId) ?? null : null;
        return {
          id: typeof d.receiptId === "string" ? d.receiptId : row.id,
          companyId,
          taskId: task?.id ?? (typeof d.taskId === "string" ? d.taskId : null),
          task: task ? { id: task.id, identifier: task.identifier, title: task.title } : null,
          action: d.action ?? null,
          target: d.target ?? null,
          capability: d.capability ?? null,
          oldValue: d.oldValue ?? null,
          newValue: d.newValue ?? null,
          device: d.device ?? null,
          verified: d.verified === true,
          at: d.at ?? null,
          evidence: d.evidence ?? null,
          recordedAt: row.createdAt,
        };
      });
      return { receipts, total: Number(total), limit: page.limit, offset: page.offset };
    },

    async recordReceipt(receipt: NextgentReceipt) {
      const companyId = await requireCompany(receipt.companyId);
      const task = receipt.taskId ? await findTask(companyId, receipt.taskId) : null;
      if (receipt.taskId && !task) throw notFound("Task not found in this company");
      const id = randomUUID();
      const details = {
        action: receipt.action,
        target: receipt.target ?? null,
        capability: receipt.capability ?? null,
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
        action: RECEIPT_ACTION,
        entityType: task ? "issue" : "nextgent_receipt",
        entityId: task?.id ?? id,
        issueId: task?.id ?? null,
        details: { receiptId: id, ...details },
      });
      if (task) {
        const body = [
          `**${receipt.verified ? "Verified" : "Not verified"}:** ${receipt.action}${receipt.target ? ` — ${receipt.target}` : ""}`,
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
        details: conversationReference(conversation),
      });
      return { id };
    },
  };
}
