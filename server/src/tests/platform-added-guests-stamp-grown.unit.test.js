// The addition above what the declared row held (audit R23-DB-1):
//   specs/platform-added-guests-tourist-tax.md rule 29 — a row of its own for the difference; the merged case stands.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, rowOf, save, seed, createStay, mark } = require('./ledgerFixture');
const financeModel = require('../models/financeModel');
const { todayIso, localIsoDate } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TODAY = todayIso();
// Every stay sits inside one month, from the 5th of the month after next, so the page read is the month of all its nights
// whatever today is (audit R24-S2: a stay ending on the 1st had no night on its end month's page).
const ANCHOR = (() => { const today = new Date(); return localIsoDate(new Date(today.getFullYear(), today.getMonth() + 2, 5)); })();
seed();
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
  VALUES (3, 'Gite', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300)").run();
db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();
const finance = financeModel.buildModel(db);

let slot = 0;
async function collectedThenTicked(t, adults = 3) {
  const start = slot * 3;
  slot += 1;
  const stay = { propertyId: 3, platform: 'Canal', platformGrossAmount: 600, startDate: addDaysToIsoDate(ANCHOR, start), endDate: addDaysToIsoDate(ANCHOR, start + 2) };
  const id = createStay(stay);
  assert.equal((await save(id, { ...stay, adults })).statusCode, 200);
  mark(id, { balancePaid: true, balancePaidDate: TODAY });
  mark(id, { complementPaid: true, complementPaidDate: TODAY });
  afterStay(t, id, () => assert.equal(finance.setTouristTaxDeclared({ reservationId: id, declared: true }).ok, true));
  return { id, stay };
}
// D16: a tick waits for the day after the stay; the saves that follow in these cases happen before it.
function afterStay(t, id, run) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${rowOf(id).endDate}T12:00:00`).getTime() + 86400000 });
  try { return run(); } finally { t.mock.timers.reset(); }
}
function pageOf(t, id) {
  const month = rowOf(id).startDate.slice(0, 7);
  return afterStay(t, id, () => finance.getTouristTaxExtraction({ month }).data);
}
const rowsOf = (data, id) => data.reservations.filter((r) => r.reservationId === id);
const main = (data, id) => rowsOf(data, id).find((r) => !r.addedGuestsRow);
const own = (data, id) => rowsOf(data, id).find((r) => r.addedGuestsRow);
const reCollect = (id) => mark(id, { complementPaid: true, complementPaidDate: TODAY });

test('rule 29: the addition grown after the tick: the declared row keeps its amount, the difference has its own row', async (t) => {
  const { id, stay } = await collectedThenTicked(t);
  assert.equal(rowOf(id).touristTaxDeclaredWithAddedAmount, 2.4);
  assert.equal(rowsOf(pageOf(t, id), id).length, 1);

  mark(id, { complementPaid: false });
  assert.equal((await save(id, { ...stay, adults: 4, balancePaid: true, balancePaidDate: TODAY })).statusCode, 200);
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 4.8);
  reCollect(id);

  const data = pageOf(t, id);
  assert.equal(rowsOf(data, id).length, 2);
  const told = main(data, id);
  assert.equal(told.taxAmount, 7.2);
  assert.equal(told.adults, 3);
  assert.equal(told.adultNights, 6);
  assert.equal(told.taxRate, 1.2);
  assert.ok(told.touristTaxDeclaredAt);
  const rest = own(data, id);
  assert.equal(rest.taxAmount, 2.4);
  assert.equal(rest.adults, 1);
  assert.equal(rest.adultNights, 2);
  assert.equal(rest.taxRate, 1.2);
  assert.equal(rest.touristTaxDeclaredAt, null);
  assert.equal(data.totals.taxAmount, 9.6);
  assert.equal(data.totals.reservationsCount, 1);
  assert.equal(rowOf(id).touristTaxDeclaredWithAddedAmount, 2.4, 'the stamp is not moved');

  assert.equal(afterStay(t, id, () => finance.setTouristTaxDeclared({ reservationId: id, declared: true, addedGuests: true })).ok, true);
  assert.ok(own(pageOf(t, id), id).touristTaxDeclaredAt);
});

test('rule 29: re-collected unchanged, one row: the merged case stands', async (t) => {
  const { id } = await collectedThenTicked(t);
  mark(id, { complementPaid: false });
  reCollect(id);
  const data = pageOf(t, id);
  assert.equal(rowsOf(data, id).length, 1);
  assert.equal(main(data, id).taxAmount, 7.2);
  assert.equal(main(data, id).adults, 3);
  assert.equal(afterStay(t, id, () => finance.setTouristTaxDeclared({ reservationId: id, declared: true, addedGuests: true })).status, 409);
});

test('rule 29: a stamp above the new amount stays silent: one row, lowered, no own row', async (t) => {
  const { id, stay } = await collectedThenTicked(t, 4);
  assert.equal(rowOf(id).touristTaxDeclaredWithAddedAmount, 4.8);
  mark(id, { complementPaid: false });
  assert.equal((await save(id, { ...stay, adults: 3, balancePaid: true, balancePaidDate: TODAY, forceOverpayment: true })).statusCode, 200);
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 2.4);
  reCollect(id);
  const data = pageOf(t, id);
  assert.equal(rowsOf(data, id).length, 1);
  assert.equal(main(data, id).taxAmount, 7.2);
});

test('rule 29: a stamp of 0 reads as before: the whole addition on its own row', async (t) => {
  const { id } = await collectedThenTicked(t);
  db.prepare('UPDATE reservations SET touristTaxDeclaredWithAddedAmount = 0 WHERE id = ?').run(id);
  const data = pageOf(t, id);
  assert.equal(main(data, id).taxAmount, 4.8);
  assert.equal(main(data, id).adults, 2);
  assert.equal(own(data, id).taxAmount, 2.4);
  assert.equal(own(data, id).adults, 1);
});
