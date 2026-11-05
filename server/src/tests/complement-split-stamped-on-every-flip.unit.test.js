// specs/accounting-books-the-money-collected.md rule 16 (audit R22-6a, 2026-11-05) — every path that flips the arrival
// complement to paid stamps what it collected: the mark on the fiche is pinned by booked-complement-entry-frozen, here are
// the others. A complement already collected keeps its first stamp.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, rowOf, TODAY, NO_ACOMPTE, S, C, forced, fiche, pay,
} = require('./moneyLedgerFixture');
const model = require('../models/reservationsModel');

const FORCED_ONLY = {
  taxCents: 0, accommodationCents: 0, optionsCents: 2000, resourcesCents: 0, lines: [{ key: 'custom:forcée', label: 'Forcée', bucket: 'options', cents: 2000 }],
};
const unpaidComplement = () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  assert.equal(rowOf(stay.id).complementPaidSplit, null);
  return stay.id;
};
const stampOf = (id) => JSON.parse(rowOf(id).complementPaidSplit);

test('the arrival settle from the fiche stamps it', () => {
  const id = unpaidComplement();
  model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });
  assert.equal(rowOf(id).complementPaid, 1);
  assert.deepEqual(stampOf(id), FORCED_ONLY);
});

test('the arrival SAS stamps it', () => {
  const id = unpaidComplement();
  model.commitArrivalSas(id, { complementSettled: true });
  assert.equal(rowOf(id).complementPaid, 1);
  assert.deepEqual(stampOf(id), FORCED_ONLY);
});

test('the departure SAS stamps a complement recalled at the door', () => {
  const id = unpaidComplement();
  model.commitDepartureSas(id, { complementsSettled: true });
  assert.equal(rowOf(id).complementPaid, 1);
  assert.deepEqual(stampOf(id), FORCED_ONLY);
});

test('a save of the model that writes the flip stamps it', () => {
  const id = unpaidComplement();
  const row = rowOf(id);
  const quote = {
    totalPrice: row.totalPrice, touristTaxRate: row.touristTaxRate, touristTaxTotal: row.touristTaxTotal, discountPercent: 0, finalPrice: row.finalPrice,
    depositAmount: row.depositAmount, depositDueDate: null, balanceAmount: row.balanceAmount, balanceDueDate: null, complementAmount: row.complementAmount,
  };
  const payload = {
    propertyId: row.propertyId, clientId: row.clientId, startDate: row.startDate, endDate: row.endDate, adults: row.adults, platform: row.platform,
    balancePaid: 1, balancePaidDate: row.balancePaidDate, complementPaid: true, complementPaidDate: TODAY,
  };
  model.updateReservation(id, payload, quote, { blocksPreviousNight: 0, blocksNextNight: 0 }, 0, { keepPricing: true });
  assert.equal(rowOf(id).complementPaid, 1);
  assert.deepEqual(stampOf(id), FORCED_ONLY);
});

test('a complement already collected keeps its first stamp, whichever path passes again', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  const first = rowOf(stay.id).complementPaidSplit;
  db.prepare("UPDATE reservation_custom_options SET amount = 90 WHERE reservationId = ? AND description = 'Forcée'").run(stay.id);
  model.commitArrivalSas(stay.id, { complementSettled: true });
  assert.equal(rowOf(stay.id).complementPaidSplit, first);
});
