// specs/plugin-operator-provisioning.md rules 30, 35 — through the real chain (support audit, then the
// plugins router): on an operator-managed space a support session gets the byte-identical unknown-route
// 404 on every lifecycle route and leaves no entry in the support log; on an unmanaged space the audit
// still refuses uninstalling and turning off with its 403. The Paramètres summary has no plugins line.
const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');

const { fakeSession, withSupportRequest, supportLink, openSupportAccess } = require('./accountSecurityFixture');
const { createSupportAudit } = require('../middleware/supportAudit');
const { isHidden } = require('../middleware/requireSelfManagedPlugins');
const { buildSummary } = require('../controllers/settingsSummaryController');

const UNKNOWN = { error: 'API route not found' };

function supportSession() {
  const h = withSupportRequest();
  const accessId = openSupportAccess(h);
  const opened = h.supportAccess.consumeLink(supportLink(h, accessId));
  return { h, session: fakeSession({ user: opened.user, supportAccessId: accessId, supportExpiresAt: opened.expiresAt }) };
}

async function serve({ managed }) {
  const previous = process.env.GUESTFLOW_MANAGED;
  if (managed) process.env.GUESTFLOW_MANAGED = '1'; else delete process.env.GUESTFLOW_MANAGED;
  const { h, session } = supportSession();
  const logged = [];
  const record = h.supportAccess.record.bind(h.supportAccess);
  h.supportAccess.record = (id, entry) => { logged.push(entry); return record(id, entry); };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; req.user = session.user; next(); });
  app.use('/api', createSupportAudit({ controller: h.supportAccess, isHidden }));
  app.use('/api/plugins', require('../routes/plugins'));
  app.use('/api', (req, res) => res.status(404).json({ ...UNKNOWN }));
  const server = await listenLocal(http.createServer(app));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = async (method, path) => {
    const res = await fetch(`${base}/api${path}`, { signal: AbortSignal.timeout(10_000), method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    return { status: res.status, text: await res.text() };
  };
  return {
    ask, logged,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => {
      if (previous === undefined) delete process.env.GUESTFLOW_MANAGED; else process.env.GUESTFLOW_MANAGED = previous;
      resolve();
    }); }),
  };
}

const LIFECYCLE = [
  ['GET', '/plugins/status'], ['GET', '/plugins/page?path=/x'], ['POST', '/plugins/refresh'], ['POST', '/plugins/update-all'],
  ['POST', '/plugins/linen/install'], ['POST', '/plugins/linen/update'], ['POST', '/plugins/linen/rollback'],
  ['POST', '/plugins/linen/activate'], ['POST', '/plugins/linen/deactivate'], ['DELETE', '/plugins/linen?purge=1'],
  ['POST', '/PLUGINS/linen/Deactivate/'], ['DELETE', '/Plugins/linen/'],
];

test('rule 30: a support session on a managed space gets the unknown-route 404 on every lifecycle route', async () => {
  const s = await serve({ managed: true });
  try {
    const unknown = await s.ask('POST', '/zzz/none');
    assert.deepEqual(unknown, { status: 404, text: JSON.stringify(UNKNOWN) });
    for (const [method, path] of LIFECYCLE) {
      // eslint-disable-next-line no-await-in-loop
      assert.deepEqual(await s.ask(method, path), unknown, `${method} ${path}`);
    }
  } finally { await s.close(); }
});

test('rule 30: a hidden lifecycle route leaves the same trace as an unknown path — no side channel through the support log', async () => {
  const s = await serve({ managed: true });
  try {
    const trace = async (method, path) => {
      s.logged.length = 0;
      await s.ask(method, path);
      await new Promise((resolve) => setImmediate(resolve));
      return s.logged.map((e) => ({ method: e.method, summary: e.summary }));
    };
    for (const [method, path] of LIFECYCLE) {
      const hidden = await trace(method, path); // eslint-disable-line no-await-in-loop
      const unknown = await trace(method, `/zzz${path.split('?')[0].replace(/\//g, '-')}`); // eslint-disable-line no-await-in-loop
      assert.equal(hidden.length, unknown.length, `${method} ${path}`);
      assert.deepEqual(hidden, unknown, `${method} ${path}`);
      if (method !== 'GET') assert.deepEqual(hidden, [{ method, summary: '404' }]);
    }
  } finally { await s.close(); }
});

test('rule 30: an unmanaged space is unchanged — the audit still refuses deactivating and uninstalling to a support session', async () => {
  const s = await serve({ managed: false });
  try {
    const answer = await s.ask('POST', '/plugins/linen/deactivate');
    assert.equal(answer.status, 403);
    assert.match(answer.text, /SUPPORT_FORBIDDEN/);
    assert.equal((await s.ask('DELETE', '/plugins/linen')).status, 403);
    assert.equal(s.logged.length, 2);
  } finally { await s.close(); }
});

test('rule 35: the Paramètres summary has no plugins line on an operator-managed space, and keeps it elsewhere', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE properties (id INTEGER); CREATE TABLE platforms (id INTEGER); CREATE TABLE terms_versions (version INTEGER); CREATE TABLE options (archivedAt TEXT); CREATE TABLE resources (id INTEGER); CREATE TABLE establishment_closures (endDate TEXT); CREATE TABLE users (isActive INTEGER)');
  const deps = (manageable) => ({
    db, settings: () => ({}), platformAvailable: () => false, plugins: () => [{ id: 'linen', state: 'active', setup: { needed: false } }],
    appVersion: () => '1.0.0', twoFactorEnabled: () => false, today: () => '2026-10-28', pluginsManageable: () => manageable,
  });
  assert.equal(buildSummary(deps(false), null).lines['/parametres/plugins'], undefined);
  assert.ok(buildSummary(deps(true), null).lines['/parametres/plugins']);
});

test('rule 30: the audit\'s lifecycle matcher covers exactly the routes the guard protects', () => {
  const guard = require('../middleware/requireSelfManagedPlugins');
  const routes = require('../routes/plugins').stack.filter((l) => l.route).map((l) => ({
    method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path.replace(':id', 'linen'), guarded: l.route.stack[0].handle === guard,
  }));
  assert.ok(routes.some((r) => r.guarded) && routes.some((r) => !r.guarded));
  routes.forEach((r) => assert.equal(guard.isLifecycle(r.method, `/plugins${r.path === '/' ? '' : r.path}`), r.guarded, `${r.method} ${r.path}`));
});
