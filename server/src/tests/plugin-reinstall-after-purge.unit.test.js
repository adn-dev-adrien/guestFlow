// specs/plugins-phase-4-registry.md rule 39 — a plugin installed again in the same process after an
// uninstall with erasure has its tables back (the install always runs the migrations; the ledger
// makes it idempotent), and a failed erasure tells what is true.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

// specs/plugin-removal-resilience.md rules 4, 5 — the controller installs only the ids of the shipped catalogue, so these
// tests borrow shipped plugins' ids: a tree without one has nothing to prove.
if (!requirePlugins(['linen'])) return;
const h = require('./pluginPackagesFixture');

const LINEN = {
  id: 'linen',
  serverCode: "module.exports = { id: 'linen', register(ctx) { ctx.migrations([{ name: 't1', up: (db) => db.exec('CREATE TABLE IF NOT EXISTS linen_t (id INTEGER)') }]); ctx.data({ tables: ['linen_t'], describe: () => [] }); } };",
};

test('rule 39: install, erase, install again without a restart brings the tables back', async () => {
  const s = h.realSetup([LINEN]);
  assert.equal((await h.call(s.ctrl.install, { params: { id: 'linen' } })).statusCode, 200);
  assert.equal(s.hasTable('linen_t'), true);
  assert.equal((await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: { purge: '1' } })).statusCode, 200);
  assert.equal(s.hasTable('linen_t'), false);
  const again = await h.call(s.ctrl.install, { params: { id: 'linen' } });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.state, 'active');
  assert.equal(s.hasTable('linen_t'), true);
});

test('rule 39: an uninstall without erasure then a reinstall keeps the data and runs no migration twice', async () => {
  const s = h.realSetup([LINEN]);
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  s.db.exec('INSERT INTO linen_t (id) VALUES (7)');
  await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: {} });
  assert.equal((await h.call(s.ctrl.install, { params: { id: 'linen' } })).statusCode, 200);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_t').get().n, 1);
});

test('rule 39: a failed file erasure after the database step says so, and a retry finishes the job', async () => {
  let failing = true;
  const s = h.realSetup([LINEN], { eraseData: () => { if (failing) throw new Error('EBUSY'); } });
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  const first = await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: { purge: '1' } });
  assert.equal(first.statusCode, 500);
  assert.equal(first.body.error, 'PLUGIN_PURGE_FAILED');
  assert.equal(s.hasTable('linen_t'), false);
  assert.doesNotMatch(first.body.message, /rien n’a été effacé/);
  assert.equal(s.model.get('linen').enabled, false);
  failing = false;
  const second = await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: { purge: '1' } });
  assert.equal(second.statusCode, 200);
  assert.equal(s.model.get('linen'), null);
});

test('rule 39: a failure before anything was erased keeps the « rien n’a été effacé » answer', async () => {
  const s = h.realSetup([{ ...LINEN, serverCode: LINEN.serverCode.replace("describe: () => []", "describe: () => [], purge: () => { throw new Error('boom'); }") }]);
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  const res = await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: { purge: '1' } });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.message, /rien n’a été effacé/);
  assert.equal(s.hasTable('linen_t'), true);
});

test('rule 39: activating after a partial erasure recreates the tables before the plugin runs', async () => {
  const s = h.realSetup([LINEN], { eraseData: () => { throw new Error('EBUSY'); } });
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  const first = await h.call(s.ctrl.uninstall, { params: { id: 'linen' }, query: { purge: '1' } });
  assert.equal(first.statusCode, 500);
  assert.equal(s.hasTable('linen_t'), false);
  const res = await h.call(s.ctrl.activate, { params: { id: 'linen' } });
  assert.equal(res.statusCode, 200);
  assert.equal(s.model.get('linen').enabled, true);
  assert.equal(s.hasTable('linen_t'), true);
});

test('rule 39: an activation whose migration fails answers PLUGIN_MIGRATION_FAILED and stays off', async () => {
  const bad = { id: 'linen', serverCode: "module.exports = { id: 'linen', register(ctx) { ctx.migrations([{ name: 't1', up: (db) => { if (globalThis.__linenBreak) throw new Error('nope'); db.exec('CREATE TABLE IF NOT EXISTS linen_t (id INTEGER)'); } }]); ctx.data({ tables: ['linen_t'], describe: () => [] }); } };" };
  const s = h.realSetup([bad]);
  await h.call(s.ctrl.install, { params: { id: 'linen' } });
  await h.call(s.ctrl.deactivate, { params: { id: 'linen' } });
  s.db.exec('DROP TABLE linen_t');
  s.db.prepare("DELETE FROM migrations WHERE name LIKE 'plugin:linen:%'").run();
  globalThis.__linenBreak = true;
  const original = console.error;
  console.error = () => {};
  const res = await h.call(s.ctrl.activate, { params: { id: 'linen' } });
  console.error = original;
  delete globalThis.__linenBreak;
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'PLUGIN_MIGRATION_FAILED');
  assert.equal(s.model.get('linen').enabled, false);
});
