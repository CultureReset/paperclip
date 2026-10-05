import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { agentApiKeys, companies, nextgentDevices } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { isUniqueViolation } from "../db-errors.js";
import { conflict, HttpError, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { agentService } from "./agents.js";
import { nextgentCompanySetup } from "./nextgent-company-setup.js";
import { NEXTGENT_SECRET_NAMES, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { gcrClient, type FetchLike } from "./nextgent-gcr-client.js";
import { nextgentSecrets } from "./nextgent-secrets.js";

export const DEVICE_KINDS = ["computer", "android"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Owner app → Paperclip: the code the box shows, and an optional name. */
export const pairDeviceSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type PairDeviceInput = z.infer<typeof pairDeviceSchema>;

const text = (max: number) => z.string().trim().min(1).max(max).nullish();

/**
 * gcr-api-clean → Paperclip, signed, from the relay heartbeat on change plus
 * a throttled last_seen (DECISIONS #73): the computer's state and one entry
 * per phone it reports (DECISIONS #72).
 */
export const deviceStatusSchema = z.object({
  companyId: z.string().trim().min(1).max(200),
  nodeId: z.string().trim().min(1).max(200),
  version: text(100),
  capabilities: z.unknown().optional(),
  phones: z
    .array(
      z.object({
        deviceId: z.string().trim().min(1).max(200),
        sim: text(200),
        /** The SIM's number, as the heartbeat reports it. */
        number: text(50),
        online: z.boolean().nullish(),
      }),
    )
    .max(50)
    .nullish(),
  lastSeenAt: text(100),
});
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export type DeviceRow = typeof nextgentDevices.$inferSelect;
export type DeviceView = DeviceRow & { online: boolean | null };

/** "online" is a window over last_seen_at; without a configured window it is unknown (null), never guessed. */
export function onlineFrom(lastSeenAt: Date | null, onlineSeconds: number | null, now = Date.now()): boolean | null {
  if (onlineSeconds === null) return null;
  if (!lastSeenAt) return false;
  return now - lastSeenAt.getTime() <= onlineSeconds * 1000;
}

/** Device-token key name on the assistant agent; the device id is in the key's scope. */
const DEVICE_KEY_NAME = (deviceId: string) => `nextgent-device-${deviceId}`;

/**
 * The device registry (SPEC §5): Paperclip decides who owns a device, gcr-api-clean
 * executes on the relay. Pairing approves a code (DECISIONS #69), mints the
 * device token the box signs in with (#71), keeps the assistant's Ghost MCP
 * credential as a company secret (#74) and records the computer. Status is
 * pushed by gcr-api-clean (#73). Unlinking revokes the node and the token.
 */
export function nextgentDeviceService(db: Db, options: { config?: NextgentConfig; fetch?: FetchLike } = {}) {
  const config = options.config ?? readNextgentConfig();
  const gcr = gcrClient({ config, fetch: options.fetch });
  const secrets = nextgentSecrets(db);
  const agentsSvc = agentService(db);
  const setup = nextgentCompanySetup(db, { config, fetch: options.fetch });

  const view = (row: DeviceRow, now = Date.now()): DeviceView => ({ ...row, online: onlineFrom(row.lastSeenAt, config.devices.onlineSeconds, now) });

  async function requireCompany(companyId: string) {
    if (!isUuidLike(companyId)) throw notFound("Company not found");
    const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    return company.id;
  }

  async function getById(companyId: string, deviceId: string) {
    if (!isUuidLike(deviceId)) return null;
    return db
      .select()
      .from(nextgentDevices)
      .where(and(eq(nextgentDevices.id, deviceId), eq(nextgentDevices.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
  }

  /** Every device token minted for these device rows stops working. */
  async function revokeDeviceTokens(deviceIds: string[]) {
    for (const deviceId of deviceIds) {
      await db
        .update(agentApiKeys)
        .set({ revokedAt: new Date() })
        .where(and(isNull(agentApiKeys.revokedAt), sql`${agentApiKeys.scopeConfig}->>'kind' = 'device'`, sql`${agentApiKeys.scopeConfig}->>'deviceId' = ${deviceId}`));
    }
  }

  async function markUnlinked(companyId: string, deviceIds: string[]) {
    const now = new Date();
    for (const deviceId of deviceIds) {
      await db
        .update(nextgentDevices)
        .set({ unlinkedAt: now, updatedAt: now })
        .where(and(eq(nextgentDevices.id, deviceId), eq(nextgentDevices.companyId, companyId), isNull(nextgentDevices.unlinkedAt)));
    }
    await revokeDeviceTokens(deviceIds);
  }

  return {
    getById,

    /** The company's devices that are still linked, computers first, with `online` computed. */
    async list(companyId: string): Promise<DeviceView[]> {
      const rows = await db
        .select()
        .from(nextgentDevices)
        .where(and(eq(nextgentDevices.companyId, companyId), isNull(nextgentDevices.unlinkedAt)))
        .orderBy(asc(nextgentDevices.kind), asc(nextgentDevices.pairedAt), asc(nextgentDevices.id));
      const now = Date.now();
      return rows.map((row) => view(row, now));
    },

    /** Instance admin: linked devices across companies, optionally one company's, optionally only online or only offline. */
    async listAll(filter: { companyId?: string | null; online?: boolean | null } = {}) {
      const where = [isNull(nextgentDevices.unlinkedAt)];
      if (filter.companyId) where.push(eq(nextgentDevices.companyId, filter.companyId));
      const rows = await db
        .select({ device: nextgentDevices, companyName: companies.name })
        .from(nextgentDevices)
        .innerJoin(companies, eq(companies.id, nextgentDevices.companyId))
        .where(and(...where))
        .orderBy(desc(nextgentDevices.lastSeenAt), asc(nextgentDevices.id));
      const now = Date.now();
      const devices = rows.map(({ device, companyName }) => ({ ...view(device, now), companyName }));
      return filter.online === null || filter.online === undefined ? devices : devices.filter((d) => d.online === filter.online);
    },

    /**
     * Approve the code the box shows. Order matters: the device token is
     * minted first so gcr-api-clean can hand it to the box in the same pair
     * response; a refused pairing revokes it again and keeps no row.
     */
    async pair(companyId: string, input: PairDeviceInput, userId: string | null): Promise<DeviceView> {
      if (!gcr.configured) throw new HttpError(503, "Device pairing is not configured on this server");
      await requireCompany(companyId);
      const assistantId = await setup.findAssistant(companyId);
      if (!assistantId) throw conflict("This company has no assistant agent to hold the device token");
      const deviceId = randomUUID();
      const key = await agentsSvc.createApiKey(assistantId, DEVICE_KEY_NAME(deviceId), { kind: "device", deviceId }, { responsibleUserId: userId });
      let paired;
      try {
        paired = await gcr.pairNode({
          companyId,
          // Codes are shown and typed in any case; the relay matches them upper-case.
          code: input.code.toUpperCase(),
          ...(input.name ? { name: input.name } : {}),
          approvedBy: userId ? `paperclip:${userId}` : "paperclip",
          deviceToken: key.token,
        });
        if (typeof paired?.node?.id !== "string" || !paired.node.id) throw new HttpError(502, "gcr-api-clean returned an incomplete pairing");
      } catch (error) {
        await revokeDeviceTokens([deviceId]);
        throw error;
      }
      const node = paired.node;
      const now = new Date();
      const lastSeenAt = node.last_seen_at ? new Date(node.last_seen_at) : null;
      let row: DeviceRow;
      try {
        row = await db
          .insert(nextgentDevices)
          .values({
            id: deviceId,
            companyId,
            kind: "computer",
            relayNodeId: node.id,
            deviceKey: node.id,
            name: input.name ?? (typeof node.name === "string" ? node.name : null),
            version: typeof node.version === "string" ? node.version : null,
            lastSeenAt: lastSeenAt && !Number.isNaN(lastSeenAt.getTime()) ? lastSeenAt : null,
            pairedByUserId: userId,
            pairedAt: now,
            updatedAt: now,
          })
          .returning()
          .then((rows) => rows[0]);
      } catch (error) {
        await revokeDeviceTokens([deviceId]);
        if (isUniqueViolation(error)) throw conflict("That computer is already paired");
        throw error;
      }
      if (typeof paired.ghostMcpToken === "string" && paired.ghostMcpToken) {
        await secrets.put(
          companyId,
          NEXTGENT_SECRET_NAMES.ghostMcpToken,
          paired.ghostMcpToken,
          "Ghost MCP token for this company's assistant to act through its paired computer (issued by gcr-api-clean at pairing)",
          userId,
        );
      } else {
        logger.warn({ companyId, nodeId: node.id }, "gcr-api-clean paired the node without a Ghost MCP token; the assistant cannot act through it yet");
      }
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "nextgent",
        action: "nextgent.device_paired",
        entityType: "nextgent_device",
        entityId: row.id,
        details: { kind: "computer", relayNodeId: node.id, name: row.name, deviceTokenKeyId: key.id },
      });
      return view(row);
    },

    /** gcr-api-clean revokes the node; the row stays, marked unlinked, and the device token stops working. */
    async unlink(companyId: string, deviceId: string, userId: string | null) {
      const device = await getById(companyId, deviceId);
      if (!device) throw notFound("Device not found");
      if (device.unlinkedAt) return { unlinked: true, id: device.id, alreadyUnlinked: true };
      if (device.kind === "computer") {
        if (gcr.configured) {
          await gcr.revokeNode(device.relayNodeId, companyId);
        } else {
          logger.warn({ companyId, deviceId }, "GCR_API_URL / NEXTGENT_SERVICE_SECRET not set: unlinking the device locally only");
        }
      }
      // A computer's phones go with it: they were derived from its heartbeat.
      const phones =
        device.kind === "computer"
          ? await db
              .select({ id: nextgentDevices.id })
              .from(nextgentDevices)
              .where(and(eq(nextgentDevices.companyId, companyId), eq(nextgentDevices.pairedComputerId, device.id), isNull(nextgentDevices.unlinkedAt)))
          : [];
      await markUnlinked(companyId, [device.id, ...phones.map((p) => p.id)]);
      await logActivity(db, {
        companyId,
        actorType: userId ? "user" : "system",
        actorId: userId ?? "nextgent",
        action: "nextgent.device_unlinked",
        entityType: "nextgent_device",
        entityId: device.id,
        details: { kind: device.kind, relayNodeId: device.relayNodeId, name: device.name, phones: phones.length },
      });
      return { unlinked: true, id: device.id };
    },

    /** The business left (DECISIONS #78): every device is marked unlinked and every device token revoked; gcr-api-clean revokes the nodes. */
    async unlinkAll(companyId: string) {
      const rows = await db
        .select({ id: nextgentDevices.id })
        .from(nextgentDevices)
        .where(and(eq(nextgentDevices.companyId, companyId), isNull(nextgentDevices.unlinkedAt)));
      await markUnlinked(companyId, rows.map((r) => r.id));
      return rows.length;
    },

    /** A status push: upsert the computer, then one Android row per phone it reports, each pointing at the computer. */
    async applyStatus(status: DeviceStatus) {
      const companyId = await requireCompany(status.companyId);
      const now = new Date();
      const seen = status.lastSeenAt ? new Date(status.lastSeenAt) : now;
      const lastSeenAt = Number.isNaN(seen.getTime()) ? now : seen;
      const computerState = {
        ...(status.version !== undefined ? { version: status.version ?? null } : {}),
        ...(status.capabilities !== undefined ? { capabilities: status.capabilities ?? null } : {}),
        lastSeenAt,
        updatedAt: now,
      };
      const computer = await db
        .insert(nextgentDevices)
        .values({ companyId, kind: "computer", relayNodeId: status.nodeId, deviceKey: status.nodeId, ...computerState })
        .onConflictDoUpdate({
          target: [nextgentDevices.relayNodeId, nextgentDevices.kind, nextgentDevices.deviceKey],
          set: computerState,
          // The relay's node belongs to one business; a push naming another company is not applied to it.
          setWhere: eq(nextgentDevices.companyId, companyId),
        })
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!computer || computer.companyId !== companyId) throw conflict("That computer belongs to another company");
      const phones = [];
      for (const phone of status.phones ?? []) {
        const phoneState = {
          pairedComputerId: computer.id,
          ...(phone.sim !== undefined ? { simStatus: phone.sim ?? null } : {}),
          ...(phone.number !== undefined ? { phoneNumber: phone.number ?? null } : {}),
          // A phone the computer reports as offline keeps its last sighting.
          ...(phone.online === false ? {} : { lastSeenAt }),
          updatedAt: now,
        };
        const row = await db
          .insert(nextgentDevices)
          .values({ companyId, kind: "android", relayNodeId: status.nodeId, deviceKey: phone.deviceId, ...phoneState })
          .onConflictDoUpdate({
            target: [nextgentDevices.relayNodeId, nextgentDevices.kind, nextgentDevices.deviceKey],
            set: phoneState,
            setWhere: eq(nextgentDevices.companyId, companyId),
          })
          .returning()
          .then((rows) => rows[0] ?? null);
        if (row) phones.push(view(row));
      }
      return { computer: view(computer), phones };
    },
  };
}
