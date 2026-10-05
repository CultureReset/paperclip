# Review: paperclip (read-only; all non-generated files read fully; 14 commits, ~6,500 lines incl. deploy WIP)
## Spec deviations
1 Automations: logic in gcr; Paperclip only creates a hand-off routine and gives its webhook secret to gcr (nextgent-store.ts:180-202, 259-263, 285-295).
2 box-release (ghost-image plans) is a Paperclip store kind → the two update systems merged (store.ts:23, 51-56, 390; migration 0290).
3 Store authority split: price authoritative in gcr (Paperclip copy "for display"), entitlement/charges decided by gcr.
4 Costs not Paperclip's: LiteLLM budgets + gcr usage credits + Paperclip budgets untouched; gcr also mints LiteLLM keys (stacked).
5 Business state copied into Paperclip: nextgent_business_links.business_kind (drifts) + forwarding_address; link held twice.
6 Customer call/SMS transcripts (from/to, full text, no size cap) stored in Paperclip activity_log.
7 Device association missing in Paperclip (gap).
8 No installed-app projection in Paperclip; gcr.install doesn't send the manifest; two install registries.
9 Bridge restored as infrastructure (correct); caveats below.
10 Team invite email sent via gcr (low).
## Owner-rule
"Jarvis" hard-coded in UI (product.ts, onboarding, Jarvis.tsx finds by name) while server creates assistant from NEXTGENT_ASSISTANT_NAME → possible two assistants. "NEXT GENT" brand hard-coded. Unsettled choices hard-coded (assistant role ceo, budget 0, routine priority/policies, CHANGING_ACTIONS). Dropped: plugin's Business page/sidebar/widget. Admin push installMissing+audience all+enabled can create running agents without owner consent (free, no permissions). enableAgentChat default flipped to true. Duplicate env blocks. Twilio listed as legacy option in WIP docs.
## Bugs
H1 install-token route returns long-lived business token to browser (expiresAt null) to any non-viewer member/admin.
H2 scoped agent tokens fail open to the company token (after unlink/relink, no token from gcr, gcr unconfigured).
H3 link conflict checked after gcr.link → orphaned link/token in gcr.
H4 store update partially applied on gcr failure (version + grants moved, gcr keeps old scope, never retried).
M: JWT key auto-generated in production; relink can keep old business token; duplicate assistants; orphan hand-off routine if trigger fails; inbound replay within 300 s (no nonce); LiteLLM model names won't resolve (tiers vs vendor ids); wrong deployment status.
L: viewers can't read link (docs say any member); agents can trigger invite emails to any address, invite not bound to email; setup runs for every self-serve sign-up; stale comments; WIP gaps (missing STEPS.md, hard-coded ports, smoke-test image for workers, invalid matcher).
Tests: box-release test asserts nothing; rotated-value test doesn't check value; untested install-token, receipts list, failed moveInstall, unlink/relink scoping, link conflict.
Fine: HMAC constant-time over raw body, JWKS public only, TTL cap, no slug from tool args, migrations additive.
## OPEN
Jarvis: cloud. FB/Google: official API in gcr. Billing: in gcr (conflicts with "Paperclip owns costs"). Naming: "app".
