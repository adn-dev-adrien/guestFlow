// specs/plugin-operator-provisioning.md rules 31–34 — the reconciler's erase orders follow the same
// settled rule as the other steps, out-of-plan dependants do not hold it back, an older licence never
// replaces a newer one, and the closing pass leaves an erase failure on record.
const test = require('node:test');
const assert = require('node:assert/strict');

const { space } = require('./pluginOperatorFixture');
const { BLOCKED_RETRY_MS } = require('../utils/pluginReconciler');

const withPairData = { 'website-booking': { tables: ['linen_stock'], describe: () => ['3 pièces'] } };

test('rule 31: an erase order refused by a dependant is blocked, kept on record, and retried hourly — not each minute', async () => {
  const s = space({
    installed: [['website-booking', false], ['google-vacation-rentals', false]], active: [],
    eraseOrders: [{ order: 'o-1', id: 'website-booking' }], data: withPairData,
  });
  let attempts = 0;
  const uninstall = s.controller.uninstall;
  s.controller.uninstall = (req, res) => { attempts += 1; return uninstall(req, res); };
  const rec = s.rebuild();
  await rec.run();
  const row = s.provisioning.get('website-booking');
  assert.equal(row.outcome, 'blocked');
  assert.match(row.message, /Nécessaire à/);
  assert.equal(s.provisioning.erased('o-1'), false);
  await rec.run();
  await rec.run();
  assert.equal(attempts, 1, 'the line survives the closing pass, so the order is settled');
  assert.equal(s.provisioning.get('website-booking').outcome, 'blocked');
  s.clock.t = new Date(s.clock.t.getTime() + BLOCKED_RETRY_MS);
  await rec.run();
  assert.equal(attempts, 2);
});

test('rule 31: a failed erase waits for a new licence', async () => {
  const s = space({ installed: [['linen', false]], active: [], eraseOrders: [{ order: 'o-2', id: 'linen' }], data: { linen: { tables: ['linen_stock'], describe: () => ['x'] } } });
  let attempts = 0;
  s.controller.uninstall = async (req, res) => { attempts += 1; return res.status(500).json({ error: 'PLUGIN_PURGE_FAILED', message: 'Échec de l’effacement : rien n’a été effacé.' }); };
  const rec = s.rebuild();
  await rec.run();
  await rec.run();
  assert.equal(attempts, 1);
  assert.equal(s.provisioning.get('linen').outcome, 'failed');
  s.clock.t = new Date(s.clock.t.getTime() + 3 * BLOCKED_RETRY_MS);
  await rec.run();
  assert.equal(attempts, 1, 'a failure is not retried by time');
  s.licence.state.issuedAt = '2026-10-29T08:00:00.000Z';
  await rec.run();
  assert.equal(attempts, 2);
});

test('rule 32: a dependant the licence does not allow does not hold a deactivation or an erase back', async () => {
  const s = space({
    installed: ['website-booking', 'google-vacation-rentals'], plugins: ['website-booking'], active: [],
    eraseOrders: [{ order: 'o-3', id: 'website-booking' }], data: withPairData,
  });
  await s.reconciler.run();
  assert.equal(s.model.get('website-booking'), null, 'deactivated and erased');
  assert.equal(s.provisioning.erased('o-3'), true);
  assert.equal(s.model.get('google-vacation-rentals').enabled, true, 'the out-of-plan one keeps its stored state');
});

test('rule 32: an allowed dependant still blocks, as before', async () => {
  const s = space({ installed: ['website-booking', 'google-vacation-rentals'], active: ['google-vacation-rentals'] });
  s.licence.state.active = ['google-vacation-rentals'];
  await s.reconciler.run();
  assert.equal(s.model.get('website-booking').enabled, true);
});

test('rule 33: an older licence put back in place is skipped, a newer one is applied', async () => {
  const s = space({ installed: ['linen'], active: ['linen'] });
  s.licence.state.issuedAt = '2026-10-28T10:00:00.000Z';
  await s.reconciler.run();
  assert.equal(s.provisioning.highestIssuedAt(), '2026-10-28T10:00:00.000Z');
  s.licence.state.active = [];
  s.licence.state.issuedAt = '2026-10-28T09:00:00.000Z';
  const out = await s.reconciler.run();
  assert.deepEqual(out, { skipped: true, reason: 'older licence' });
  assert.equal(s.model.get('linen').enabled, true, 'the replay changed nothing');
  s.licence.state.issuedAt = '2026-10-28T11:00:00.000Z';
  await s.reconciler.run();
  assert.equal(s.model.get('linen').enabled, false);
  assert.equal(s.provisioning.highestIssuedAt(), '2026-10-28T11:00:00.000Z');
});

test('rule 33: the same licence is read again and again', async () => {
  const s = space({ installed: ['linen'], active: ['linen'] });
  await s.reconciler.run();
  const out = await s.reconciler.run();
  assert.equal(out.skipped, false);
});

test('rule 34: the closing pass does not touch a plugin the licence does not allow', async () => {
  const s = space({ installed: ['linen', 'neat'], plugins: ['linen'], active: ['linen'] });
  s.provisioning.record({ pluginId: 'neat', desired: 'active', outcome: 'failed', code: 'X', message: 'm', licenceIssuedAt: 'old', at: '2026-10-01T00:00:00.000Z' });
  await s.reconciler.run();
  assert.equal(s.provisioning.get('neat').outcome, 'failed');
});
