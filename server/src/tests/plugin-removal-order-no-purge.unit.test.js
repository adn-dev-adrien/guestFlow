// specs/plugin-operator-provisioning.md rule 40 — an order the licence marks `removal: true` (the
// console's « Désinstaller » of a module it showed with no data) uninstalls WITHOUT erasing, and a
// plugin whose data count threw is published as unknown, never as « no data ».
const test = require('node:test');
const { skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');

const { space } = require('./pluginOperatorFixture');

const withLinenData = { linen: { tables: ['linen_stock'], describe: () => ['3 pièces de stock'] } };
const silently = (fn) => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};

test('rule 40: a removal order uninstalls the plugin and keeps its tables and rows', { skip: skipWithout(['linen']) }, async () => {
  const s = space({ installed: [['linen', false]], active: [], eraseOrders: [{ order: 'o-1', id: 'linen', removal: true }], data: withLinenData });
  s.db.prepare('INSERT INTO linen_stock (n) VALUES (4)').run();
  await s.reconciler.run();
  assert.equal(s.model.get('linen'), null);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM linen_stock').get().n, 1);
  assert.equal(s.provisioning.erased('o-1'), true);
});

test('rule 40: an order without the flag, or with removal false, still erases the data', { skip: skipWithout(['linen']) }, async () => {
  for (const extra of [{}, { removal: false }]) {
    const s = space({ installed: [['linen', false]], active: [], eraseOrders: [{ order: 'o-2', id: 'linen', ...extra }], data: withLinenData });
    await s.reconciler.run();
    assert.equal(s.model.get('linen'), null);
    assert.equal(s.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'linen_stock'").get(), undefined);
  }
});

test('rule 40: a plugin whose data description throws is published as unknown, not as empty', { skip: skipWithout(['linen']) }, async () => {
  const data = { linen: { tables: ['linen_stock'], describe: () => { throw new Error('boom'); } } };
  const s = space({ installed: [['linen', false]], active: [], data });
  const view = silently(() => s.controller.views().find((v) => v.id === 'linen'));
  assert.equal(view.dataUnknown, true);
  assert.deepEqual(view.data, []);
  await silently(() => s.reconciler.run());
  const stored = s.db.prepare("SELECT value FROM plugin_provisioning_meta WHERE key = 'facts:linen'").get();
  assert.equal(JSON.parse(stored.value).dataUnknown, true);
});
