/**
 * Which side decides entitlement and holds prices during the move
 * (DECISIONS #83, #91: cut over by proof, not by calendar):
 *
 *   ENTITLEMENT_SOURCE=gcr        (default until Phase C) the store asks
 *                                 gcr-api-clean's /api/nextgent/entitlement and
 *                                 forwards prices to it
 *   ENTITLEMENT_SOURCE=paperclip  the store decides from its own plans,
 *                                 grants and company plans; store_items prices
 *                                 are authoritative and nothing is forwarded
 */
export type EntitlementSource = "gcr" | "paperclip";

export function entitlementSource(env: Record<string, string | undefined> = process.env): EntitlementSource {
  return env.ENTITLEMENT_SOURCE?.trim().toLowerCase() === "paperclip" ? "paperclip" : "gcr";
}
