// specs/plugins/plugins-phase-3c-hourly-resources.md rule 17, plugin-removal-resilience (loop t1 D-4) — the purge warning names the visits' money held on their
// sale documents, and a document whose booking is gone stays on the counter: its « À rembourser » row is reachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const plugin = require('..');

test('D-4 — a visit paid 63 € with 13 € owed back is announced by the purge warning; once its booking is gone the counter still lists it', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(6300) } } })).body.visit;
  const beer = visit.lines.find((line) => line.label === 'Bière locale');
  await f.call('patchLine', { id, lineId: beer.id, body: { offered: true, confirmRefund: true } });
  if (!registry.get(plugin.id)) {
    registry.configure({ isActive: () => true, allows: () => true });
    plugin.register(createContext(plugin.id, { db: f.db }));
  }
  const lines = registry.get(plugin.id).data.describe(f.db);
  assert.ok(lines.some((l) => l.warning && /63,00 € encaissés sur leur vente, dont 13,00 € à rembourser/.test(l.label)), JSON.stringify(lines));
  assert.ok(!f.sales.counterSalesOwing().includes(visit.document.id), 'the visit\'s own screen reaches it while the booking exists');
  f.db.prepare('DELETE FROM resource_bookings WHERE id = ?').run(id);
  assert.ok(f.sales.counterSalesOwing().includes(visit.document.id));
});
