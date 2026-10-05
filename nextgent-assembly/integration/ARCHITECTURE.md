# NEXT GENT integration checkpoint — 2026-10-05

This assembly retains the existing product and repositories. It is a software integration checkpoint, not a production launch certification. Uploaded sources remain the baseline; repairs are applied in `repos/`, with branch provenance recorded below. The initial checkpoints were local; reviewed repairs are now committed to GitHub integration branches. No production deployment, database write or device action has been performed.

## Canonical ownership, grounded in code

| Block | Authority and reused implementation |
| --- | --- |
| Paperclip | Company membership, orchestration, agents, issues, approvals, store versions/installs/consent, billing, device registry and receipt/activity ingestion. `server/src/routes/{nextgent,store}.ts`, `services/store*.ts`. |
| GCR API | Business records and owner APIs, each business's MCP, install-scoped data access, app data/contracts, computer pairing and outbound relay. `routes/{business,mcp,mcp-ghost,nodes}.js`, `lib/{ghostReceipts,deviceSync}.js`. |
| App-build- | Shared manifest validation, data adapters, public/owner rendering and existing app authoring. `packages/engine`. Boxes, Play-user and GCR consume this same local package. |
| nextgent-platform | Local action state, policy, approval transport, map dispatch, physical Android service, verification and durable receipts. `services/{core,androidd}`, `src/nextgent/{actions,approvals,maps,verify,link}`. |
| nextgent-maps | Versioned App Maps and capability/phrase catalog. The runtime loads this repository through `NEXTGENT_MAPS_DIR`; it does not invent app actions. |
| Boxes | Existing Linux shell/TV UI and daemon, business views, pairing, app engine and local service integration. Its own Android provider remains off unless `NEXTGENT_LOCAL_ANDROID=1`; the assembled default delegates execution to nextgent-platform. |
| OpenJarvis | Conversational identity, existing agents/engines and MCP client/server support. It reaches business and device functionality through granted MCP tools. Existing local and remote engine options are preserved. |
| Plat-admin | Existing business/platform administrative UI and generated backend section map. |
| Play-user | Existing business user UI, onboarding, conversations, agents, automations, computer status, apps and owner rendering through `EngineApp`. The fuller existing integration branch is reconciled into the uploaded main baseline; legacy files are retained. |
| GCR unified | Existing public discovery/business UI, public app rendering and prerendering. |
| Standalone nextgent-store | Existing box store and legacy assistant/n8n activation compatibility. Paperclip is the canonical new app/install authority. Existing Paperclip-bound agents are displayed as managed in the business app, and a guard refuses parallel legacy activation/pause for the same item. Legacy n8n behavior is retained; migration of those installations is unfinished. |

Business writes flow through GCR's existing data contracts and per-business MCP. Store publishing, consent and install ownership remain in Paperclip, with GCR's module/install projection serving installed apps. The user, admin and public surfaces are separate existing products, not collapsed into a replacement dashboard.

For physical work: Paperclip assignment/MCP → GCR computer relay → outbound local link → local core policy/approval → App Map → androidd → physical phone → verifier → durable local receipt → GCR → signed Paperclip receipt/activity. The phone is an app execution environment. SMS is one existing approval channel and capability, not its entire purpose.

## Source reconciliation

Nine distinct uploaded source archives were extracted. The two OpenJarvis uploads have identical SHA-256 and are one source baseline; see `inventory.json` at the assembly root.

The uploads omitted dependencies already referenced by their code. Recovered existing repositories:

| Repository | Existing branch / commit |
| --- | --- |
| CultureReset/gcr-api-clean | `claude/agent-ecosystem-architecture-nzexu1`, `b919b8684cdc6a6171940fa64ac80c3b240cda73` |
| CultureReset/App-build- | `claude/agent-ecosystem-architecture-nzexu1`, `3b6eb1baa15c209e685a9086d54fd5a8d26b63a8` |
| CultureReset/Play-user | `claude/agent-ecosystem-architecture-nzexu1`, `15a1562d8f13a33f7aca21c914f14b7fb7bb85f9` |

Play-user was recovered through the connected repository API, compared by Git blob SHA with the upload, and verified against the branch tree before reconciliation. `play-provenance.json` records file SHAs. The old June GCR API archive was inspected as historical material and excluded from this assembly.

## Repairs made

- Android service authentication now returns HTTP 401 from its middleware instead of an unhandled middleware exception.
- Core action/receipt/approval reads enforce the configured local token, accepting the existing bearer integration as well as `X-Ghost-Token`.
- Relay retries derive a stable local action ID. Repeated delivery reuses its action and ASK approval; conflicting request data is rejected by the existing action service.
- SQLite dispatch claims READY atomically before any physical execution, preventing concurrent dispatch of one action.
- Execution and observation failures now create durable FAILED/INDETERMINATE receipts rather than losing results or leaving the action EXECUTING.
- Local receipt delivery uses a durable outbox independent of the kernel ledger mirror. Only a wholly accepted GCR batch is acknowledged; exact receipt snapshots prevent an acknowledgement from consuming a newer result.
- GCR understands the actual nested ActionRecord ID and raw Receipt fields, links late results to their originating Paperclip task, and preserves observations, device/environment, timestamp and evidence.
- GCR recovers expired dispatch leases after three minutes, preserving the request ID for local idempotency, and marks receipt delivery pending before the first upstream attempt.
- GCR retries failed signed Paperclip receipt delivery on later computer polls. Ordinary non-receipt responses cannot starve the retry window.
- Heartbeats include fresh local capability and physical-device availability without forwarding private foreground app state.
- Python and GCR relay path allow-lists agree on exact supported core paths.
- Jarvis ask/serve now reuse the existing config-relative MCP JSON-file resolver, fixing the standalone store's MCP config fragment without replacing the MCP stack.
- Jarvis child liveness now uses non-reaping kernel wait status for owned children, avoiding mismatched /proc PID namespaces while preserving exit collection and the existing non-child fallback.
- Admin's generated section map reflects the recovered API: 92 sections and 234 endpoints.
- The existing fuller Play-user integration code replaces stale entry points while retaining legacy source files. Its shared engine dependency, business proxy, install-token flow and existing screens are reused.
- The standalone store detects Paperclip store agent bindings before legacy activation or pause, preventing that specific duplicate lifecycle conflict. It remains a compatibility layer, not a second canonical app catalog.

The continued integration pass also repairs Play-user token and business-context invalidation on company/account transitions; distinguishes missing business links from GCR permission denials; and returns durable MCP receipts to Jarvis after retry or failure. Existing layouts, store contracts and verification authority are preserved. The actual Jarvis loader and tool adapter are now tested against the platform subprocess over stdio, including owner approval and missing-phone failure.

## Wiring and checks

Keep all directories under `repos/` adjacent: existing `file:../App-build-/packages/engine` dependencies depend on that topology. Node 24.19.0 was used. Paperclip's package manager must be **pnpm 9.15.4**, as pinned by its package.json; the runtime's newer pnpm is incompatible with its frozen lockfile/patch configuration.

Use each repository's existing environment template and installer rather than creating alternate services. Wiring names are summarized in `assembly.json`. `check.py` reruns the actual repository commands and records every exit status. It does not declare launch readiness when a check fails.

The relay integration fixture uses real core, link and GCR HTTP/MCP routes, repository memdb, and a captured signed Paperclip test sink. It tests an actual missing-phone failure, not a simulated successful device action. Run from nextgent-platform: `PYTHONPATH=src python -m pytest ../../integration/test_relay_e2e.py -q`.

`proof5/` is the existing Paperclip handoff harness made path-configurable. It mounts real routes with fixture actors and GCR memdb, and requires a host capable of starting embedded PostgreSQL. It is not a production authentication test.

## Remaining launch work

- Paperclip full typecheck now passes after bounding its native compiler heap. The full build command returned zero, and the targeted server/UI/CLI build passed with explicit completion markers; broad tests still fail. Triage failures and finish remaining test groups on a host with normal process inspection, Unix sockets and a non-root PostgreSQL execution user. This runtime restricts these facilities; failing/skipped tests must remain visible in evidence.
- Run the existing signed business-link, store install/consent/update, device registry and receipt proofs with real Paperclip PostgreSQL plus a GCR test database. GCR's memdb verification does not establish deployed Supabase schema or RLS correctness.
- Pair a real Android phone with ADB/uiautomator2, scrcpy and the supported X11 input path. Run installed App Maps and verify evidence/receipts after observed app state. No phone, ADB or scrcpy is exposed here. Wayland execution remains unsupported in the existing controller.
- Exercise real owner/admin sessions across the recovered UIs, company boundaries, per-business MCP grants and install tokens. Component tests/builds are not authenticated browser acceptance.
- Reconcile any pre-existing standalone assistant/n8n installations with Paperclip store bindings before migrating their lifecycle. The new guard prevents one duplicate case; it is not a completed migration or an OpenBot inbound bridge.
- Configure and prove the real Jarvis model/worker credentials and existing Paperclip adapters. The compiled Rust extension and MCP tests do not prove a live model/agent assignment.
- Review crash recovery for already EXECUTING actions without automatically replaying device work. The atomic claim deliberately prevents re-execution; restart inspection/reconciliation still needs an acceptance path.
- Long-horizon relay receipt deduplication currently uses the existing bounded recent-history search, not a new database uniqueness migration. This can repeat an audit event after a sufficiently long acknowledgement outage; it does not re-execute the phone action.

These are concrete unfinished integration/acceptance items. No listed product block has been removed or substituted.

## Jarvis assembly using the existing blocks

`configure_jarvis.py --owner-id <the-local-core-owner-id> --output <new-config-directory>` combines the existing Ghost model configuration with the existing store's Paperclip instructions/tool allowlist, plus the platform's three MCP tools. It refuses to overwrite existing config files. Set `OPENJARVIS_CONFIG` to the generated `config.toml`. Model selection remains the existing configuration choice.

The Paperclip subprocess is the existing `jarvis/paperclip-mcp.sh`, requiring `PAPERCLIP_SOURCE_DIR`, `PAPERCLIP_API_URL`, a company-scoped `PAPERCLIP_API_KEY`, and `PAPERCLIP_COMPANY_ID`. No board approval-decision tool is exposed. The platform subprocess is `integration/nextgent-mcp.sh`, a launcher for the existing Python MCP module. It requires `NEXTGENT_OWNER_ID` and an **absolute** `NEXTGENT_DB_PATH` matching the local core, avoiding separate ledgers caused by different process working directories. Keep the same policy, Android service configuration and evidence/receipt directories across these processes. Its maps default is the actual adjacent maps catalog. `NEXTGENT_PYTHON` can select the installed platform interpreter.

The real subprocess integration now uses this launcher. Config generation, tool/path preservation, overwrite refusal and relative-database refusal were checked without starting a model or contacting Paperclip.

Paperclip's continued route audit adds its existing 33 mounted NEXT GENT operations to OpenAPI, including device pairing, automations, notification settings and entitlements. It preserves route handlers and their board/admin checks. Runtime API discovery tolerates an unavailable OS interface inventory while retaining configured addresses. The existing company-scoped plugin query and NEXT GENT greeting are preserved; their stale test fixtures now match the code.

## Accepted launch scope — 2026-10-05

The owner confirmed: finish the existing Stripe billing; launch the business software and physical Android system together as one hybrid product; App Maps are independently publishable/updateable assets managed through the admin dashboard, not hardcoded runtime workflows. Map bundles may require Python/Bash helpers; the inspected current runner executes declarative map transitions, not arbitrary uploaded scripts. Packaging/executor compatibility needs explicit implementation without replacing the existing verifier or policy.

NEXT GENT itself must be the first full business deployment. The founder needs normal business access and platform-admin access, with the full business apps, automations, Jarvis, Hermes and OpenClaw configuration. It uses the same business installation/task/receipt paths sold to customers, with platform publishing and management available through administrator access. No live account or worker credentials have been provisioned here.

Existing building blocks for map distribution: Plat-admin `StorePublishing.jsx`; Paperclip versioned releases and company install/consent; nextgent-maps catalog; and the recovered ghost-image installer, which pulls signed plans, pins commits, health-checks and rolls back individual blocks. The admin-to-device map publication/delivery bridge is not yet implemented. Private signing keys must stay with the release signer; enrolled boxes need trusted public keys (the installer also has a development-only unsigned allowance before any key is trusted).

The current catalog now refuses filesystem fallback when a catalog has withdrawn a map or marks it non-installable. This prevents an older on-disk version from bypassing the authoritative release catalog.

Additional recovered source: `repos/nextgent-ghost-image-main`, CultureReset/nextgent-ghost-image main tree `d8d390aa99aafacc014d0fd4a4d617dfe501b686`. All 29 recovered source/config files match Git blob hashes. Seven documentation PNGs and cached bytecode were excluded; this is not a full binary mirror. Installer unit tests: 12 passed. Live hardware installation remains unverified. Its historical runbook references older dashboards and ang-* blocks; those dependencies must be reconciled with the canonical assembly before deploying it unchanged.

Billing already exists in GCR `lib/billingStripe.js` and related SQL/routes: recurring item charges, one-time invoice items, usage recording and payment-state handling. No Lago integration was found in the checked billing paths; the confirmed launch choice is the existing billing.

Automation authority is Paperclip; Play-user supplies its interface, GCR business events/data, and legacy n8n integrations require ownership reconciliation. Messaging channels remain separate: platform SMS through signed GCR platform-text/Telnyx; Paperclip platform email; GCR owner email/SMS notifications; and local physical-phone SIM execution/approval transport.

GCR's documented live Supabase target is `cyber check`, ref `mkepugvdlktfsossumox`; verify live connection identity before migrations. Paperclip has separate persistent PostgreSQL. Admin-dashboard-main and Dashboards-users- remain unreconciled; they have not been declared retired or merged.


### Signed device release wiring (reconstructed 2026-10-05)

Plat-admin authenticates with Paperclip cookies and obtains the existing short-lived /admin/business-token credential for GCR administration. Its /biz proxy preserves bearer credentials and excludes Paperclip cookies. GCR's existing artifact store remains the owner of map/box_release installations, audiences, deployment history and permission acceptance. A version may carry ghost_release.plan (the exact signed release JSON string) and ghost_release.signature. Every module keeps its existing branch ref plus an immutable commit pin.

The paired node reads /api/nodes/releases, scoped by its own node token. The installer runs a separate ghost-release-sync user service, verifies a trusted SSH signature, and delegates to the existing assembler. It restarts map consumers after map commit changes, reports installer status, and avoids replaying failed install commands on each poll. The operator publisher UI and real-box deployment remain pending. This is not proof that physical Android execution or the combined launch is complete.


### Administrative deployment controls and source delivery

Plat-admin /device-releases manages physical map and box artifacts using GCR's existing store: publish exact signed release bytes, target named businesses, preview, deploy, offer, update or roll back and inspect node reports. Existing Paperclip Store publishing continues to manage apps/agents/automations. This preserves each backend's current authority; it is not a second orchestration engine. New physical permissions are offered until the business explicitly accepts them, including on first admin installation.

GitHub integration branches contain the repaired code in eight repositories. repositories.lock.json and bootstrap.py fetch exact commits for all twelve repositories into the adjacent directory layout used by the existing imports and MCP launchers. Bootstrap refuses to overwrite dirty or differently pinned checkouts. The assembly scripts/documentation are also included under Paperclip nextgent-assembly/.
