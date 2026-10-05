import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companyPlans, storeGrants, storeItems, storePlanItems, storePlans } from "@paperclipai/db";
import { badRequest, conflict, notFound } from "../../errors.js";
import { grantIsLive } from "./decide.js";

/**
 * Plans, plan items, grants and the company's plan: the rows entitlement
 * decides from (DECISIONS #83), and the admin operations on them. Nothing is
 * deleted that a company could still be on: a plan with companies is refused
 * removal; a grant is revoked, never erased.
 */
export type PlanRow = typeof storePlans.$inferSelect;
export type GrantRow = typeof storeGrants.$inferSelect;
export type CompanyPlanRow = typeof companyPlans.$inferSelect;

export interface PlanInput {
  key: string;
  name: string;
  description?: string | null;
  isPublic?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface GrantInput {
  companyId: string;
  itemId: string;
  note?: string | null;
  expiresAt?: Date | string | null;
}

export const COMPANY_PLAN_STATUSES = ["active", "trialing", "paused", "cancelled"] as const;
export type CompanyPlanStatus = (typeof COMPANY_PLAN_STATUSES)[number];

export function entitlementPlans(db: Db) {
  async function getPlan(planId: string): Promise<PlanRow> {
    const plan = await db.select().from(storePlans).where(eq(storePlans.id, planId)).then((rows) => rows[0] ?? null);
    if (!plan) throw notFound("Plan not found");
    return plan;
  }

  async function clearDefault(exceptId: string | null) {
    await db.update(storePlans).set({ isDefault: false, updatedAt: new Date() }).where(exceptId ? and(eq(storePlans.isDefault, true), eq(storePlans.id, exceptId)) : eq(storePlans.isDefault, true));
  }

  return {
    /** The plan a company without one is on (is_default), or null when none is set. */
    async defaultPlan(): Promise<PlanRow | null> {
      return db.select().from(storePlans).where(eq(storePlans.isDefault, true)).then((rows) => rows[0] ?? null);
    },

    /** The company's plan row and the plan it resolves to (its own when active/trialing, else the default). */
    async planFor(companyId: string): Promise<{ companyPlan: CompanyPlanRow | null; plan: PlanRow | null; paused: boolean }> {
      const companyPlan = await db.select().from(companyPlans).where(eq(companyPlans.companyId, companyId)).then((rows) => rows[0] ?? null);
      const paused = companyPlan?.status === "paused" || companyPlan?.pausedAt !== null && companyPlan?.pausedAt !== undefined;
      const own = companyPlan && (companyPlan.status === "active" || companyPlan.status === "trialing") && companyPlan.planId
        ? await getPlan(companyPlan.planId).catch(() => null)
        : null;
      return { companyPlan, plan: own ?? (await this.defaultPlan()), paused };
    },

    /** The item ids a plan includes. */
    async planItemIds(planId: string | null | undefined): Promise<Set<string>> {
      if (!planId) return new Set();
      const rows = await db.select({ itemId: storePlanItems.itemId }).from(storePlanItems).where(eq(storePlanItems.planId, planId));
      return new Set(rows.map((row) => row.itemId));
    },

    /** The company's live grant for an item, or null. */
    async liveGrant(companyId: string, itemId: string, now = new Date()): Promise<GrantRow | null> {
      const rows = await db.select().from(storeGrants).where(and(eq(storeGrants.companyId, companyId), eq(storeGrants.itemId, itemId), isNull(storeGrants.revokedAt)));
      return rows.find((grant) => grantIsLive(grant, now)) ?? null;
    },

    /** Every live grant of a company, by item id. */
    async liveGrants(companyId: string, now = new Date()): Promise<Map<string, GrantRow>> {
      const rows = await db.select().from(storeGrants).where(and(eq(storeGrants.companyId, companyId), isNull(storeGrants.revokedAt)));
      return new Map(rows.filter((grant) => grantIsLive(grant, now)).map((grant) => [grant.itemId, grant]));
    },

    // ----- Admin ----------------------------------------------------------

    async listPlans() {
      const plans = await db.select().from(storePlans).orderBy(asc(storePlans.sortOrder), asc(storePlans.name));
      const items = plans.length
        ? await db.select({ planId: storePlanItems.planId, itemId: storePlanItems.itemId, key: storeItems.key, name: storeItems.name, kind: storeItems.kind })
          .from(storePlanItems).innerJoin(storeItems, eq(storeItems.id, storePlanItems.itemId)).where(inArray(storePlanItems.planId, plans.map((p) => p.id)))
        : [];
      const members = await db.select({ planId: companyPlans.planId }).from(companyPlans);
      const counts = new Map<string, number>();
      for (const row of members) if (row.planId) counts.set(row.planId, (counts.get(row.planId) ?? 0) + 1);
      return plans.map((plan) => ({ ...plan, items: items.filter((item) => item.planId === plan.id).map(({ itemId, key, name, kind }) => ({ itemId, key, name, kind })), companies: counts.get(plan.id) ?? 0 }));
    },

    async createPlan(input: PlanInput) {
      const key = input.key.trim();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) throw badRequest("Plan key must be lowercase letters, numbers, dashes and underscores");
      const duplicate = await db.select({ id: storePlans.id }).from(storePlans).where(eq(storePlans.key, key));
      if (duplicate.length) throw conflict(`A plan with key "${key}" already exists`);
      if (input.isDefault) await clearDefault(null);
      const [plan] = await db.insert(storePlans).values({
        key, name: input.name.trim(), description: input.description ?? null, isPublic: input.isPublic ?? true, isDefault: input.isDefault ?? false, sortOrder: input.sortOrder ?? 0,
      }).returning();
      return plan;
    },

    async updatePlan(planId: string, patch: Partial<Omit<PlanInput, "key">>) {
      await getPlan(planId);
      if (patch.isDefault) await clearDefault(planId);
      const [plan] = await db.update(storePlans).set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: new Date(),
      }).where(eq(storePlans.id, planId)).returning();
      return plan;
    },

    /** Add an item to a plan (idempotent). */
    async addPlanItem(planId: string, itemId: string) {
      await getPlan(planId);
      const item = await db.select({ id: storeItems.id }).from(storeItems).where(eq(storeItems.id, itemId)).then((rows) => rows[0] ?? null);
      if (!item) throw notFound("Store item not found");
      await db.insert(storePlanItems).values({ planId, itemId }).onConflictDoNothing();
      return { planId, itemId };
    },

    async removePlanItem(planId: string, itemId: string) {
      await getPlan(planId);
      const removed = await db.delete(storePlanItems).where(and(eq(storePlanItems.planId, planId), eq(storePlanItems.itemId, itemId))).returning({ id: storePlanItems.id });
      if (!removed.length) throw notFound("That item is not in the plan");
      return { planId, itemId, removed: true };
    },

    async listGrants(filter: { companyId?: string | null; itemId?: string | null; includeRevoked?: boolean } = {}) {
      const conditions = [];
      if (filter.companyId) conditions.push(eq(storeGrants.companyId, filter.companyId));
      if (filter.itemId) conditions.push(eq(storeGrants.itemId, filter.itemId));
      if (!filter.includeRevoked) conditions.push(isNull(storeGrants.revokedAt));
      const rows = await db
        .select({ grant: storeGrants, itemKey: storeItems.key, itemName: storeItems.name, companyName: companies.name })
        .from(storeGrants)
        .innerJoin(storeItems, eq(storeItems.id, storeGrants.itemId))
        .innerJoin(companies, eq(companies.id, storeGrants.companyId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(storeGrants.createdAt));
      const now = new Date();
      return rows.map(({ grant, itemKey, itemName, companyName }) => ({ ...grant, itemKey, itemName, companyName, live: grantIsLive(grant, now) }));
    },

    /** Grant an item to a company; a live grant for the pair is replaced (revoked, then re-granted). */
    async createGrant(input: GrantInput, userId: string | null) {
      const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId)).then((rows) => rows[0] ?? null);
      if (!company) throw notFound("Company not found");
      const item = await db.select({ id: storeItems.id }).from(storeItems).where(eq(storeItems.id, input.itemId)).then((rows) => rows[0] ?? null);
      if (!item) throw notFound("Store item not found");
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) throw badRequest("expiresAt is not a date");
      const now = new Date();
      await db.update(storeGrants).set({ revokedAt: now }).where(and(eq(storeGrants.companyId, input.companyId), eq(storeGrants.itemId, input.itemId), isNull(storeGrants.revokedAt)));
      const [grant] = await db.insert(storeGrants).values({ companyId: input.companyId, itemId: input.itemId, note: input.note ?? null, expiresAt, grantedByUserId: userId }).returning();
      return grant;
    },

    async revokeGrant(grantId: string) {
      const [grant] = await db.update(storeGrants).set({ revokedAt: new Date() }).where(and(eq(storeGrants.id, grantId), isNull(storeGrants.revokedAt))).returning();
      if (!grant) throw notFound("Grant not found or already revoked");
      return grant;
    },

    async getCompanyPlan(companyId: string) {
      const resolved = await this.planFor(companyId);
      return { companyId, companyPlan: resolved.companyPlan, plan: resolved.plan, paused: resolved.paused, usingDefault: !resolved.companyPlan?.planId };
    },

    /** Put a company on a plan, or pause/resume it. */
    async setCompanyPlan(companyId: string, input: { planId?: string | null; status?: CompanyPlanStatus; pauseReason?: string | null }, userId: string | null) {
      const company = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0] ?? null);
      if (!company) throw notFound("Company not found");
      if (input.planId) await getPlan(input.planId);
      if (input.status && !(COMPANY_PLAN_STATUSES as readonly string[]).includes(input.status)) throw badRequest(`status must be one of ${COMPANY_PLAN_STATUSES.join(", ")}`);
      const now = new Date();
      const status = input.status ?? "active";
      const row = {
        planId: input.planId === undefined ? undefined : input.planId,
        status,
        pausedAt: status === "paused" ? now : null,
        pauseReason: status === "paused" ? input.pauseReason ?? null : null,
        updatedByUserId: userId,
        updatedAt: now,
      };
      const [saved] = await db
        .insert(companyPlans)
        .values({ companyId, planId: input.planId ?? null, status, pausedAt: row.pausedAt, pauseReason: row.pauseReason, updatedByUserId: userId })
        .onConflictDoUpdate({ target: companyPlans.companyId, set: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) })
        .returning();
      return saved;
    },
  };
}

export type EntitlementPlans = ReturnType<typeof entitlementPlans>;
