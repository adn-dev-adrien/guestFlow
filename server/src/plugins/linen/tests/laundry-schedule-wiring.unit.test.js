// specs/linen-laundry-days.md §4.1 + §4.3 — the schedule routes as the loader mounts them behind the
// `linen` plugin: answered only while it is active, backed by the migrated table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const SRC = path.join(__dirname, '..', '..', '..');
const registry = require('../../sdk/registry');
const loader = require('../../loader');
const linenModule = require('..');
const { applyPluginSchema } = require('../../sdk/testing');
const { buildModel: buildPluginSettingsModel } = require(path.join(SRC, 'models/pluginSettingsModel'));
const { buildModel: buildPluginsModel } = require(path.join(SRC, 'models/pluginsModel'));
const { ensurePluginsTable, ensurePluginSettingsTable } = require(path.join(SRC, 'utils/pluginsSchema'));

const SCHEMA = fs.readFileSync(path.join(SRC, 'schema.sql'), 'utf8');

function boot({ installed }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('INSERT INTO app_settings (id) VALUES (1)');
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  ensurePluginsTable(db);
  ensurePluginSettingsTable(db);
  registry.reset();
  const plugins = buildPluginsModel(db);
  if (installed) plugins.install('linen');
  registry.configure({ isActive: (id) => plugins.isActive(id), allows: () => true });
  const settingsModel = buildPluginSettingsModel(db);
  loader.registerAll({ db, modules: [linenModule], settingsModel: () => settingsModel, isInstalled: (id) => Boolean(plugins.get(id)) });
  if (installed) applyPluginSchema(db, 'linen');
  const app = express();
  app.use(express.json());
  loader.mountApi(app);
  return { app, db, plugins };
}

test.afterEach(() => registry.reset());

async function request(app, method, url, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('specs/linen-laundry-days.md §4.3: the schedule routes answer 404 while the plugin is not installed', async () => {
  const { app } = boot({ installed: false });
  for (const [method, url] of [['GET', '/api/laundry/schedule'], ['PUT', '/api/laundry/schedule'], ['POST', '/api/laundry/schedule/preview']]) {
    const res = await request(app, method, url, method === 'GET' ? undefined : { weekdays: [2], turnaroundDays: 1 });
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.deepEqual(res.body, { error: 'PLUGIN_INACTIVE', plugin: 'linen' });
  }
});

test('specs/linen-laundry-days.md §3.1 rule 4: a fresh install answers { Tuesday, 1 day } and no pending version', async () => {
  const { app } = boot({ installed: true });
  const res = await request(app, 'GET', '/api/laundry/schedule');
  assert.equal(res.status, 200);
  assert.equal(res.body.current.effectiveFrom, '0001-01-01');
  assert.deepEqual(res.body.current.weekdays, [2]);
  assert.equal(res.body.current.turnaroundDays, 1);
  assert.equal(res.body.pending, null);
  assert.match(res.body.tomorrow, /^\d{4}-\d{2}-\d{2}$/);
});

test('specs/linen-laundry-days.md §3.1 rule 5: PUT then GET round-trips the pending version, a refusal is a 400 and the preview writes nothing', async () => {
  const { app, db } = boot({ installed: true });
  const saved = await request(app, 'PUT', '/api/laundry/schedule', { weekdays: [4, 2], turnaroundDays: 2 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.pending.weekdays, [2, 4]);
  const read = await request(app, 'GET', '/api/laundry/schedule');
  assert.deepEqual(read.body.pending.weekdays, [2, 4]);
  assert.equal(read.body.pending.effectiveFrom, read.body.tomorrow);
  assert.deepEqual(read.body.current.weekdays, [2]);

  const refused = await request(app, 'PUT', '/api/laundry/schedule', { weekdays: [], turnaroundDays: 2 });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'LAUNDRY_WEEKDAYS_EMPTY');

  const rows = () => db.prepare('SELECT COUNT(*) AS n FROM laundry_schedule_versions').get().n;
  const before = rows();
  const preview = await request(app, 'POST', '/api/laundry/schedule/preview', { weekdays: [1, 3], turnaroundDays: 5 });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.cycle.length, 2);
  assert.equal(rows(), before);
});
