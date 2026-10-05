#!/usr/bin/env node
// PROOF HARNESS (scratchpad, not part of the repo): boots gcr-api-clean's real
// routes as an HTTP listener against the in-memory database the repo's own
// scripts use (scripts/lib/memdb.js). Nothing in the repo is changed.
//
//   GCR_PORT=4610 PAPERCLIP_URL=http://127.0.0.1:4600 node gcr-server.cjs
//
// Debug surface for the proof driver only:
//   GET /__proof/tables?names=a,b   the memdb rows of those tables
//   GET /__proof/calls              every inbound /api/nextgent request seen
//                                   (method, path, signature headers present, body)

const path = require('path');
const GCR = '/home/user/gcr-api-clean';
const req = (p) => require(path.join(GCR, p));
const express = require(path.join(GCR, 'node_modules/express'));
const { createMemDb, inject } = req('scripts/lib/memdb.js');

const PORT = Number(process.env.GCR_PORT || 4610);
const PAPERCLIP_URL = (process.env.PAPERCLIP_URL || 'http://127.0.0.1:4600').replace(/\/+$/, '');
const SECRET = process.env.NEXTGENT_SERVICE_SECRET || 'proof-shared-service-secret';

Object.assign(process.env, {
    NEXTGENT_SERVICE_SECRET: SECRET,
    NEXTGENT_SECRETS_KEY: 'proof-box-key',
    NEXTGENT_SESSION_SECRET: 'proof-session-key',
    VERIFY_CODE_SECRET: 'proof-code-key',
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_KEY: 'service',
    GCR_SUPABASE_URL: 'https://db.example.test',
    GCR_SUPABASE_SERVICE_KEY: 'service',
    INTAKE_EMAIL_DOMAIN: 'parse.example.test',
    PAPERCLIP_ISSUER: PAPERCLIP_URL,
    PAPERCLIP_JWKS_URL: `${PAPERCLIP_URL}/.well-known/jwks.json`,
    PAPERCLIP_API_URL: PAPERCLIP_URL,
    API_BASE_URL: `http://127.0.0.1:${PORT}`,
});
delete process.env.TELEPHONY_PROVIDER;

const { T, db } = createMemDb({
    tables: {
        entity: [],
        company_links: [],
        entity_owners: [],
        business_mcp_tokens: [],
        nextgent_installs: [],
        entity_modules: [
            // A legacy owner row on another business, to show it is never touched.
            { id: 'legacy-1', entity_slug: 'other-shop', module_key: 'menu', enabled: true, settings: { manifest: { block: 'menu' }, config: {}, showOnPublic: true }, sort_order: 0 },
        ],
        app_records: [],
        billing_item_prices: [],
        billing_plan: [{ key: 'base', name: 'Base', is_default: true }],
        billing_subscription: [],
        billing_item_charges: [],
        store_items: [],
        store_plan_items: [],
        store_grants: [],
        owner_notify_settings: [],
        platform_admins: [],
        menu_items: [],
        menu_sections: [],
    },
    unique: {
        company_links: ['company_id', 'entity_slug'],
        nextgent_installs: ['install_id'],
        entity_modules: ['install_id'],
        entity: ['slug'],
    },
});
inject(path.join(GCR, 'db.js'), db);
inject(require.resolve('@supabase/supabase-js', { paths: [GCR] }), { createClient: () => db });

// lib/businessTables.js discovers the schema from PostgREST's OpenAPI document;
// answer that one URL from here (the tests do the same) and pass everything
// else through, in particular the JWKS fetch to Paperclip.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://db.example.test/rest/v1/')) {
        const def = (cols) => ({ properties: Object.fromEntries(cols.map((c) => [c, { type: 'string' }])) });
        return {
            ok: true, status: 200, json: async () => ({ definitions: {
                menu_items: def(['id', 'entity_slug', 'item_name', 'description', 'price', 'section_id', 'is_available', 'sort_order']),
                menu_sections: def(['id', 'entity_slug', 'section_name', 'sort_order']),
                app_records: def(['id', 'entity_slug', 'install_id', 'app_table', 'data', 'source', 'created_at']),
            } }),
        };
    }
    return realFetch(url, init);
};

const calls = [];
const appData = req('routes/app-data.js');
const app = express();
app.use(express.json({ limit: '2mb', verify: (r, _res, buf) => { r.rawBody = buf; } }));
app.use('/api/nextgent', (r, _res, next) => {
    calls.push({
        at: new Date().toISOString(),
        method: r.method,
        path: r.originalUrl,
        signed: ['x-nextgent-timestamp', 'x-nextgent-nonce', 'x-nextgent-signature'].every((h) => !!r.headers[h]),
        body: r.body && Object.keys(r.body).length ? r.body : null,
    });
    next();
});
// The same mounts server.js uses for these routers.
app.use('/api/nextgent', req('routes/nextgent.js'));
app.use('/api/public/apps', appData.publicRouter);
app.use('/api/public/business', appData.businessRouter);
app.use('/api/owner', req('routes/owner.js'));
app.use('/api/app-data', appData.dataRouter);
app.use('/api/app-install', appData.installRouter);
app.use('/api/gcr', req('routes/gcr.js'));

app.get('/__proof/tables', (r, res) => {
    const names = String(r.query.names || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(Object.fromEntries(names.map((n) => [n, T[n] || []])));
});
app.get('/__proof/calls', (_r, res) => res.json(calls));
app.get('/__proof/ready', (_r, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, '127.0.0.1', () => {
    console.log(`[gcr-proof] gcr-api-clean routes listening on http://127.0.0.1:${PORT} (memdb), Paperclip at ${PAPERCLIP_URL}`);
});
