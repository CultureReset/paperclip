# NEXT GENT

NEXT GENT is this Paperclip fork. Paperclip is the product: the dashboard every
customer logs into, the company and work records, the agents. Everything else
(Jarvis, Hermes, OpenClaw, OpenBot, Ghost/Android) plugs in underneath it as a
worker or an executor. Nothing else holds business state.

```
customer ──► https://app.<your-domain> ──► NEXT GENT server (this repo, Docker)
                                             │  dashboard + API + agent runner
                                             ▼
                                     Supabase "Saas" (Postgres only)
```

## Accounts

Each person signs up with email and password and gets their own workspace
(`PAPERCLIP_SELF_SERVE_COMPANIES=true`). They see only their own workspace,
agents, tasks and results. Logins are Paperclip's own (Better Auth); the user
table lives in the same database. Supabase Auth is not used.

## Database

Supabase project **Saas**, ref `mtjxlyncokedaduvzgmp`, us-east-2, organization
"CYBER CHECK". It is used as plain Postgres. The server creates and upgrades
every table itself on start (`PAPERCLIP_MIGRATION_AUTO_APPLY=true`), so there
is nothing to run in the Supabase SQL editor.

The other projects in that organization (`cyber check`, `gulf coast radar`,
`launch gcr`, ...) belong to the old CyberCheck/GCR product. NEXT GENT does not
use them, nor `gcr-api-clean`, `Dashboards-users-` or `Admin-dashboard-main`.

## Run it

Any machine with Docker:

```bash
cd nextgent
cp .env.example .env      # database string, public URL, three secrets
docker compose up -d --build
```

Then put HTTPS in front of port 3100 and point your domain at it.

**Make yourself the owner (once).** A new install has no platform owner until
someone claims it. Sign up in the browser first, then on the server:

```bash
docker compose exec -w /app server \
  node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts auth bootstrap-ceo
```

It prints a one-time link (valid 72 hours). Open it while signed in and that
account becomes the instance admin. Do this before you share the URL: until an
owner exists, anyone who signs up could claim it.

It cannot run on Vercel. The server is a long-running process: it schedules
agents on timers, starts them as child processes, streams live updates over
WebSockets and keeps run logs on disk. Serverless functions do none of that.
Any always-on host works (a VPS, Railway, Render, Fly, a Ghost box).

## Verified

Run on 2026-10-01 against an empty Postgres with these exact settings:

- the server built the full schema from an empty database on first start;
- two accounts signed up, each created a workspace and each saw only its own;
- one account reading, listing agents in, or creating a task in the other's
  workspace got 403 every time; no session got 403;
- in single-user mode, a task assigned to an agent started the agent, the
  agent finished it and wrote its result back, and companies, agents, tasks,
  comments and run history all survived server restarts;
- the production Docker image built, started against an empty database,
  applied all 283 migrations, served the dashboard, and repeated the two-account
  sign-up and isolation result above;
- the owner command above, run inside that container, made the signed-in
  account `instance_admin` and moved the install from `bootstrap_pending` to
  `ready`.

Not yet verified: a connection to the real Saas database (that needs its
password, which only you hold).

## Build order from here

Each step is done when it works end to end, not when the service starts.

1. **Foundation** — this directory. Done, pending a host.
2. **Hermes** — run Hermes with its API server, add it as a `hermes_gateway`
   agent ("Researcher"). The adapter is built in; see
   `doc/HERMES_GATEWAY_ONBOARDING.md`. Needs an AI provider key.
3. **LiteLLM** — one model gateway; agents ask for `fast` / `reasoning` /
   `coding`, not vendor names.
4. **Jarvis** — the CEO agent in each workspace, plus a small
   `paperclip-mcp` so it can list agents, create and assign tasks, and read
   results. Proof: "have the researcher look into X" goes
   Jarvis → Paperclip → Hermes → Paperclip → you, reliably.
5. **Approvals for real-world actions** — extend Paperclip's existing
   Approvals page to "send this text?", "post this?".
6. **Ghost / Android** — `nextgent-platform` (androidd, Maps, policy,
   receipts) as a worker behind the HTTP adapter.
7. **OpenBot** (agent computer), **OpenClaw** (channels; adapter built in),
   **n8n** (scheduled workflows).
8. **Store** — a Store page in this UI that installs an agent + its tools +
   permissions from a manifest, and Disable that pauses without deleting.
