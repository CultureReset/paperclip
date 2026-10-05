# NEXT GENT build status (2026-10-05)

Branch everywhere: `claude/agent-ecosystem-architecture-nzexu1`. Nothing applied to live databases, nothing deployed, main untouched.

| Step | State | Proof |
|---|---|---|
| 1 Spec from ChatGPT's words | done | `SPEC.md` (+ §12 addendum from the consolidation doc) |
| 2 Dangerous bugs, all repos | done | each repo's suite green; see per-repo heads below |
| 3 Paperclip store = install authority; `entity_modules` projection; one renderer | done | `proof3/run.sh`: two real servers over HTTP, 10 steps, all pass; re-run by coordinator |
| 4 Business bridge: no business copies in Paperclip | done | `proof4/run.sh`: 5 steps, 56 assertions, all pass; re-run by coordinator |
| 5 App engine folded into the store | building (plumbing: gcr, App-build, Paperclip) | |
| 6 Devices in Paperclip, relay unchanged, receipts restored | pending | |
| 7 Move automations / prices / agents / platform email to Paperclip | pending | |
| 8 Feature work (ten screens dynamic, Dashboards-users under Business, Admin-dashboard under Business Data, public page assembly, templates, Twilio out, sweep) | pending | |

Heads: paperclip 5dc2531 · gcr-api-clean c8aa85a · Play-user 9e5dbf0 · Plat-admin a30b076 · App-build- a01299a · gcr-unified 88d28d3 · Boxes 271a7cd · nextgent-platform e038421 · nextgent-maps 4025155 · nextgent-ghost-image unchanged.

Open on the owner: npm token + license for publishing `@nextgent/app-engine` (DECISIONS #23, #27). Everything else decided in `DECISIONS.md` (31 entries), each overrulable.

Deploy-time must-dos collected so far (gcr): set `NEXTGENT_SECRETS_KEY`, `NEXTGENT_SESSION_SECRET`, `VERIFY_CODE_SECRET`, `CRON_SECRET`, `API_BASE_URL`; apply per `sql/ORDER.md`: `nextgent_intake.sql` (re-run), `nextgent_scheduler_state.sql`, `nextgent_stripe_events.sql`, `nextgent_entity_modules.sql`, `nextgent_update_links.sql`. Paperclip: migration 0292; the same signing secret on both sides. Known caveat: existing sealed secrets encrypted under the old derived key need `NEXTGENT_SECRETS_KEY` to equal the previous derived value or re-sealing.
