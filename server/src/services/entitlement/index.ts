import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { storeItems } from "@paperclipai/db";
import { HttpError, notFound } from "../../errors.js";
import { decide, refusalMessage, type EntitlementDecision } from "./decide.js";
import { entitlementPlans } from "./plans.js";

export { decide, grantIsLive, refusalMessage } from "./decide.js";
export { entitlementSource, type EntitlementSource } from "./config.js";
export { entitlementPlans, COMPANY_PLAN_STATUSES } from "./plans.js";

/**
 * Entitlement — the module's entry point (DECISIONS #81, #83): may this
 * company have this store item, and at what price? The port of gcr-api-clean
 * lib/entitlements.js contextFor/decide and routes/nextgent.js entitlementFor:
 * decide (free / grant / plan), then the paused check — a paused company is
 * refused anything priced.
 */
export interface StoreCharge {
  priceCents: number | null;
  interval: string | null;
}

export interface EntitlementAnswer extends EntitlementDecision {
  allowed: boolean;
  itemId: string;
  itemKey: string;
  priceCents: number | null;
  interval: string | null;
  paused: boolean;
  planKey: string | null;
}

export function entitlementService(db: Db) {
  const plans = entitlementPlans(db);

  async function itemByKey(itemKey: string) {
    const item = await db.select().from(storeItems).where(eq(storeItems.key, itemKey)).then((rows) => rows[0] ?? null);
    if (!item) throw notFound(`No store item has the key ${itemKey}`);
    return item;
  }

  /** Everything needed to decide for one company, across every item. */
  async function contextFor(companyId: string, now = new Date()) {
    const resolved = await plans.planFor(companyId);
    const planItemIds = await plans.planItemIds(resolved.plan?.id);
    const grants = await plans.liveGrants(companyId, now);
    return {
      planKey: resolved.plan?.key ?? null,
      paused: resolved.paused,
      decide: (item: { id: string; status: string; access: string }) => decide({ item, planItemIds, grant: grants.get(item.id), now }),
    };
  }

  async function entitlementFor(companyId: string, itemKey: string): Promise<EntitlementAnswer> {
    const item = await itemByKey(itemKey);
    const context = await contextFor(companyId);
    const decision = context.decide(item);
    const priceCents = item.priceAmountCents ?? null;
    const priced = (priceCents ?? 0) > 0;
    const allowed = decision.ok && !(priced && context.paused);
    return { ...decision, allowed, itemId: item.id, itemKey: item.key, priceCents, interval: item.priceInterval ?? null, paused: context.paused, planKey: context.planKey };
  }

  return {
    plans,
    contextFor,
    entitlementFor,

    /**
     * Before install: refuse (402, code not_entitled, with the charge) when
     * the company may not have the item; otherwise what will be charged. The
     * same shape the gcr bridge's assertEntitled answers, so the store does
     * not care which side decided.
     */
    async assertEntitled(companyId: string, itemKey: string): Promise<StoreCharge | null> {
      const answer = await entitlementFor(companyId, itemKey);
      const charge: StoreCharge = { priceCents: answer.priceCents, interval: answer.interval };
      if (!answer.allowed) {
        const message = answer.ok ? "This business's plan is paused, so priced items cannot be installed" : refusalMessage(answer.reason);
        throw new HttpError(402, message, { code: "not_entitled", reason: answer.reason, paused: answer.paused, ...charge });
      }
      return charge;
    },
  };
}

export type EntitlementService = ReturnType<typeof entitlementService>;
