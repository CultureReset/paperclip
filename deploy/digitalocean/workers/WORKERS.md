# Worker hosts: Hermes and OpenClaw

Paperclip owns the work. Hermes and OpenClaw only carry it out, and each
business gets its own set: the boss is shared, the workers aren't (plan §3).
This page covers where they run, the compose project for one business, and
how Paperclip reaches it.

## Decision 2: where workers run

The same `docker-compose.worker.yml` works for both options. Only the number
of projects per host changes.

| | A. Container per business on shared hosts | B. Droplet per business |
| --- | --- | --- |
| What it is | Several `worker-<id>` compose projects on one worker Droplet. Each business has its own containers, volumes and network. | One `worker-<id>` project on its own Droplet. |
| Separation | Containers share one kernel. Each business is on its own Docker network, so businesses cannot reach each other, and containers drop all capabilities. A container escape would reach the other businesses on that host. | The business has a whole VM to itself. This is the strongest option, and OpenClaw's own security model assumes it ("inherits all the trust of its host machine"). |
| Rough cost | A 4 vCPU / 8 GB Droplet (about $48 a month) holds about 4 to 6 businesses at the sizes in `worker.env.example`, so about $8 to $12 per business. | About $12 to $24 per business per month (1 to 2 GB Droplets). Check current DigitalOcean pricing. |
| Operations | One Caddy, one host to patch, many projects. | One host per business to patch and monitor. |

**Decision needed (plan §17, decision 2).** These files don't pick an
option. Moving a business from A to B later uses the same compose project
and env file, started on a new Droplet. Copy its volumes over (see
../STEPS.md, "Backups") and point its DNS name at the new IP.

Never run workers on the control Droplet. Agents' tools run code, and the
control Droplet holds every company's data and the shared secrets.

## Files

| File | What it is |
| --- | --- |
| `docker-compose.worker.yml` | One business's workers: `hermes`, and `openclaw` under the `openclaw` profile |
| `worker.env.example` | That business's settings. Copy it to `businesses/<id>.env`. |
| `docker-compose.edge.yml`, `edge.env.example` | The worker host's single Caddy (HTTPS for every business on the host) |
| `Caddyfile`, `site.caddy.example` | The edge Caddy config. Each business gets one `sites/<id>.caddy`. |
| `openclaw.json.example` | Starting point for a business's OpenClaw config |

The Hermes image is built from the repo's pinned gateway image
(`docker/hermes-gateway-smoke`, `HERMES_VERSION` build arg) instead of a new
Dockerfile. OpenClaw has no image in this repo. Build it from its upstream
repository at a pinned tag, the way `scripts/smoke/openclaw-docker-ui.sh`
does:

```bash
git clone https://github.com/openclaw/openclaw.git && cd openclaw
git checkout <pinned tag>
docker build -t "$OPENCLAW_IMAGE" .
```

Copy that tag's gateway command from its `docker-compose.yml` into
`OPENCLAW_GATEWAY_COMMAND`.

## Set up a worker host (once)

1. Create a Droplet in the same region as the control Droplet and enable its
   VPC. Install Docker the same way as in ../STEPS.md, step 4.
2. Firewall (DigitalOcean Cloud Firewall, not ufw, because Docker's published
   ports bypass ufw):
   - inbound 443 only from the control Droplet (by tag or IP);
   - inbound 80 from anywhere, for Let's Encrypt's HTTP challenge (Caddy
     only redirects it);
   - SSH only from your admin IPs.
3. DNS: a wildcard `*.workers.<your-domain>` A record pointing at this host,
   or one A record per business hostname.
4. Clone this repo and start the edge:
   ```bash
   cd deploy/digitalocean/workers
   cp edge.env.example edge.env   # ACME email, control Droplet IP
   docker compose --env-file edge.env -f docker-compose.edge.yml up -d
   ```

## Add a business

1. Pick the id (`WORKER_ID`), then `cp worker.env.example businesses/<id>.env`
   and fill it in:
   - `HERMES_API_SERVER_KEY` and `OPENCLAW_GATEWAY_TOKEN`: each from
     `openssl rand -hex 32`.
   - `WORKER_LLM_KEY`: the company's own LiteLLM key, which Paperclip made at
     sign-up. Find it in the LiteLLM admin UI under Virtual Keys, where its
     metadata has the company id. Never use a provider key.
   - `WORKER_LLM_BASE_URL`: `https://<LITELLM_DOMAIN>/v1`.
2. For OpenClaw: create the state volume's config from `openclaw.json.example`
   with the token and LiteLLM values filled in, and put it at
   `/home/node/.openclaw/openclaw.json` in the `worker-<id>_openclaw-state`
   volume. Keep device auth on (`dangerouslyDisableDeviceAuth: false`).
3. Start it:
   ```bash
   docker compose -p worker-<id> --env-file businesses/<id>.env \
     -f docker-compose.worker.yml up -d --build          # add --profile openclaw
   docker network connect nextgent-worker-<id> nextgent-workers-edge-caddy-1
   ```
4. `cp site.caddy.example sites/<id>.caddy`, fill in the id, the two hostnames
   and the ports, then reload:
   `docker compose -f docker-compose.edge.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`.
5. Check from the control Droplet, which is the only allowed caller:
   `curl -sS -o /dev/null -w '%{http_code}\n' https://<id>-hermes.workers.<your-domain>/`.
   Any answer other than a connection error or 403 means it is reachable.

## How Paperclip reaches the workers

Paperclip ships both adapters built in. Nothing extra is installed on the
control Droplet.

**Hermes (`hermes_gateway`).** Follow `doc/HERMES_GATEWAY_ONBOARDING.md`. In
the business's company, create an agent invite. The join request's
`agentDefaultsPayload` uses:

| Field | Value |
| --- | --- |
| `apiBaseUrl` | `https://<id>-hermes.workers.<your-domain>` (HTTPS is required: the join flow refuses plain HTTP to a non-loopback host) |
| `apiKey` | the business's `HERMES_API_SERVER_KEY` |
| `paperclipApiUrl` | `https://<PAPERCLIP_DOMAIN>` |
| `sessionKeyStrategy` | `issue` |

Approve the request, then let Hermes claim its one-time Paperclip agent key.
Keep that key in the Hermes volume and never in a ticket or log. Paperclip to
Hermes uses the gateway key. Hermes to Paperclip uses the claimed agent key.
They are different keys.

**OpenClaw (`openclaw_gateway`).** Follow `doc/OPENCLAW_ONBOARDING.md`:

- the gateway URL is `wss://<id>-claw.workers.<your-domain>`;
- the token is the business's `OPENCLAW_GATEWAY_TOKEN`;
- device auth stays on, so approve the pending device in OpenClaw on the
  first run.

**Reaching the workers.** The Hermes join flow refuses plain HTTP to a
non-loopback host, so Paperclip has to call workers over HTTPS. These files
use one HTTPS front door per worker host, with every business on its own
hostname. That front door, and the choice between it and a private VPC
route, is part of decision 2 (see "Decision needed: how workers are reached"
in ../STEPS.md).

**LiteLLM.** Workers on another host can reach LiteLLM only if it is
published (`caddy-sites/litellm-public.caddy.example`) or reachable over the
VPC. That is a decision too.

**Traffic.**

- Paperclip calls the workers over 443, and only the control Droplet's
  address is allowed through, both at the firewall and in Caddy.
- The workers call Paperclip at `https://<PAPERCLIP_DOMAIN>` with their agent
  key.
- The workers call LiteLLM at `https://<LITELLM_DOMAIN>/v1` with their
  company's key.
- The workers never get a database string, a provider key or
  `NEXTGENT_SERVICE_SECRET`.

## Check before relying on it

- **Hermes reading LiteLLM settings.** The compose file passes
  `OPENAI_BASE_URL` and `OPENAI_API_KEY`. Check that Hermes at your pinned
  `HERMES_VERSION` sends model calls to that base URL. If it doesn't, set the
  custom OpenAI-compatible endpoint in `$HERMES_HOME/config.yaml` in the
  `hermes-home` volume. Confirm the calls show up under the company's key in
  LiteLLM's spend logs.
- **OpenClaw.** Confirm the gateway command and how a LiteLLM model is named
  in `openclaw.json` against the tag you pinned.
- **Outbound traffic.** Workers have open outbound internet access, which
  agents need. If a business needs tighter limits, put it on its own Droplet
  (option B) with an outbound firewall.
