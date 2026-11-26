// specs/pricing/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-3, 2026-11-16) — the arrival SAS recap lists what the arrival complement
// collects: a line moved to the departure is not listed, a line discounted on the fiche is listed at its net amount, and the lines add up to the
// total the SAS asks. Stays booked 20 days ahead (`saleRound1Fixtures`, check-in 15:00).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const recap = (id, now) => {
  const plan = withNow(now, () => reservations.planArrivalSas(id, {}));
  return { lines: plan.lines.map((l) => [l.label, l.real, l.billed]), total: plan.arrivalComplementTotal };
};
const soldBeforeArrival = (id) => extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) })
  .saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;

test('T3-3 — a line moved to the departure at the open arrival is not in the arrival recap', () => {
  const id = stay(20);
  const ref = soldBeforeArrival(id);
  const door = at(id, '18:00');
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'departure' }, { now: door }).status, 200);
  assert.deepEqual(recap(id, door), { lines: [], total: 0 });
});

test('T3-3 — a line discounted on the fiche is listed at what the complement collects', () => {
  const id = stay(20);
  const ref = soldBeforeArrival(id);
  const now = at(id, '10:00');
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  assert.deepEqual(recap(id, now), { lines: [['Panier du terroir', 35, 35]], total: 35 });
});
