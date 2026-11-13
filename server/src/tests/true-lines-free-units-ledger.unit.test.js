// specs/pricing-components.md §3 rules 41 and 85 — the free units of an article belong to the ARTICLE: the lines of a stay that sold it twice
// share one allowance, counted once (never once per line). An article on one line is priced exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./trueLinesFixture');
const extraSale = require('../utils/extraSale');
const { createFreeUnitsLedger } = require('../utils/pricing/allowances');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const pack = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Petit-déjeuner offert', 10, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(pack);
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (9301, ?, 10, 2)').run(pack);

function stay(offset) {
  const startDate = addDaysToIsoDate(todayIso(), offset);
  const endDate = addDaysToIsoDate(startDate, 3);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(startDate, endDate).lastInsertRowid);
}
const rows = (id) => db.prepare('SELECT quantity, totalPrice, allowanceUsed FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, pack);

test('rule 85 — the ledger hands an article’s allowance to its lines in order: what one took, the next does not get again', () => {
  const options = new Map([[pack, { freeUnits: 2 }]]);
  const ledger = createFreeUnitsLedger({ lockedTariff: null, optionsById: options, lockedOptionsById: new Map(), isDirectBooking: true });
  assert.equal(ledger.remainingFreeUnitsFor(pack), 2);
  ledger.takeFreeUnits(pack, 1);
  assert.equal(ledger.remainingFreeUnitsFor(pack), 1);
  assert.equal(ledger.grantedFreeUnitsFor(pack), 2, 'the grant itself (the tariff snapshot’s) is not consumed');
  ledger.takeFreeUnits(pack, 5);
  assert.equal(ledger.remainingFreeUnitsFor(pack), 0, 'never negative');
  assert.equal(ledger.remainingFreeMinutesFor(7, 60), 60);
  ledger.takeFreeMinutes(7, 45);
  assert.equal(ledger.remainingFreeMinutesFor(7, 60), 15);
});

test('rules 41, 85 — two sales of an article that grants two free units: 2 units free in all, never 2 per line', () => {
  const id = stay(31);
  const sale = (quantity) => extraSale.sell(id, [{ articleRef: `option:${pack}`, quantity }], { source: 'fiche' });
  assert.equal(sale(1).status, 200);
  assert.equal(sale(2).status, 200);
  assert.equal(sale(1).status, 200);
  const stored = rows(id);
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map((r) => r.totalPrice), [0, 10, 10], 'units 1 and 2 are free, units 3 and 4 are billed: 2 units free in all');
  assert.deepEqual(stored.map((r) => (r.allowanceUsed ? JSON.parse(r.allowanceUsed).freeUnits : 0)), [1, 1, 0]);
});

test('rule 41 — an article sold once keeps the whole allowance on its line', () => {
  const id = stay(32);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${pack}`, quantity: 3 }], { source: 'fiche' }).status, 200);
  assert.deepEqual(rows(id).map((r) => r.totalPrice), [10]);
});
