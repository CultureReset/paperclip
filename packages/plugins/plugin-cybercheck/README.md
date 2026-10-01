# CyberCheck Business plugin

Paperclip is the SaaS platform. **One Paperclip company is one business**, and
this plugin puts that business's data — everything gcr-api-clean holds for it —
inside Paperclip:

- **Business page** in the sidebar: every section the business has data in
  (menu items, FAQs, hours, events, …), with search, paging, add, edit, delete.
- **Dashboard widget** on the company dashboard: the business and its row counts.
- **Agent tools** so the company's Paperclip agents can read and change the same
  data: `business_whoami`, `business_list_sections`, `business_describe_section`,
  `business_read_section`, `business_create_row`, `business_update_row`,
  `business_delete_row`.

## How it connects

```
Paperclip company ──(business token)──▶ gcr-api-clean  POST /api/mcp ──▶ Supabase "cyber check"
```

gcr-api-clean stays the only thing that talks to the database. The plugin
holds no database key and never sends a slug: the company's **business token**
(`gcr_mcp_…`, from `business_mcp_tokens`) decides which business it is, exactly
as it does for any other MCP client. Agent tools take the company from the
agent's run, never from the tool arguments.

Sections, columns and which columns are editable all come from gcr-api-clean
at runtime (`lib/businessTables.js` there), so a new table shows up here with
no change to this plugin.

## Connect a company to its business

1. Mint a token for the business. Signed in to the business dashboard as the
   owner (or with that session token):
   `POST https://gcr-api-clean.vercel.app/api/mcp/tokens` with
   `{ "scope": "write" }` (or `"read"`). It is shown once.
2. In Paperclip: **Settings → Plugins → CyberCheck Business**, select the
   company, paste the token into **Business token** and save. It is stored as a
   company secret, not in plain config.
3. Leave **gcr-api-clean URL** as is unless you run the API elsewhere.

## Develop

```bash
pnpm --filter @culturereset/plugin-cybercheck test       # no network, no credentials
pnpm --filter @culturereset/plugin-cybercheck typecheck
pnpm --filter @culturereset/plugin-cybercheck build
pnpm paperclipai plugin install "$(pwd)/packages/plugins/plugin-cybercheck"
```
