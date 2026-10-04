# NEXT GENT settings: every environment variable

This is one table for every service. Example values show the format only.
None of them is real. Real values go in the files and dashboards named in
**Where it's set**, never in git.

**Where each service reads its settings**

| Service | File or place |
| --- | --- |
| Compose (this folder) | `deploy/digitalocean/.env` (from `.env.example`). It holds the domains, images, sizes and shared secrets. `docker-compose.yml` passes them into the services. |
| Paperclip | `env/paperclip.env` (copy of `nextgent/.env.example`). Compose overrides the values marked *compose*. |
| LiteLLM | `env/litellm.env` (from `env/litellm.env.example`) and `litellm/config.yaml` |
| gcr-api-clean on the Droplet | `env/gcr-api.env` (copy of gcr-api-clean's `.env.example`). Compose overrides the values marked *compose*. |
| gcr-api-clean on Vercel (decision 5 option B) | Vercel project → Settings → Environment Variables. Use the same values as `env/gcr-api.env`, except `ALWAYS_ON`. |
| Play-user, Plat-admin, App-build-, gcr-unified | Each Vercel project → Settings → Environment Variables. `VITE_*` and `NEXT_PUBLIC_*` are build-time: redeploy after changing them. |
| Workers | `workers/businesses/<id>.env` and `workers/edge.env` (see `workers/WORKERS.md`) |

**Labels in the Required column**

| Label | Meaning |
| --- | --- |
| **Required** | The service does not start or the feature is off without it |
| **Launch** | Starts without it, but must be set before customers use it. These are the items from FOLLOWUPS.md. |
| Optional | Has a working default |
| *compose* | Set by `docker-compose.yml`. Don't set it yourself. |
| Legacy | Older paths. Only set it if you still use them. |
| Dev | Local development only |

**Shared values: the same value goes in two places.** Compose injects the
first four from `.env`. On Vercel you paste the same value yourself.

| Value | Where it goes |
| --- | --- |
| `NEXTGENT_SERVICE_SECRET` | Paperclip and gcr-api-clean, including gcr-api-clean on Vercel |
| `LITELLM_MASTER_KEY` | LiteLLM, Paperclip and gcr-api-clean |
| `PAPERCLIP_PUBLIC_URL` | Paperclip's own address. In gcr-api-clean it is `PAPERCLIP_ISSUER`, and `PAPERCLIP_JWKS_URL` is that address + `/.well-known/jwks.json`. |
| `GCR_API_URL` | Paperclip, Play-user and Plat-admin |
| Play-user's and Plat-admin's addresses | Paperclip's `PAPERCLIP_APP_ORIGINS`, and gcr-api-clean's `CORS_ORIGINS` when a browser calls it directly |
| `OWNER_APP_URL` | Paperclip and gcr-api-clean |

**Renamed settings.** If an old deployment had the old name, set the new one:

| Old name | New name |
| --- | --- |
| `CLAIM_CODE_SECRET` | `VERIFY_CODE_SECRET` |
| `CLAIM_CODE_DIGITS` | `VERIFY_CODE_DIGITS` |
| `CLAIM_CODE_TTL_MINUTES` | `VERIFY_CODE_TTL_MINUTES` |
| `CLAIM_MAX_ATTEMPTS` | `VERIFY_MAX_ATTEMPTS` |
| `TWILIO_VERIFY_SERVICE_SID` | Retired. Remove it. |

**Brand name.** The brand name has two settings with different names:
gcr-api-clean `PLATFORM_NAME` and Play-user `VITE_BRAND_NAME`. Set both to
the same text. Plat-admin's `VITE_APP_NAME` and `VITE_APP_SHORT_NAME` are the
console's own title.

**Generate secrets.** Use these commands:

| Kind of value | Command |
| --- | --- |
| Hex secret | `openssl rand -hex 32` |
| LiteLLM key | `echo "sk-$(openssl rand -hex 32)"` |
| Ed25519 private key for `NEXTGENT_JWT_PRIVATE_KEY` | `openssl genpkey -algorithm ed25519 -out nextgent-jwt.pem`, then `awk 'NF{printf "%s\\n",$0}' nextgent-jwt.pem` gives one line with `\n` in it |

For the key: paste the PEM as is if your secret store keeps multi-line
values. Otherwise paste the one-line form with `\n`, which Paperclip
accepts. Keep the `.pem` file in your password manager and delete it from
the Droplet.

## The table

| Variable | Service | Required | What it does | Where it's set | Example format |
| --- | --- | --- | --- | --- | --- |
| `PAPERCLIP_DOMAIN` | Compose | **Required** | Paperclip's hostname. Caddy gets its certificate; Paperclip's public URL, token issuer and JWKS URL are built from it | Your DNS (DigitalOcean → Networking → Domains, or your registrar) | `app.example.com` |
| `GCR_API_DOMAIN` | Compose | **Required** | gcr-api-clean's hostname on the Droplet: Telnyx, Stripe, Google, intake webhooks point here | Your DNS | `api.example.com` |
| `LITELLM_DOMAIN` | Compose | Optional. **Decision needed:** publish LiteLLM or keep it private | LiteLLM's hostname. Only used if you enable `caddy-sites/litellm-public.caddy` (for workers on other hosts, or gcr-api-clean on Vercel) | Your DNS | `llm.example.com` |
| `ACME_EMAIL` | Compose | **Required** | Let's Encrypt account email (expiry warnings) | An ops mailbox you read | `ops@example.com` |
| `LITELLM_ADMIN_CIDRS` | Compose | Only if LiteLLM is published | Addresses allowed to open LiteLLM's admin UI through Caddy | Your office/home IP | `203.0.113.10/32` |
| `PAPERCLIP_IMAGE` | Compose | **Required** | Tag the Paperclip build gets (or a registry digest to pull instead) | You choose | `nextgent/paperclip:2026-10-04` |
| `GCR_API_IMAGE` | Compose | **Required** | Tag the gcr-api-clean build gets | You choose | `nextgent/gcr-api-clean:2026-10-04` |
| `GCR_API_NODE_IMAGE` | Compose | **Required** | Node base image for gcr-api-clean | Docker Hub `node` tags | `node:24-bookworm-slim` |
| `GCR_API_CLEAN_SRC` | Compose | **Required** | Path to the clean gcr-api-clean checkout on the Droplet | Where you cloned it | `../../../gcr-api-clean` |
| `LITELLM_IMAGE` | Compose | **Required** | LiteLLM proxy image, pinned | LiteLLM releases (ghcr.io/berriai/litellm) | `ghcr.io/berriai/litellm:main-v1.x.y-stable` |
| `CADDY_IMAGE` | Compose | **Required** | Caddy image | Docker Hub `caddy` | `caddy:2-alpine` |
| `CRON_IMAGE` | Compose | **Required** | Image for the cron sidecar (`gcr-crons` profile) | Docker Hub `alpine` | `alpine:3` |
| `PAPERCLIP_MEM_LIMIT` / `PAPERCLIP_CPUS` | Compose | **Required** | Container limits for Paperclip (agents run inside it) | Your Droplet size | `4g` / `2.0` |
| `GCR_API_MEM_LIMIT` / `GCR_API_CPUS` | Compose | **Required** | Container limits for gcr-api-clean | Your Droplet size | `1g` / `1.0` |
| `LITELLM_MEM_LIMIT` / `LITELLM_CPUS` | Compose | **Required** | Container limits for LiteLLM | Your Droplet size | `1g` / `1.0` |
| `CADDY_MEM_LIMIT` / `CRON_MEM_LIMIT` | Compose | **Required** | Container limits | Your Droplet size | `256m` / `64m` |
| `GCR_API_PORT` | Compose | **Required** | gcr-api-clean's port inside the compose network (becomes its `PORT`) | You choose | `3000` |
| `LITELLM_PORT` | Compose | **Required** | LiteLLM's port inside the compose network | You choose | `4000` |
| `PAPERCLIP_TRUST_PROXY` | Compose → Paperclip `TRUST_PROXY` | **Required** | Trust one proxy hop (Caddy) for client IPs and rate limits | Fixed by this layout | `1` |
| `NEXTGENT_SERVICE_SECRET` | Compose → Paperclip and gcr-api-clean | **Required** | HMAC for signed calls both ways (CONTRACT §3). gcr-api-clean also derives its stored-secret key and phone-code key from it unless `NEXTGENT_SECRETS_KEY` / `VERIFY_CODE_SECRET` are set. Changing it breaks stored secrets | `openssl rand -hex 32`; also paste into gcr-api-clean on Vercel | 64 hex chars |
| `LITELLM_MASTER_KEY` | Compose → LiteLLM, Paperclip, gcr-api-clean | **Required** | LiteLLM admin key: per-company keys (`/key/generate`), spend reads | `echo "sk-$(openssl rand -hex 32)"` | `sk-<64 hex>` |
| `CRON_SECRET` | Compose → gcr-api-clean, cron sidecar | **Required** | Bearer secret on gcr-api-clean's cron routes; without it they're open to anyone | `openssl rand -hex 32`; same value in Vercel if crons stay there | 64 hex chars |
| `DATABASE_URL` | Paperclip | **Required** | The Supabase **Saas** database (Paperclip's only database) | Supabase → Saas project → Connect → **Session pooler** (port 5432, not 6543) | `postgres://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require` |
| `PAPERCLIP_PUBLIC_URL` | Paperclip | *compose* | Exact public address; issuer (`iss`) of business tokens | `https://${PAPERCLIP_DOMAIN}` | `https://app.example.com` |
| `BETTER_AUTH_SECRET` | Paperclip | **Required** | Signs sign-in sessions. Changing it logs everyone out | `openssl rand -hex 32` | 64 hex chars |
| `PAPERCLIP_AGENT_JWT_SECRET` | Paperclip | **Required** | Signs agent run tokens. Changing it breaks runs in flight | `openssl rand -hex 32` | 64 hex chars |
| `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` | Paperclip | **Required** | Signs tool-action approvals | `openssl rand -hex 32` | 64 hex chars |
| `PAPERCLIP_SECRETS_MASTER_KEY` | Paperclip | Optional. **Decision needed:** key in env or key file in the volume | Key that encrypts company secrets (e.g. computer MCP keys). If unset, a key file is created in the `nextgent-data` volume, and losing that volume without a backup loses every stored secret. If set, the key lives in your secret store | `openssl rand -hex 32`; keep a copy offline | 64 hex chars |
| `PAPERCLIP_AUTH_DISABLE_SIGN_UP` | Paperclip | Optional | `true` closes sign-ups (invites only) | Your choice | `false` |
| `PAPERCLIP_APP_ORIGINS` | Paperclip | **Launch** | Separate front ends allowed to sign in (cookies, CSRF), comma-separated | Play-user, Plat-admin and App-build- production URLs | `https://owner.example.com,https://admin.example.com,https://build.example.com` |
| `PAPERCLIP_DEPLOYMENT_MODE` / `PAPERCLIP_DEPLOYMENT_EXPOSURE` / `PAPERCLIP_SELF_SERVE_COMPANIES` / `SERVE_UI` | Paperclip | *compose* (from `nextgent/docker-compose.yml`) | `authenticated`, `public`, `true`, `true` | Fixed for this product | — |
| `PAPERCLIP_MIGRATION_AUTO_APPLY` / `PAPERCLIP_MIGRATION_PROMPT` | Paperclip | *compose* | `false` / `never`: the server won't migrate on start; it refuses a stale schema. Migrations run once per release (`--profile release`) | Fixed here | — |
| `PORT` / `HOST` | Paperclip | Optional (image default) | `3100` / `0.0.0.0` | Image default | `3100` |
| `TRUST_PROXY` | Paperclip | *compose* | See `PAPERCLIP_TRUST_PROXY` | — | `1` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `XAI_API_KEY` | Paperclip | Dev / fallback | Server-wide AI key used only when LiteLLM is unset. In production leave these empty: models go through LiteLLM | Provider dashboards | `sk-ant-…` |
| `GCR_API_URL` | Paperclip | *compose* | gcr-api-clean base URL for signed `/api/nextgent/*` calls and the business-data plugin | `https://${GCR_API_DOMAIN}` | `https://api.example.com` |
| `NEXTGENT_SERVICE_SECRET` | Paperclip | *compose* | See Compose row | — | — |
| `NEXTGENT_JWT_PRIVATE_KEY` | Paperclip | **Required** | Signs the 5-minute business tokens screens send to gcr-api-clean; public half at `/.well-known/jwks.json`. Unset, a throwaway key is made at each start and tokens stop verifying after a restart | `openssl genpkey -algorithm ed25519` (see above) | `-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----` |
| `NEXTGENT_BUSINESS_TOKEN_TTL_SECONDS` | Paperclip | Optional | Business token lifetime, max 300 | — | `300` |
| `LITELLM_URL` | Paperclip | *compose* | LiteLLM inside the compose network | `http://litellm:${LITELLM_PORT}` | `http://litellm:4000` |
| `LITELLM_MASTER_KEY` | Paperclip | *compose* | See Compose row | — | — |
| `LITELLM_COMPANY_BUDGET` | Paperclip | **Launch** | Budget on each company's LiteLLM key (LiteLLM units, USD) | Your plans | `25` |
| `LITELLM_BUDGET_DURATION` | Paperclip | **Launch** | Budget window | Your plans | `30d` |
| `NEXTGENT_ASSISTANT_NAME` | Paperclip | **Launch** | Name of the assistant (Jarvis) made for every new company; unset = none made | Your product copy | `Jarvis` |
| `NEXTGENT_ASSISTANT_ADAPTER_TYPE` | Paperclip | Optional | Its adapter; else `PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE` | Adapter list in Paperclip | `hermes_gateway` |
| `NEXTGENT_ASSISTANT_INSTRUCTIONS_FILE` | Paperclip | Optional | Path (inside the container) to its starting AGENTS.md | A file in the `nextgent-data` volume | `/paperclip/assistant/AGENTS.md` |
| `PAPERCLIP_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE` | Paperclip | Optional | Default adapter for catalog-created agents | Adapter list | `claude_local` |
| `NEXTGENT_PLATFORM_COMPANY_ID` | Paperclip | **Launch** | NEXT GENT's own company; receives concierge conversations | Paperclip → your company's id (after you create it) | UUID |
| `NEXTGENT_STORE_PRICE_MODELS` | Paperclip | **Launch** | Price models shown in the admin store editor | Your pricing decision | `flat,usage` |
| `NEXTGENT_STORE_PRICE_INTERVALS` | Paperclip | **Launch** | Billing intervals shown | Your pricing decision | `month,year` |
| `NEXTGENT_STORE_CURRENCY` | Paperclip | **Launch** | Currency when a price is set without one | Your Stripe account currency | `usd` |
| `OWNER_APP_URL` | Paperclip | **Launch** | Owner app address; invite emails link to `OWNER_APP_URL/#/invite/<token>` | Play-user's production URL | `https://owner.example.com` |
| `PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST` | Paperclip | Optional | Lets HTTP adapters call private (VPC) origins | Only if workers are reached over the VPC by private IP | `http://10.10.0.5:8642` |
| `PAPERCLIP_ID_CONNECTOR_BASE_URL` / `_ENVIRONMENT` / `_INSTANCE_ID` / `_SIGN_PRIVATE_KEY` / `_SEAL_PRIVATE_KEY` | Paperclip | Optional | Paperclip ID Gmail OAuth broker | Paperclip ID enrolment | — |
| `PAPERCLIP_WORKSPACE_GIT_SCAN_CONCURRENCY` / `_QUEUE_CAPACITY` / `_TIMEOUT_MS` / `_CACHE_TTL_MS` | Paperclip | Optional | Limits on workspace git scans | — | `2` / `32` / `8000` / `10000` |
| `DISCORD_WEBHOOK_URL` | Paperclip (script) | Optional | Daily merge digest script only | Discord channel settings | `https://discord.com/api/webhooks/…` |
| `DATABASE_URL` | LiteLLM | **Required** | LiteLLM's own tables (keys, budgets, spend). **Decision needed:** where they live | Option 1: the Saas session pooler with its own schema (`&schema=litellm`). Option 2: a separate database | `postgresql://…:5432/postgres?schema=litellm&sslmode=require` |
| `LITELLM_MASTER_KEY` | LiteLLM | *compose* | See Compose row | — | — |
| `LITELLM_SALT_KEY` | LiteLLM | **Required** | Encrypts credentials LiteLLM stores; never change after first start | `echo "sk-$(openssl rand -hex 32)"` | `sk-<64 hex>` |
| `UI_USERNAME` / `UI_PASSWORD` | LiteLLM | **Required** | Admin UI login | You choose; password manager | — |
| `LITELLM_MODEL_FAST` / `LITELLM_MODEL_REASONING` / `LITELLM_MODEL_CODING` | LiteLLM | **Required** | Which real model each tier (`fast`, `reasoning`, `coding`) calls | Your model choice, LiteLLM provider naming | `<provider>/<model-id>` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` | LiteLLM | **Required** (the ones your tiers use) | Provider keys; only LiteLLM holds them | Provider dashboards | `sk-…` |
| `GCR_SUPABASE_URL` | gcr-api-clean | **Required** | The **cyber check** project (ref `mkepugvdlktfsossumox`) and no other; process exits without it | Supabase → cyber check → Project Settings → API | `https://<ref>.supabase.co` |
| `GCR_SUPABASE_SERVICE_KEY` | gcr-api-clean | **Required** | Service-role key for cyber check; only gcr-api-clean holds it | Same page, service_role key | `eyJ…` or `sb_secret_…` |
| `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `GCR_SUPABASE_KEY` | gcr-api-clean | Legacy | Fallback names some routes still read. Leave unset when the two above are set | — | — |
| `JWT_SECRET` | gcr-api-clean | **Required** | Signs admin/legacy logins; `/api/admin` isn't mounted without it | `openssl rand -hex 32` | 64 hex chars |
| `ADMIN_SECRET` | gcr-api-clean | Optional | Admin API key accepted by `routes/admin.js` | `openssl rand -hex 32` | 64 hex chars |
| `CORS_ORIGINS` | gcr-api-clean | **Launch** | Browser origins allowed to call it directly (added to the built-in list), comma-separated | gcr-unified, Plat-admin, Play-user URLs that call it from the browser | `https://example.com,https://admin.example.com` |
| `CRON_SECRET` | gcr-api-clean | *compose* | See Compose row | — | — |
| `PORT` | gcr-api-clean | *compose* | Listen port | `${GCR_API_PORT}` | `3000` |
| `NODE_ENV` | gcr-api-clean | Optional | Image sets `production` | — | `production` |
| `ALWAYS_ON` | gcr-api-clean | *compose* (`true` on the Droplet) | Runs `lib/scheduler.js` in-process (automations, waits, completed bookings, Google push, LiteLLM usage, closing quiet texts). **Never `true` on Vercel** | — | `true` |
| `SCHEDULER_AUTOMATIONS_SECONDS` / `SCHEDULER_GOOGLE_PUSH_SECONDS` / `SCHEDULER_LITELLM_USAGE_SECONDS` / `SCHEDULER_CONVERSATIONS_SECONDS` | gcr-api-clean | Optional | Scheduler intervals | — | `60` / `60` / `3600` / `60` |
| `API_BASE_URL` | gcr-api-clean | *compose* (Droplet) / **Launch** (Vercel) | Public origin; Telnyx "say" webhook default and links. On Vercel set it to the **Droplet** origin so spoken calls are driven by the always-on host | `https://${GCR_API_DOMAIN}` | `https://api.example.com` |
| `APP_URL` / `FROM_EMAIL` / `FROM_NAME` | gcr-api-clean | Legacy | In the example file but read by no route | — | — |
| `PUBLIC_API_BASE_URL` | gcr-api-clean | **Launch** | Public API base in dashboard links; code falls back to an old GCR address | Same as `API_BASE_URL` | `https://api.example.com` |
| `PAPERCLIP_ISSUER` | gcr-api-clean | *compose* / **Required** on Vercel | Expected `iss` of business tokens = Paperclip's `PAPERCLIP_PUBLIC_URL` | `https://${PAPERCLIP_DOMAIN}` | `https://app.example.com` |
| `PAPERCLIP_JWKS_URL` | gcr-api-clean | *compose* / **Required** on Vercel | Paperclip's public keys | `https://${PAPERCLIP_DOMAIN}/.well-known/jwks.json` | — |
| `PAPERCLIP_API_URL` | gcr-api-clean | *compose* / **Required** on Vercel | Where receipts and conversations are posted (signed) | `https://${PAPERCLIP_DOMAIN}` | — |
| `PAPERCLIP_JWKS_CACHE_SECONDS` / `PAPERCLIP_JWKS_MIN_REFETCH_SECONDS` / `PAPERCLIP_JWT_CLOCK_SKEW_SECONDS` | gcr-api-clean | Optional | JWKS cache tuning | — | `600` / `30` / `30` |
| `NEXTGENT_SERVICE_SECRET` | gcr-api-clean | *compose* / **Required** on Vercel | See Compose row | — | — |
| `NEXTGENT_SECRETS_KEY` | gcr-api-clean | Optional | Separate key for stored secrets (routine webhooks, Google tokens); defaults to the service secret. Changing it makes stored ones unreadable | `openssl rand -hex 32` | 64 hex chars |
| `BUSINESS_RESOURCE_TABLES` | gcr-api-clean | Optional | JSON map pinning a table to a permission resource | — | `{"daily_specials":"menu"}` |
| `INTAKE_EMAIL_DOMAIN` | gcr-api-clean | **Launch** | Domain of each business's forwarding address; unset = no address issued | The inbound-parse domain you set up (STEPS.md step 10) | `parse.example.com` |
| `INTAKE_EMAIL_PREFIX` | gcr-api-clean | Optional | Part before the slug; default is the prefix every existing address already uses | — | `<prefix>-` |
| `EMAIL_WEBHOOK_SECRET` | gcr-api-clean | **Launch** if `/api/webhooks/email` is used | Header secret (`x-webhook-secret`) on the email webhook | `openssl rand -hex 32`; same value in the sender's webhook settings | 64 hex chars |
| `EXPORT_BUCKET` | gcr-api-clean | **Launch** | Private Supabase Storage bucket for teardown exports | Supabase → cyber check → Storage (create a private bucket) | `exports` |
| `EXPORT_URL_TTL_SECONDS` | gcr-api-clean | Optional | Export link lifetime | — | `604800` |
| `TELEPHONY_PROVIDER` | gcr-api-clean | **Launch** | `telnyx` (default) or `twilio` (legacy) | Fixed: `telnyx` | `telnyx` |
| `TELNYX_API_KEY` | gcr-api-clean | **Launch** | Telnyx API (send texts, calls, buy numbers) | Telnyx Mission Control → Account settings → API Keys | `KEY0…` |
| `TELNYX_PUBLIC_KEY` | gcr-api-clean | **Launch** | Verifies webhook signatures; unsigned events are refused | Telnyx → Account settings → Public Key | base64 |
| `TELNYX_MESSAGING_PROFILE_ID` | gcr-api-clean | **Launch** | Profile texts go out on (its inbound webhook → `/api/telephony/telnyx/messaging`) | Telnyx → Messaging → Messaging Profiles | UUID |
| `TELNYX_CONNECTION_ID` | gcr-api-clean | **Launch** | Call Control application for voice (webhook → `/api/telephony/telnyx/voice`) | Telnyx → Voice → Programmable Voice / Call Control apps | numeric id |
| `PLATFORM_NUMBER` | gcr-api-clean | **Launch** | Registered number for codes and owner notifications | Telnyx → Numbers (with 10DLC/toll-free registration done) | `+15550100000` |
| `CONCIERGE_NUMBER` | gcr-api-clean | **Launch** | Concierge's number; calls/texts to it get the concierge | Telnyx → Numbers | `+15550100001` |
| `TELNYX_TTS_VOICE` / `TELNYX_TTS_LANGUAGE` / `TELEPHONY_SAY_REPEATS` / `TELNYX_SAY_WEBHOOK_URL` / `TELNYX_WEBHOOK_TOLERANCE_SECONDS` / `TELNYX_API_URL` | gcr-api-clean | Optional | Voice, language, repeats, say-webhook override (set to the Droplet's `/api/telephony/telnyx/say` on Vercel), signature tolerance, API host override | — | `female` / `en-US` / `2` / — / `300` / — |
| `TELNYX_TRANSCRIPTION_ENGINE` / `TELNYX_TRANSCRIPTION_LANGUAGE` | gcr-api-clean | Optional | Speech recognition for live calls | Telnyx docs | — |
| `TELEPHONY_DEFAULT_COUNTRY_CODE` | gcr-api-clean | **Launch** | Country code for numbers typed without one; also replace the placeholder in `sql/nextgent_consent_fold.sql` with it before running that file | Your market | `1` |
| `TELEPHONY_NUMBER_COUNTRY` | gcr-api-clean | Optional | Country numbers are bought in | Your market | `US` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` / `TWILIO_WEBHOOK_BASE_URL` / `TWILIO_API_URL` / `TWILIO_LOOKUP_URL` | gcr-api-clean | Legacy | Only when `TELEPHONY_PROVIDER=twilio` | Twilio console | — |
| `TWILIO_VERIFY_SERVICE_SID` | gcr-api-clean | **Retired** | Remove | — | — |
| `VERIFY_CODE_SECRET` | gcr-api-clean | Optional (renamed from `CLAIM_CODE_SECRET`) | HMAC for stored phone codes; defaults to the service secret | `openssl rand -hex 32` | 64 hex chars |
| `VERIFY_CODE_DIGITS` / `VERIFY_CODE_TTL_MINUTES` / `VERIFY_MAX_ATTEMPTS` | gcr-api-clean | Optional (renamed from `CLAIM_*`) | Code length, lifetime, tries | — | `6` / `10` / `5` |
| `VERIFY_CODE_MESSAGE` | gcr-api-clean | Optional | Code text with `{code}`, `{minutes}` | Your copy | `Your code is {code}…` |
| `CLAIM_MAX_STARTS_PER_HOUR` | gcr-api-clean | Optional | Claim codes per company/listing per hour | — | `5` |
| `SMS_QR_KEYWORD` | gcr-api-clean | Optional | Word a QR-code text starts with | Your campaign | — |
| `LINKS_BASE_URL` | gcr-api-clean | **Launch** | Where the update-link editor and live-photo review page live; unset = live-photo review texts aren't sent | gcr-unified's production URL (where `review.html` is served) | `https://example.com` |
| `OWNER_APP_URL` | gcr-api-clean | **Launch** | Owner app; notification links join to it; checkout returns here | Play-user's production URL | `https://owner.example.com` |
| `OWNER_REVIEW_PATH` / `OWNER_BILLING_PATH` / `OWNER_MESSAGES_PATH` / `OWNER_AUTOMATIONS_PATH` / `OWNER_GOOGLE_PATH` | gcr-api-clean | **Launch** | Paths inside the owner app that notifications link to | Play-user's routes | `/#/billing` |
| `PLATFORM_ADMIN_EMAIL` | gcr-api-clean | **Launch** | Where claims awaiting review are emailed | Your ops mailbox | `ops@example.com` |
| `PLATFORM_NAME` | gcr-api-clean | **Launch** | Brand name in MCP server info and `{{brand}}` in emails; required by `POST /api/nextgent/email` | Your brand (same text as Play-user `VITE_BRAND_NAME`) | `NEXT GENT` |
| `BREVO_API_KEY` | gcr-api-clean | **Launch** | Sends every platform email | Brevo → SMTP & API → API Keys | `xkeysib-…` |
| `EMAIL_FROM` | gcr-api-clean | **Launch** | Sender address; code falls back to an old CyberCheck address | A sender verified in Brevo → Senders & domains | `hello@example.com` |
| `OWNER_PHONE` / `OWNER_RELAY_MODE` | gcr-api-clean | Optional | Copy platform emails/texts to one phone (relay mode) | — | `+1555…` / `false` |
| `ADMIN_SMS_NUMBER` | gcr-api-clean | Optional | Number texted on some public form submissions | — | `+1555…` |
| `STRIPE_SECRET_KEY` | gcr-api-clean | **Launch** | Platform Stripe account (plans, store items, Phone Agent numbers) | Stripe → Developers → API keys | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | gcr-api-clean | **Launch** | Verifies Stripe events at `/api/stripe/webhook` | Stripe → Developers → Webhooks → that endpoint → Signing secret | `whsec_…` |
| `STRIPE_PUBLISHABLE_KEY` (+ `_LIVE` / `_TEST`) | gcr-api-clean | Optional | Returned to checkout pages | Stripe → API keys | `pk_live_…` |
| `STRIPE_CLIENT_ID` / `STRIPE_CONNECT_REDIRECT_URI` / `STRIPE_KEY_ENCRYPTION_KEY` | gcr-api-clean | Optional | Stripe Connect for businesses taking payments; encryption key for stored Stripe keys | Stripe → Connect settings; `openssl rand -hex 32` | `ca_…` / URL / 64 hex |
| `PLATFORM_FEE_PERCENT` / `SQUARE_PLATFORM_FEE_PERCENT` | gcr-api-clean | Optional | Platform fee on Connect/Square payments | Your pricing | `1` |
| `STRIPE_USAGE_METER_EVENT` | gcr-api-clean | Optional | Stripe Billing meter for AI credits | Stripe → Billing → Meters | `ai_credits` |
| `USAGE_CREDITS_PER_USD` / `USAGE_CREDITS_DIMENSION` | gcr-api-clean | Optional | Credits per dollar of AI spend; usage dimension | Your pricing | `100` / `ai_credits` |
| `PHONE_AGENT_NUMBER_ITEM_KEY` | gcr-api-clean | **Launch** (if selling Phone Agent) | Store item whose price is a Phone Agent number's monthly charge | `store_items.key` you create | `<publisher>-phone-number` |
| `DEFAULT_TIMEZONE` | gcr-api-clean | **Launch** | Time zone for schedules and booking times when none is given | Your market (IANA) | `America/Chicago` |
| `DEFAULT_CURRENCY` | gcr-api-clean | **Launch** | Currency for payments read from email without one | Your market | `usd` |
| `AUTOMATION_WAIT_MAX_MINUTES` / `AUTOMATION_AGENT_TIMEOUT_MS` / `AUTOMATION_RESUME_LIMIT` / `BOOKING_COMPLETE_LIMIT` / `BOOKING_DEFAULT_DURATION_MINUTES` / `AUTOMATION_TICK_LIMIT` | gcr-api-clean | Optional | Automation engine limits | — | — / `10000` / `100` / `200` / — / `200` |
| `OWNER_LIST_LIMIT` / `OWNER_PROFILE_LOCKED_COLUMNS` | gcr-api-clean | Optional | Owner API list size; extra locked profile columns | — | `500` / — |
| `NODE_PAIR_URL` | gcr-api-clean | **Launch** (computers) | Owner-app page a pairing QR opens | Play-user URL + its pairing route | `https://owner.example.com/#/pair` |
| `NODE_REMOTE_URL_TEMPLATE` | gcr-api-clean | **Launch** (computers) | Remote-view link with `{node}` and `{token}` | Play-user remote-view route | `https://owner.example.com/#/remote/{node}?t={token}` |
| `NODE_PAIR_TTL_MINUTES` / `NODE_PAIR_POLL_SECONDS` / `NODE_PAIR_CODE_LENGTH` / `NODE_DEFAULT_NAME` / `NODE_REMOTE_TTL_MINUTES` | gcr-api-clean | Optional | Pairing and remote-view tuning | — | `10` / `5` / `8` / `Computer` / `15` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | gcr-api-clean | **Launch** (Google sync) | OAuth client for Business Profile; routes answer 503 until set | Google Cloud console → APIs & Services → Credentials (Business Profile APIs approved) | `…apps.googleusercontent.com` |
| `GOOGLE_REDIRECT_URI` | gcr-api-clean | **Launch** (Google sync) | OAuth callback; must match the Google client exactly | `https://${GCR_API_DOMAIN}/api/google-business/callback` | — |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | gcr-api-clean | Legacy, keep while needed | Reads Google tokens stored before the switch; remove once every row starts `v1.` | Existing value from the current Vercel project | 64 hex |
| `DASHBOARD_BASE_URL` | gcr-api-clean | Optional | Where Google's callback returns; else `OWNER_APP_URL` | — | — |
| `GOOGLE_EDITS_PER_MINUTE` | gcr-api-clean | **Launch** (Google push) | Per-profile edit limit; unset = nothing pushed | Google's published limit | `10` |
| `GOOGLE_PUSH_MAX_ATTEMPTS` / `GOOGLE_PUSH_RETRY_SECONDS` / `GOOGLE_VERIFY_RECHECK_HOURS` / `GOOGLE_PUSH_ROW_LIMIT` / `GOOGLE_PUSH_BATCH` | gcr-api-clean | Optional | Push tuning | — | `5` / `300` / `24` / `500` / `100` |
| `GOOGLE_MENU_NAME` / `GOOGLE_MENU_DEFAULT_SECTION` / `GOOGLE_POST_LANGUAGE` | gcr-api-clean | Optional | Menu naming and post language on Google | — | `Menu` / `Menu` / `en` |
| `GOOGLE_AUTH_URL` / `GOOGLE_USERINFO_URL` / `GOOGLE_TOKEN_URL` / `GOOGLE_GBP_ACCOUNTS_URL` / `GOOGLE_GBP_INFO_URL` / `GOOGLE_GBP_V4_URL` / `GOOGLE_GBP_VERIFICATIONS_URL` | gcr-api-clean | Optional | API root overrides for tests/proxies only | — | — |
| `GOOGLE_PLACES_API_KEY` | gcr-api-clean | Optional | Places lookups in admin tools | Google Cloud → Credentials (API key, restricted) | `AIza…` |
| `LITELLM_URL` | gcr-api-clean | *compose* (Droplet) / **Launch** on Vercel (needs LiteLLM published) | Gateway for live calls/concierge; unset = single-key fallback without tools (dev only) | — | `http://litellm:4000` |
| `LITELLM_MASTER_KEY` | gcr-api-clean | *compose* / **Launch** on Vercel | Per-company keys for live calls; spend pull | — | — |
| `LITELLM_CONCIERGE_KEY` | gcr-api-clean | **Launch** | NEXT GENT's own LiteLLM key the concierge runs on | LiteLLM admin UI → Virtual Keys → new key (metadata: NEXT GENT company) | `sk-…` |
| `LITELLM_MODEL` / `LITELLM_CONCIERGE_MODEL` | gcr-api-clean | **Launch** / Optional | LiteLLM tier for live answers (and the concierge's, if different) | A tier name from `litellm/config.yaml` | `fast` |
| `LITELLM_USAGE_PULL` | gcr-api-clean | **Launch. Decision needed** (FOLLOWUPS: pick ONE AI-usage billing path) | `true`: the scheduler pulls spend per company key into usage credits. The other path is the signed `POST /api/nextgent/usage`, which Paperclip does not send today (checked in `server/src`). Never both: double billing | Your decision | `true` / `false` |
| `LITELLM_KEY_PAGE_SIZE` / `LITELLM_KEY_MAX_PAGES` | gcr-api-clean | Optional | Spend-pull paging | — | `100` / `50` |
| `CONCIERGE_INSTRUCTIONS` / `CONCIERGE_GREETING` | gcr-api-clean | **Launch** / Optional | Concierge instructions (else `platform_config.concierge_instructions`) and greeting | Your copy, or the concierge agent in NEXT GENT's Paperclip company | text |
| `PHONE_AGENT_DEFAULT_INSTRUCTIONS` / `PHONE_AGENT_GREETING` | gcr-api-clean | Optional | Fallback instructions/greeting for Phone Agents | Your copy | text |
| `SMS_HELP_REPLY` / `LIVE_FALLBACK_REPLY` / `LIVE_SMS_SESSION_MINUTES` / `LIVE_MAX_TOOL_ROUNDS` / `LIVE_MAX_TOKENS` / `LIVE_TOOL_RESULT_CHARS` | gcr-api-clean | Optional (HELP reply **Launch** for carrier compliance) | Live-handling copy and limits | Your copy; carrier registration | — / — / `30` / `4` / `300` / `6000` |
| `PUBLIC_MCP_RATE_LIMIT` / `PUBLIC_MCP_HIDE_PERSONAL` / `MCP_PUBLIC_ENABLED` | gcr-api-clean | Optional | Public/business MCP rate limit; hide people data; switch public MCP off | — | `600` / `false` / `true` |
| `AUTH_RATE_LIMIT` / `EMBED_LEAD_RATE_LIMIT` | gcr-api-clean | Optional | Rate limits on auth and embed lead routes | — | `20` / `20` |
| `COMPOSIO_API_KEY` | gcr-api-clean | Optional (App Store integrations) | Composio REST API | Composio dashboard → Settings → API Keys | — |
| `COMPOSIO_BASE_URL` / `COMPOSIO_API_VERSION` / `COMPOSIO_REDIRECT_URL` | gcr-api-clean | Optional | Overrides | — | — |
| `DASHBOARD_ACCEPT_URL` / `BUSINESS_PHONE_LOGIN_DOMAIN` / `BUSINESS_LOGIN_DOMAIN` / `DASHBOARD_URL` / `PUBLIC_DASHBOARD_URL` | gcr-api-clean | Optional (**set** if the old dashboard flows stay live) | Older business-dashboard links; code falls back to old CyberCheck/GCR addresses | Play-user URL | — |
| `GCR_UNIFIED_URL` / `PUBLIC_PAGE_BASE_URL` / `PUBLIC_SITE_BASE_URL` / `REVIEW_BASE_URL` / `QR_FALLBACK_URL` / `QR_REDIRECT_BASE` / `TRIP_SWIPE_URL` | gcr-api-clean | **Launch** if those features are used | Public-site links in texts, QR codes, waivers, reviews; code falls back to old GCR addresses | gcr-unified's production URL; `QR_REDIRECT_BASE` = `https://${GCR_API_DOMAIN}` | `https://example.com` |
| `GCR_SERVICE_AREA_MILES` | gcr-api-clean | Optional | Service-area reach | — | `25` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENAI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` / `GROK_API_KEY` / `XAI_API_KEY` / `GOOGLE_AI_API_KEY` / `MISTRAL_API_KEY` / `OLLAMA_BASE_URL` / `AI_PROVIDER` / `INGEST_MODEL` / `DASHBOARD_SMS_MODEL` | gcr-api-clean | Legacy | Older direct-to-provider AI routes (ingest, dashboard SMS, deep crawl). New paths use LiteLLM. Set only the ones whose features you keep; they bypass LiteLLM metering | Provider dashboards | — |
| `FB_APP_ID` / `FB_APP_SECRET` / `META_APP_SECRET` / `META_PAGE_ACCESS_TOKEN` / `META_WEBHOOK_VERIFY_TOKEN` | gcr-api-clean | Optional | Instagram/Facebook webhook and oEmbed | Meta for Developers → your app | — |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | gcr-api-clean | Optional | Tourist sign-in (Firebase Admin) | Firebase console → Project settings → Service accounts | — |
| `REHOST_ADMIN_TOKEN` | gcr-api-clean | Optional | Guards photo rehost admin route | `openssl rand -hex 32` | — |
| `VERCEL` / `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA` | gcr-api-clean | Set by Vercel | On the Droplet they're absent (scheduler runs) | — | — |
| `PAPERCLIP_SERVER_URL` | Play-user, Plat-admin | **Required** | Paperclip, for the `/api/*` proxy | `https://${PAPERCLIP_DOMAIN}` | `https://app.example.com` |
| `GCR_API_URL` | Play-user, Plat-admin | **Required** | gcr-api-clean, for the `/biz/*` proxy (no trailing `/api`) | `https://${GCR_API_DOMAIN}` (or the Vercel gcr URL under option B) | `https://api.example.com` |
| `PAPERCLIP_DEV_SERVER` / `GCR_API_DEV_SERVER` / `GCR_DEV_SERVER` | Play-user / Plat-admin | Dev | Local dev proxies | — | `http://localhost:3100` |
| `VITE_BRAND_NAME` | Play-user | **Launch** | Product name in the app (same text as gcr `PLATFORM_NAME`) | Your brand | `NEXT GENT` |
| `VITE_PUBLIC_PAGE_URL` | Play-user | **Launch** | Business public page, `{slug}` replaced | gcr-unified URL pattern | `https://example.com/b/{slug}` |
| `VITE_DEFAULT_CURRENCY` | Play-user | **Launch** | Currency symbol for row prices without one; unset = prices show without a symbol | Your market | `USD` |
| `VITE_ENABLED_GROUPS` | Plat-admin | Optional | Which nav groups show | — | `console,menu,directory` |
| `VITE_APP_BUILDER_URL` | Plat-admin | **Launch** | App builder (App-build-) link | App-build- production URL + `/build` | `https://build.example.com/build` |
| `VITE_PUBLIC_API_URL` | Plat-admin | **Launch** | gcr-api-clean public address for embeddable links | `https://${GCR_API_DOMAIN}` | — |
| `VITE_PUBLIC_SITE_URL` | Plat-admin | **Launch** | gcr-unified for claim/preview/QR links | gcr-unified URL | `https://example.com` |
| `VITE_APP_NAME` / `VITE_APP_SHORT_NAME` | Plat-admin | Optional | Console title | Your brand | `NEXT GENT Admin` |
| `VITE_CURRENCY` | Plat-admin | **Launch** | Currency for amounts sent without one | Your market | `USD` |
| `VITE_DEFAULT_PAGE_SIZE` / `VITE_REQUEST_TIMEOUT_MS` / `VITE_TOKEN_REFRESH_LEEWAY_S` | Plat-admin | Optional | List size, timeout, token refresh margin | — | `50` / `45000` / `30` |
| `APP_BUILD_LEGACY_PLATFORM` | App-build- | Optional | `on` runs the retired platform; leave empty | — | (empty) |
| `NEXT_PUBLIC_PAPERCLIP_URL` | App-build- | **Launch** | Paperclip, where the builder publishes manifests (needs this site in `PAPERCLIP_APP_ORIGINS`) | `https://${PAPERCLIP_DOMAIN}` | — |
| `NEXT_PUBLIC_STORE_PUBLISHER` | App-build- | **Launch** | Publisher id for store items | Your choice | `nextgent` |
| `NEXT_PUBLIC_STORE_APP_KIND` | App-build- | Optional | Store kind for apps; empty = `app` | — | (empty) |
| `BUILDER_AI_HOURLY_LIMIT` | App-build- | Optional | Describe-it generations per client per hour; 0/empty = off | — | `10` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `OPENAI_API_KEY` / `OPENAI_MODEL` / `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_MODEL` / `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` / `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` / `CUSTOM_AI_MODEL` | App-build- | Optional | Describe-it provider (one). To meter it, use `CUSTOM_AI_*` pointed at LiteLLM (`https://${LITELLM_DOMAIN}/v1`, a NEXT GENT key, a tier) | LiteLLM | — |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_GCR_API_BASE` / `NEXT_PUBLIC_SITE_URL` | App-build- | Legacy | Retired platform only | — | — |
| `VITE_API_BASE` | gcr-unified | **Required** | gcr-api-clean base it reads public data from | `https://${GCR_API_DOMAIN}` or the Vercel gcr URL | — |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` | gcr-unified | Legacy | Direct Supabase reads; the code falls back to the cyber check project. Under the architecture rule only gcr-api-clean talks to the database, so leave the key empty | — | — |
| `VITE_DEFAULT_MODE` | gcr-unified | Optional | `browse` or `swipe` | — | `browse` |
| `VITE_SMS_NUMBER` | gcr-unified | **Launch** | Number shown for text-to-search; code falls back to an old number | `CONCIERGE_NUMBER` | `+15550100001` |
| `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_STORAGE_BUCKET` / `_MESSAGING_SENDER_ID` / `_APP_ID` | gcr-unified | Optional | Tourist sign-in (Firebase web config) | Firebase console → Project settings → Your apps | — |
| `SITE_BASE_URL` / `PRERENDER_LIMIT` | gcr-unified (build script) | **Launch** / Dev | Canonical site URL for prerendered pages (falls back to an old domain); test limit | gcr-unified production URL | `https://example.com` |
| `WORKER_ID` | Worker | **Required** | Business's worker id: project, network, hostnames | Company url key / slug | `acme` |
| `HERMES_VERSION` / `HERMES_IMAGE` | Worker | **Required** | Pinned Hermes gateway build | Hermes releases | `0.17.0` / `nextgent/hermes-gateway:0.17.0` |
| `OPENCLAW_IMAGE` / `OPENCLAW_GATEWAY_COMMAND` | Worker | **Required** with OpenClaw | Pinned OpenClaw build and its gateway command | Upstream OpenClaw tag | — |
| `HERMES_PORT` / `OPENCLAW_PORT` | Worker | **Required** | Ports inside the business's network | — | `8642` / `18789` |
| `HERMES_MEM_LIMIT` / `HERMES_CPUS` / `OPENCLAW_MEM_LIMIT` / `OPENCLAW_CPUS` / `WORKER_PIDS_LIMIT` | Worker | **Required** | Per-business limits | Your plan sizes | `1g` / `1.0` / `1g` / `1.0` / `512` |
| `HERMES_API_SERVER_KEY` | Worker | **Required** | Paperclip → Hermes key (same value in the agent's adapter config `apiKey`) | `openssl rand -hex 32` | 64 hex |
| `OPENCLAW_GATEWAY_TOKEN` | Worker | **Required** with OpenClaw | Paperclip → OpenClaw token | `openssl rand -hex 32` | 64 hex |
| `WORKER_LLM_BASE_URL` / `WORKER_LLM_KEY` | Worker | **Required** | LiteLLM model API and this company's own key | `https://${LITELLM_DOMAIN}/v1`; LiteLLM → Virtual Keys | — / `sk-…` |
| `CADDY_IMAGE` / `CADDY_MEM_LIMIT` / `ACME_EMAIL` / `PAPERCLIP_EGRESS_CIDRS` | Worker edge | **Required** | Worker host's Caddy; only the control Droplet may call the gateways | Control Droplet's public IP | `198.51.100.20/32` |

## Not settings: values that live in the database

These are rows, not environment variables: plans and prices (`billing_plan`,
`billing_item_prices`), store items, forwarding-confirmation rules, the
concierge instructions fallback (`platform_config`), and your admin row
(`platform_admins.paperclip_user_id`). Set them after the SQL steps in
STEPS.md.
