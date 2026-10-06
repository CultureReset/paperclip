# Production migration approval scope

Target: Supabase **cyber check**, project **mkepugvdlktfsossumox**.

Status: **applied after explicit user approval**. Migration `20261005235926_nextgent_existing_core_assembly` succeeded on cyber check. The unchanged SQL SHA-256 below was checked before application. All ten new tables have RLS enabled, anon/authenticated SELECT revoked and service-role SELECT/INSERT/UPDATE/DELETE granted. Company/admin identity, relay idempotency, node registry and app projection columns were verified. The earlier automatic-review rejection was resolved by the user approving this exact scope.

This file is the exact attempted batch, assembled from existing GCR migrations, plus explicit server-role grants. It adds business/company links and credentials, node pairing and request tracking, app-install projections, owner notifications and app data tables. It enables RLS/revokes browser-role access on new server-owned tables and grants service_role access. Existing tables receive columns/indexes. It is not the separate Stripe billing migration batch and does not finish all launch migrations.

SQL SHA-256: `0c0e3f1343bceb6c563d06b9667e1483c70f0245f28d5f7c11956208f1345239`.

Included sources:

- `sql/business_mcp_tokens.sql`
- `sql/ghost_mcp_tokens.sql`
- `sql/nextgent_link.sql`
- `sql/nextgent_installs.sql`
- `sql/nextgent_claims.sql`
- `sql/nextgent_notify.sql`
- `sql/nextgent_nodes.sql`
- `sql/nextgent_nodes_registry.sql`
- `sql/nextgent_apps.sql`
- `sql/nextgent_entity_modules.sql`

Explicit grant targets: business_mcp_tokens, ghost_mcp_tokens, company_links, nextgent_installs, claim_codes, owner_notify_settings, owner_notifications, node_pairings, node_remote_sessions and app_records.

Expected impact: new schema objects and permissions; DDL can take locks on existing tables. After approval, apply the unchanged SQL through Supabase migrations, inspect the resulting schema/security settings, then run authenticated linking/relay/app acceptance. Billing migrations and price folds require their own reviewed scope. No payment provider keys or customer account records are included.
