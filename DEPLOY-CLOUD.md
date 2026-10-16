# Deploy full Paperclip server for Jarvis

The Vercel project currently serves only the UI. Jarvis (`nextgent`) needs a live Paperclip API at `PAPERCLIP_URL`.

## Fastest path: Docker + external Postgres

1. Create a Postgres database (Neon, Supabase, or DigitalOcean Managed Database).
   Copy the connection string as `DATABASE_URL`.

2. Generate secrets:
   ```bash
   openssl rand -base64 32   # BETTER_AUTH_SECRET
   openssl rand -base64 32   # PAPERCLIP_TOOL_ACTION_SIGNING_SECRET
   ```

3. Deploy the container (Railway, Fly.io, Render, DigitalOcean App Platform, or a droplet):
   ```bash
   # Example with docker-compose
   DATABASE_URL="postgres://..." \
   BETTER_AUTH_SECRET="..." \
   PAPERCLIP_TOOL_ACTION_SIGNING_SECRET="..." \
   docker compose -f docker-compose.cloud.yml up -d
   ```

   Or use the root `Dockerfile` directly (`--target production`).

4. Once the service is up, note the public URL (e.g. `https://paperclip-xxxx.up.railway.app`).

5. In the NEXT GENT app, set:
   ```
   PAPERCLIP_URL=https://your-paperclip-host
   # PAPERCLIP_API_KEY=   # only if the instance requires it
   ```

6. In the customer portal Settings, link the NEXT GENT company to the Paperclip company.

Jarvis can then pull agents/issues/routines and hand work via `/api/agents/{id}/heartbeat/invoke` and `/api/companies/{id}/issues`.

## Local test

```bash
DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip \
BETTER_AUTH_SECRET=dev \
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=dev \
docker compose -f docker-compose.cloud.yml up
```

Then set `PAPERCLIP_URL=http://localhost:3100` in nextgent.
