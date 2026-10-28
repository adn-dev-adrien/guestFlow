// specs/plugin-operator-provisioning.md rule 23 — an erase order travels in the licence, is executed
// once, only on an installed plugin the operator no longer wants, through the existing purge.
const test = require('node:test');
const assert = require('node:assert/strict');

const { space } = require('./pluginOperatorFixture');

const withLinenData = { linen: { tables: ['linen_stock'], describe: () => ['3 pièces de stock'] } };

test('rule 23: an order on an inactive installed plugin erases its data once and uninstalls it', async () => {
  const s = space({ installed: [['linen', false]], active: [], eraseOrders: [{ order: 'o-1', id: 'linen' }], data: withLinenData });
  await s.reconciler.run();
  assert.equal(s.model.get('linen'), null);
  assert.equal(s.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'linen_stock'").get(), undefined);
  assert.equal(s.provisioning.get('linen').eraseOrder, 'o-1');
  assert.equal(s.provisioning.erased('o-1'), true);
});

test('rule 23: the same order never runs twice, even if the plugin comes back', async () => {
  const s = space({ installed: [['linen', false]], active: [], eraseOrders: [{ order: 'o-1', id: 'linen' }], data: withLinenData });
  await s.reconciler.run();
  s.db.exec('CREATE TABLE linen_stock (id INTEGER PRIMARY KEY, n INTEGER)');
  s.db.prepare('INSERT INTO linen_stock (n) VALUES (9)').run();
  s.model.install('linen', { source: 'bundled', manifest: null });
  s.model.setEnabled('linen', false);
  await s.reconciler.run();
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_stock').get().n, 1);
  assert.notEqual(s.model.get('linen'), null);
});

test('rule 23: refused while the plugin is wanted active', async () => {
  const s = space({ installed: ['linen'], active: ['linen'], eraseOrders: [{ order: 'o-2', id: 'linen' }], data: withLinenData });
  s.db.prepare('INSERT INTO linen_stock (n) VALUES (1)').run();
  await s.reconciler.run();
  assert.equal(s.provisioning.erased('o-2'), false);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_stock').get().n, 1);
  assert.equal(s.model.get('linen').enabled, true);
});

test('rule 23: an order on a plugin that is not installed is settled without touching anything', async () => {
  const s = space({ installed: [], active: [], eraseOrders: [{ order: 'o-3', id: 'linen' }], data: withLinenData });
  s.db.prepare('INSERT INTO linen_stock (n) VALUES (1)').run();
  await s.reconciler.run();
  assert.equal(s.provisioning.erased('o-3'), true);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_stock').get().n, 1);
});

test('rule 23: the plugin is deactivated and erased in the same pass when the operator switched it off', async () => {
  const s = space({ installed: ['linen'], active: [], eraseOrders: [{ order: 'o-4', id: 'linen' }], data: withLinenData });
  await s.reconciler.run();
  assert.equal(s.model.get('linen'), null);
  assert.equal(s.provisioning.erased('o-4'), true);
});

test('rule 23: a plugin that keeps no data is simply left uninstalled', async () => {
  const s = space({ installed: [['sas', false]], active: [], eraseOrders: [{ order: 'o-5', id: 'sas' }] });
  await s.reconciler.run();
  assert.equal(s.model.get('sas'), null);
  assert.equal(s.provisioning.erased('o-5'), true);
});
