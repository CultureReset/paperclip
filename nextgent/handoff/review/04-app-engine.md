# Review: App-build- engine (read-only; every file read fully except lockfile; 72+70 tests pass)
## Matches spec
Manifest + shared runtime; own login/Supabase/store off behind flag; data via gcr with install token, no slug; app records scoped to install; owner+public over same sources; publishes to Paperclip store.
## Spec deviations
D1 High: builder only makes app-owned private tables with no business permissions; its QR Menu starter converts to the same item key (core-qr-menu) as the shipped QR Menu that reads business menu → publishing adds a version with a different data model to the existing item.
D2 High: store rules generated from gcr's donor store; Paperclip (the authority) accepts payload.app unvalidated; only client-side validation.
D3 Medium: every shipped app defined twice (src/modules/*/manifest.ts starters + apps/*/manifest.json), already differing.
D4 Medium: FAQ entries, leads, contacts/identity, per-app currency stored as app records instead of business data.
D5 Medium: no app declares events → automations have no event sources.
D6 Low: home page still shows App-build's own store catalogue saying apps "arrive with their own sealed data".
## Owner-rule
Magic field-key conventions in converter; placeholders (accent colour, author "Store", category operations); feed assumes created_at; English text built from labels; fixed colours; social network list hard-coded in manifest (vendor). Dropped with flag off: builder saving/drafts/versions/visibility/reload, categories, paid pricing, old public/install pages with no data migration. Copies: store-rules (generated), values.js record checks. Unsettled decisions: manifest v1 extensions, block vocabulary, item key scheme, browser publishing with admin session, unauthenticated /build and /build/describe, embed providers, 'core' publisher.
## Bugs
H1 owner saves fail for any select with optionsFrom (adapter checks without data) → QR Menu items can't get a section.
H2 HTML renderer attribute injection via tone/style/type (XSS) on public pages.
M3 owner-only fields can reach visitors through default title slot. M4 validator public/owner check bypassable. M5 valid-but-broken public forms on business sources. M6 unauthenticated AI builder: spoofable rate limit, unbounded memory. M7 publishing can add versions to any item with the same key.
L: text in number fields becomes 0; partial updates wipe fields; failed install load shows write controls; javascript: homepage accepted; id allows dots (Paperclip rejects); stale README.
Tests: tautological route test; owner-only test can't fail; store-rules test depends on sibling checkout; no tests for bugs 1–2 or action loop.
Branch note: gcr CLAUDE.md names claude/new-session-1e1dj0 as work branch.
## OPEN
Billing (builder drops pricing). Naming: engine "app", builder "module".
