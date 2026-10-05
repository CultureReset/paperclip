# NEXT GENT

This repository is the platform side of NEXT GENT. Paperclip owns platform
state (accounts, companies, agents, tasks, routines, approvals, activity,
costs, the store, installs, permissions). gcr-api-clean and the `cyber check`
database own business state (the business, its data, bookings, reviews, menus
and the rest); the bridge in `nextgent/README.md` and `docs/api/nextgent.md`
connects the two. Do not build another control plane.

## Product flow

1. A customer signs in and creates an organization.
2. The onboarding flow creates **Jarvis**, the customer's primary agent.
3. The customer opens **Jarvis** and states the outcome they want.
4. Jarvis uses Paperclip's existing task, delegation, approval, budget,
   artifact, skill, app, MCP, Hermes, and OpenClaw systems to coordinate it.
5. Results, decisions, costs, and audit history stay inside the same workspace.

## Run locally

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3100`. Development uses the embedded database when
`DATABASE_URL` is unset.

## Production

Run the existing Paperclip Node server and React build on a persistent
container host with PostgreSQL and authenticated deployment mode. The product
does not require a second orchestration service or a separate Jarvis backend.

Internal package names, API contracts, database identifiers, and adapter names
remain Paperclip-compatible so upstream updates can still be merged.
