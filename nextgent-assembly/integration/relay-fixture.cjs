// Test fixture only: real GCR routers, repository memdb, captured signed Paperclip requests.
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.env.GCR_REPO || path.join(__dirname, '../repos/gcr-api-clean'));
const express = require(path.join(root, 'node_modules/express'));
const { createMemDb, inject } = require(path.join(root, 'scripts/lib/memdb'));
const nodeToken = 'gcr_node_' + 'c'.repeat(48);
const mcpToken = 'gcr_ghostmcp_' + 'd'.repeat(64);
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
Object.assign(process.env, { NEXTGENT_SERVICE_SECRET: 'test-only', NEXTGENT_SECRETS_KEY: 'test-box',
  NEXTGENT_SESSION_SECRET: 'test-session', VERIFY_CODE_SECRET: 'test-code', PAPERCLIP_API_URL: 'https://paperclip.fixture' });
const { T, db } = createMemDb({ tables: {
  company_links: [{ company_id: 'company-fixture', entity_slug: 'shop' }],
  ghost_nodes: [{ id: 'node-1', entity_slug: 'shop', name: 'Fixture box', token_hash: hash(nodeToken), revoked_at: null }],
  ghost_mcp_tokens: [{ id: 'mcp-1', node_id: 'node-1', entity_slug: 'shop', token_hash: hash(mcpToken), revoked_at: null }],
  ghost_node_requests: [],
} });
// The generic memdb does not apply SQL defaults. Mirror the relay migration's
// queued default here so the real pull route sees newly inserted instructions.
const from = db.from.bind(db);
db.from = table => {
  const query = from(table);
  if (table === 'ghost_node_requests') {
    const insert = query.insert.bind(query);
    query.insert = values => insert(Array.isArray(values)
      ? values.map(v => ({ status: 'queued', ...v })) : { status: 'queued', ...values });
  }
  return query;
};
inject(path.join(root, 'db.js'), db);
inject(path.join(root, 'middleware/ownerAuth.js'), { ownerRequired: (_q, r) => r.sendStatus(401) });
let offline = true;
const posted = [];
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://paperclip.fixture')) throw Error('Unexpected upstream');
  if (String(url).endsWith('/receipts') && offline) throw Error('Fixture Paperclip outage');
  posted.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
  return { ok: true, status: 201, text: async () => '{"ok":true}' };
};
const app = express();
app.use(express.json());
app.use('/api/nodes', require(path.join(root, 'routes/nodes.js')));
app.use('/api/mcp/ghost', require(path.join(root, 'routes/mcp-ghost.js')));
app.get('/__fixture', (_q, r) => r.json({ tables: T, posted }));
app.post('/__fixture/online', (_q, r) => { offline = false; r.json({ ok: true }); });
app.post('/__fixture/lose-answer', (_q, r) => {
  const request = T.ghost_node_requests.find(row => row.path === '/intent');
  Object.assign(request, { status: 'dispatched', response_body: null, response_status: null,
    dispatched_at: new Date(Date.now() - 240_000).toISOString() });
  r.json({ ok: true });
});
app.post('/__fixture/stop', (_q, r) => { r.json({ ok: true }); server.close(); });
const server = app.listen(0, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${server.address().port}`, nodeToken, mcpToken,
})));
