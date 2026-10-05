import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * The device registry (SPEC §5, DECISIONS #69–#73): which computers and
 * Android phones belong to a company. Paperclip knows the devices; the relay
 * in gcr-api-clean reaches them (`relay_node_id` is its `ghost_nodes.id`);
 * nextgent-platform operates them. A computer is paired through Paperclip
 * (DECISIONS #69); an Android is a row derived from its computer's heartbeat
 * (DECISIONS #72), keyed by the phone's stable id. State (`version`,
 * `capabilities`, `sim_status`, `last_seen_at`) arrives by signed status push
 * from gcr-api-clean; `online` is computed from `last_seen_at` with the
 * configured window, never stored.
 */
export const nextgentDevices = pgTable(
  "nextgent_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** "computer" | "android" */
    kind: text("kind").notNull(),
    relayNodeId: text("relay_node_id").notNull(),
    /** The computer: its relay node id. The Android: the phone's stable device id. */
    deviceKey: text("device_key").notNull(),
    pairedComputerId: uuid("paired_computer_id"),
    name: text("name"),
    version: text("version"),
    capabilities: jsonb("capabilities").$type<unknown>(),
    simStatus: text("sim_status"),
    /** The Android's SIM number, when the heartbeat reports it. */
    phoneNumber: text("phone_number"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    pairedByUserId: text("paired_by_user_id"),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    relayDeviceUq: uniqueIndex("nextgent_devices_relay_kind_key_uq").on(table.relayNodeId, table.kind, table.deviceKey),
    companyIdx: index("nextgent_devices_company_idx").on(table.companyId),
  }),
);
