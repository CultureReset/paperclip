# Review 8/8: nextgent-platform, nextgent-maps, nextgent-ghost-image (read-only, every line)
Tests: platform 111 pass, ruff clean; maps 9 pass, validate_maps passes. ghost-image: no changes.
Correction: platform branch is 26 commits beyond main (23 = control-plane line, 1 README, 2 computer-side), not "75" (75 counted the whole history).
## Spec deviations
D1 High: receipts for approved (ASK) actions only reach Paperclip if the cloud asks for them (link.py:29-33); commit 8b01009 dropped the push; old default ledger push removed (config.py:47); local MCP receipts never travel.
D2 High: device↔business association stored in cyber check (ghost_nodes.entity_slug via gcr nodes.js /pair/*), spec says Paperclip holds it referencing the relay node; relay extended with pairing routes.
D3 High: new WebSocket transport (link.py) to a relay /connect that doesn't exist — job 4 says no new transport.
D4 High: 7 paperclip_* tools + Paperclip API key on the local box (mcp_server.py, paperclip.py); agent can pass company_id (breaks "no company from the agent"); Jarvis wired to local MCP vs README "agents in cloud".
D5 Medium: docs claim App Maps ship pinned/signed via ghost-image and installer uses this branch — false: ghost.json installs whole nextgent-maps at branch claude/repo-code-analysis-y4n1k7, unpinned, unsigned; new pairing/link code not deployed by installer; ghost.json still installs Jarvis on box.
## Owner-rule
Stacking: ledger sink kept; WS beside poll; local Paperclip client beside cloud bridge. Dropped: default receipt push. Hard-coding: paperclip.py:21 localhost URL default; Google Messages package/selector defaults. Decisions made: Phone Agent/DENY call.answer (docs/CALLS.md), 20-pass release gate, WS frame protocol, unsigned self-attested map results gate release.
## Bugs
.env.example inline # comments break systemd EnvironmentFile (token = comment text; transport crash; int parse). ~ not expanded in NEXTGENT_NODE_TOKEN_FILE. Bare "yes" approves the single pending action (pre-existing); GET /approvals no token check (pre-existing). Paperclip client path params unencoded (issue_id/company_id injection). Tight reconnect/pair loops. save_token mode/permissions. Local evidence paths leak to cloud. Test gaps: re-pair-on-401, 4 of 7 MCP tools, tests depend on port 8765 free, WS test against non-existent endpoint.
## OPEN (owner)
H1 Jarvis local vs cloud (code does both). H2 untouched. H3 untouched. H4 module naming kept.
