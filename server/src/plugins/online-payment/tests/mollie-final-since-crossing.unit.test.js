// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 1 and 2 — a correction of the data that moves an estimated card
// payment ACROSS « Retenue appliquée depuis » decides again whether it carries a reserve, in both directions.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { createSplitsModel } = require('../reconciliation/molliePaymentSplits');
const { db, dayAt, build, reset } = require('./mollieFixture');

test.beforeEach(() => { reset(); registry.reset(); registry.configure({ isActive: () => true, allows: () => true }); });
test.afterEach(() => { registry.reset(); });

let sales = [];
const sale = (date) => ({
  key: 'resource-booking:9', date, totalCents: 1400, booksCents: 1400, cardCents: 1400, label: 'Bain nordique',
  client: { firstName: 'Marc', lastName: 'Gruat' }, vatRate: 10, invoiceNumber: null,
});
test('rule 2 — a sale moved from before to after the reserve start gets its reserve, and back', () => {
  sales = [sale(dayAt(-10))];
  createContext('hourly-resources', { db }).standaloneSales(() => sales);
  const { controller } = build({ startDate: dayAt(-120), settings: { mollieCardOnSiteSince: dayAt(-30), mollieReserveSince: dayAt(-5) } });
  const splits = createSplitsModel(db);
  const stored = () => splits.forSource('tender', 'sale:resource-booking:9');
  assert.equal(stored().reserveCents, 0, 'paid before the reserve began');
  sales = [sale(dayAt(-2))];
  controller.syncSplits();
  assert.deepEqual([stored().reserveCents, stored().immediateCents], [280, 1120], 'the correction crossed the start: the reserve applies');
  sales = [sale(dayAt(-9))];
  controller.syncSplits();
  assert.equal(stored().reserveCents, 0, 'and crossing back removes it');
});
