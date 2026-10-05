#!/usr/bin/env node
// PROOF HARNESS (scratchpad, not part of the repo): boots gcr-api-clean's real
// routes as an HTTP listener against the in-memory database the repo's own
// scripts use (scripts/lib/memdb.js). Nothing in the repo is changed.
//
//   GCR_PORT=4610 PAPERCLIP_URL=http://127.0.0.1:4600 node gcr-server.cjs
//
// proof5 (Step 5: apps in the store) mounts, beside proof4's routers, the
// business data door (/api/business), the business MCP (/api/mcp) and the
// legacy dashboard (/api/platform), and stubs the live schema with the tables
// the six shipped apps bind to (faqs, entity_photos, entity_leads,
// entity_customers, menu_sections, menu_items with sort_order/is_available,
// entity with social_*/website_url/currency).
//
// Debug surface for the proof driver only:
//   GET  /__proof/tables?names=a,b     the memdb rows of those tables
//   GET  /__proof/calls                every inbound /api/nextgent request seen
//   GET  /__proof/link-token           the company-level business_mcp_token the
//                                      link handed Paperclip (captured from the
//                                      response; Paperclip stores it sealed)
//   GET  /__proof/events               every automation event emitted
//                                      (lib/automationEngine.emitEvent, wrapped —
//                                      the real function still runs)
//   GET  /__proof/known-events?slug=   lib/automationEngine.knownEvents(slug)
//   GET  /__proof/legacy-jwt?siteId=   an Express JWT (JWT_SECRET) for the legacy
//                                      dashboard's authRequired
//   POST /__proof/seed {table, row}    insert one memdb row
//   POST /__proof/set  {table, where, patch}  update memdb rows

const path = require('path');
const GCR = '/home/user/gcr-api-clean';
const req = (p) => require(path.join(GCR, p));
const express = require(path.join(GCR, 'node_modules/express'));
const jwt = require(path.join(GCR, 'node_modules/jsonwebtoken'));
const { createMemDb, inject } = req('scripts/lib/memdb.js');

const PORT = Number(process.env.GCR_PORT || 4610);
const PAPERCLIP_URL = (process.env.PAPERCLIP_URL || 'http://127.0.0.1:4600').replace(/\/+$/, '');
const SECRET = process.env.NEXTGENT_SERVICE_SECRET || 'proof-shared-service-secret';

Object.assign(process.env, {
    NEXTGENT_SERVICE_SECRET: SECRET,
    NEXTGENT_SECRETS_KEY: 'proof-box-key',
    NEXTGENT_SESSION_SECRET: 'proof-session-key',
    VERIFY_CODE_SECRET: 'proof-code-key',
    JWT_SECRET: 'proof-legacy-jwt-secret',
    DEFAULT_CURRENCY: 'USD',
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

const { T, db: rawDb } = createMemDb({
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
        // Step 5: the business tables the shipped apps bind to.
        menu_items: [],
        menu_sections: [],
        entity_photos: [],
        faqs: [],
        entity_leads: [],
        entity_customers: [],
        // The inbox and the automation engine's tables.
        live_conversations: [],
        message_threads: [],
        business_messages: [],
        sms_log: [],
        automations: [],
        entity_automations: [],
        platform_config: [],
        nextgent_ai_keys: [],
    },
    unique: {
        company_links: ['company_id', 'entity_slug'],
        nextgent_installs: ['install_id'],
        entity_modules: ['install_id'],
        entity: ['slug'],
    },
});

// PostgREST ignores `undefined` values in an update body; the memdb would
// store them (Object.assign). Strip them so a dashboard save that sends
// `social_instagram: undefined` leaves the column alone, as Postgres would.
const stripUndefined = (v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) : v);
const db = {
    ...rawDb,
    from(name) {
        const q = rawDb.from(name);
        const update = q.update;
        q.update = (v) => update(stripUndefined(v));
        return q;
    },
};
inject(path.join(GCR, 'db.js'), db);
inject(require.resolve('@supabase/supabase-js', { paths: [GCR] }), { createClient: () => db });

// lib/businessTables.js discovers the schema from PostgREST's OpenAPI document;
// answer that one URL from here (the tests do the same) and pass everything
// else through, in particular the JWKS fetch to Paperclip.
const realFetch = globalThis.fetch;
const def = (cols) => ({ properties: Object.fromEntries(cols.map((c) => [c, { type: 'string' }])) });
const SCHEMA = {
    // The business record (keyed by slug, not entity_slug: not a section, but
    // business.profile / business.links / business.currency read it).
    entity: def(['id', 'slug', 'name', 'entity_type', 'subtitle', 'phone', 'email', 'website_url', 'social_instagram', 'social_facebook', 'social_tiktok', 'currency', 'icon', 'is_active', 'timezone', 'created_at', 'updated_at']),
    menu_sections: def(['id', 'entity_slug', 'section_name', 'sort_order']),
    menu_items: def(['id', 'entity_slug', 'item_name', 'description', 'price', 'section_id', 'is_available', 'sort_order', 'image_url']),
    entity_photos: def(['id', 'entity_slug', 'url', 'image_path', 'caption', 'is_cover', 'sort_order']),
    faqs: def(['id', 'entity_slug', 'question', 'answer', 'category', 'sort_order']),
    entity_leads: def(['id', 'entity_slug', 'name', 'email', 'phone', 'message', 'source', 'status', 'created_at', 'updated_at']),
    entity_customers: def(['id', 'entity_slug', 'name', 'phone', 'email', 'notes', 'created_at', 'updated_at']),
    entity_reviews: def(['id', 'entity_slug', 'reviewer_name', 'reviewer_email', 'rating', 'title', 'body', 'approved', 'created_at']),
    app_records: def(['id', 'entity_slug', 'install_id', 'app_table', 'data', 'source', 'created_at']),
};
globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://db.example.test/rest/v1/')) {
        return { ok: true, status: 200, json: async () => ({ definitions: SCHEMA }) };
    }
    return realFetch(url, init);
};

// The event observable: lib/businessEvents.js hands every event to
// lib/automationEngine.emitEvent (looked up at call time). The real function
// still runs (no automations are installed, so it runs nothing); the wrapper
// records what was emitted.
const events = [];
const automationEngine = req('lib/automationEngine.js');
const realEmit = automationEngine.emitEvent;
automationEngine.emitEvent = async (event, slug, payload) => {
    const result = await realEmit(event, slug, payload);
    events.push({ at: new Date().toISOString(), event, slug, payload, result });
    return result;
};

const calls = [];
let linkToken = null;
const appData = req('routes/app-data.js');
const app = express();
app.use(express.json({ limit: '2mb', verify: (r, _res, buf) => { r.rawBody = buf; } }));
app.use('/api/nextgent', (r, res, next) => {
    calls.push({
        at: new Date().toISOString(),
        method: r.method,
        path: r.originalUrl,
        signed: ['x-nextgent-timestamp', 'x-nextgent-nonce', 'x-nextgent-signature'].every((h) => !!r.headers[h]),
        body: r.body && Object.keys(r.body).length ? r.body : null,
    });
    // The link's response carries the company-level token once; keep it for
    // the MCP step (Paperclip seals it and never shows it again).
    if (r.method === 'POST' && r.path === '/link') {
        const json = res.json.bind(res);
        res.json = (body) => { if (body && typeof body.businessToken === 'string') linkToken = { token: body.businessToken, entitySlug: body.entitySlug, at: new Date().toISOString() }; return json(body); };
    }
    next();
});
// The same mounts server.js uses for these routers.
app.use('/api/nextgent', req('routes/nextgent.js'));
app.use('/api/public/apps', appData.publicRouter);
app.use('/api/public/business', appData.businessRouter);
app.use('/api/owner', req('routes/owner.js'));
app.use('/api/app-data', appData.dataRouter);
app.use('/api/app-install', appData.installRouter);
app.use('/api/business', req('routes/business-data.js'));
app.use('/api/mcp', req('routes/mcp.js'));
app.use('/api/platform', req('routes/platform.js'));
app.use('/api/gcr', req('routes/gcr.js'));

app.get('/__proof/tables', (r, res) => {
    const names = String(r.query.names || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(Object.fromEntries(names.map((n) => [n, T[n] || []])));
});
app.get('/__proof/calls', (_r, res) => res.json(calls));
app.get('/__proof/link-token', (_r, res) => res.json(linkToken || {}));
app.get('/__proof/events', (_r, res) => res.json(events));
app.get('/__proof/known-events', async (r, res) => res.json(await automationEngine.knownEvents(String(r.query.slug || ''))));
app.get('/__proof/legacy-jwt', (r, res) => {
    const siteId = String(r.query.siteId || 'legacy-owner');
    res.json({ token: jwt.sign({ userId: siteId, siteId, role: 'owner' }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
});
app.post('/__proof/seed', (r, res) => {
    const { table, row } = r.body || {};
    (T[table] ||= []).push(row);
    res.status(201).json(row);
});
app.post('/__proof/set', (r, res) => {
    const { table, where, patch } = r.body || {};
    const hits = (T[table] || []).filter((row) => Object.entries(where || {}).every(([k, v]) => row[k] === v));
    hits.forEach((row) => Object.assign(row, patch));
    res.json({ updated: hits.length, rows: hits });
});
app.get('/__proof/ready', (_r, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, '127.0.0.1', () => {
    console.log(`[gcr-proof] gcr-api-clean routes listening on http://127.0.0.1:${PORT} (memdb), Paperclip at ${PAPERCLIP_URL}`);
});
