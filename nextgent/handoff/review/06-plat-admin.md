# Review: Plat-admin (read-only; every file read fully; sectionMap.generated skipped)
Surface layer conforms: no DB key, no API address, /api→Paperclip, /biz→gcr, tokens in memory, cookie stripped.
## Spec deviations
H: automations authored/versioned/installed/run in gcr (console writes to /api/admin/automations; "run by gcr-api-clean" label; run history from gcr).
H: two version/install authorities (gcr automation versions + Paperclip store versions; builder Installs tab switches/removes installs directly in gcr bypassing Paperclip store_installs).
H: device association = gcr ghost_nodes only; no Paperclip route; console doesn't show it as missing.
H: computer releases published as Paperclip store box-release items (two update systems combined); nothing consumes them (ghost-image fetches plans by URL); UI claims waves/quiet window that don't exist.
M: console authors platform state that lands in business DB; GET /api/billing/me can write billing_subscription. Business Data area (Menu & QR, Booking Platform, Trip Swipe, GCR Directory) on by default (was off).
## Owner-rule
Hard-coded: America/Chicago default timezone; schedule cadences and '09:00'; trigger labels; kind list twice; field-type fallback; industry audience wording; 90% threshold; default icon/category.
Stacking: approvals fan-out twice; second query builder; not-connected rule twice; automations module copied from Admin-dashboard-main (two live consoles will drift); whole store fetched to find one item, twice per view.
Dropped: home Overview/Sections (route map + live probe) unregistered (dead); datahome group empty; core-menu lock no longer shown (admin can uncheck Store/Settings, server silently re-adds); plugin key no longer required for plugin items.
Decisions: navigation built from Claude's plan §10 (not spec); Business Data collapsed; deprecation banners; preview-before-push; "Run for real" test option.
## Bugs
H1 Store push of builder automations installs nothing in gcr (payload lacks nextgent section; Paperclip strips unknown keys; activate returns early) → since a5c72d3 automations can't reach businesses at all.
H2 push history goes stale (store installs don't write automation_deployments).
M: Agents screen hides paused agents (scheduler-heartbeats filters them) → can't resume; Overview undercounts. Bridge auth gap: company-scoped instance_admin token gets write on company's slug in gcr without platform_admins check. Push button/price model race leaves controls disabled.
L: stale docs (say store routes missing; they exist); any 404 shown as "not connected yet"; token cache race survives sign-out; proxy drops X-Forwarded-For (all users one IP for rate limits) and leaks gcr address via redirects; unhandled rejections; Settings claims runtime config for build-time var; dead code; broken directory link when group disabled.
All calls verified to exist.
## OPEN
Billing (plan from gcr, AI spend from Paperclip, price set in Paperclip deferring to gcr). Naming ("modules" for screens, "apps" for store kind). Jarvis untouched. FB/Google: placeholder tile only.
