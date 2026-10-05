/**
 * The pure part of entitlement — no database, no clock of its own. A port of
 * gcr-api-clean lib/entitlements.js `decide` (DECISIONS #83).
 *
 * A company may have an item when the item is published AND one of:
 *   free    the item's access is 'free': every company
 *   grant   the operator granted it to this company, and the grant is live
 *           (not revoked, not expired)
 *   plan    the item's access is 'plan' and the company's plan includes it
 * An item whose access is 'grant' is reached by grant only.
 */
export type EntitlementReason = "free" | "grant" | "plan" | "unpublished" | "not_entitled";

export interface EntitlementItem {
  id: string;
  status: string;
  access: string;
}

export interface EntitlementGrant {
  revokedAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

export interface EntitlementDecision {
  ok: boolean;
  reason: EntitlementReason;
}

export function grantIsLive(grant: EntitlementGrant | null | undefined, now: Date): boolean {
  if (!grant || grant.revokedAt) return false;
  return !grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime();
}

export function decide(input: { item: EntitlementItem | null | undefined; planItemIds: Set<string> | null | undefined; grant: EntitlementGrant | null | undefined; now?: Date }): EntitlementDecision {
  const { item, planItemIds, grant } = input;
  const now = input.now ?? new Date();
  if (!item || item.status !== "published") return { ok: false, reason: "unpublished" };
  if (item.access === "free") return { ok: true, reason: "free" };
  if (grantIsLive(grant, now)) return { ok: true, reason: "grant" };
  if (item.access === "plan" && planItemIds && planItemIds.has(item.id)) return { ok: true, reason: "plan" };
  return { ok: false, reason: "not_entitled" };
}

/** The wording the store answers a refused install with (gcr-api-clean entitlementFor). */
export function refusalMessage(reason: EntitlementReason): string {
  switch (reason) {
    case "unpublished": return "That item is not available.";
    case "not_entitled": return "This item is not included in the business's plan";
    default: return "This item is not available to this business";
  }
}
