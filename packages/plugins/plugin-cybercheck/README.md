# Business data plugin (platform infrastructure)

One Paperclip company is one business. This plugin gives every company's agents
tools to read and change that business's data in gcr-api-clean:
`business_whoami`, `business_list_sections`, `business_describe_section`,
`business_read_section`, `business_create_row`, `business_update_row`,
`business_delete_row`.

It is installed on every instance at boot (bundled catalog key
`business-data`, see `server/src/services/bundled-plugins.ts`). It is not a
store item and has no page or widget: the owner app's Business area is the
screen for business data.

## How it connects

```
agent run ──(token)──▶ gcr-api-clean  POST /api/mcp ──▶ business database
```

gcr-api-clean is the only thing that talks to the database. The plugin holds
no database key and never sends a slug: the token decides which business it
is. Tools take the company from the agent's run, never from tool arguments.

## Where the token comes from

Nobody pastes a token. The server writes this plugin's per-company config:

- `apiBaseUrl` — from the server's `GCR_API_URL`.
- `businessToken` — secret ref to the company's business token, stored when
  the owner links the company to a business
  (`POST /api/companies/:companyId/business-link`).
- `agentTokens.<agentId>` — secret ref to an agent's own install token, stored
  when that agent is installed from the store. That agent uses it instead of
  the company token, so it can only touch what the owner approved.

## Develop

```bash
pnpm --filter @culturereset/plugin-cybercheck test       # no network, no credentials
pnpm --filter @culturereset/plugin-cybercheck typecheck
pnpm --filter @culturereset/plugin-cybercheck build
```
