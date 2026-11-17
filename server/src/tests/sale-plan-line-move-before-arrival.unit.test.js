// specs/pricing-components.md §3 rule 95 (stabilisation loop t4, S4-5, 2026-11-16) — before the stay clock reaches the arrival, a stay whose extras are
// carved out early (its arrival complement collected) still never moves a plan or arrival line to the departure: `saleDetail` serves it no departure
// moment and the line API refuses it (409 MOMENT_NOT_AVAILABLE). A line the sale stamped `departure` keeps its way there and back.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const { stampComplementPaidSplit } = require('../utils/complementPaidSplit');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);

function earlyComplement() {
  const id = stay(20);
  const plan = extraSale.sell(id, [{ articleRef: 'custom', label: 'Ménage', amount: 80 }], { now: at(id, '12:00', -5) });
  assert.equal(plan.status, 200);
  db.prepare("UPDATE reservation_custom_options SET inComplement = 0, collectAt = 'plan', collectAtDefault = 'plan' WHERE reservationId = ? AND description = 'Ménage'").run(id);
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = ?').run(addDaysToIsoDate(row(id).startDate, -4), id);
  stampComplementPaidSplit(db, id);
  return id;
}

test('S4-5 — before the arrival, a plan line of a stay carved out early has no departure moment and is not moved there', () => {
  const id = earlyComplement();
  const now = at(id, '12:00', -3);
  const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.label === 'Ménage');
  assert.equal(line.collectAt, 'plan');
  assert.deepEqual([line.moments.includes('departure'), line.movable], [false, false]);
  const moved = extraSale.changeLine(id, line.ref, { collectAt: 'departure' }, { now });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.code, 'MOMENT_NOT_AVAILABLE');
});

test('S4-5 — a line the sale stamped at the departure (a baseline stored before the arrival) goes to the arrival and back', () => {
  const id = stay(20);
  db.prepare("UPDATE reservations SET arrivalExtrasBaseline = '{}' WHERE id = ?").run(id);
  const now = at(id, '12:00', -3);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Cidre', amount: 12 }], { now });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.collectAt, 'departure');
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Cidre').ref;
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'arrival' }, { now }).status, 200);
  const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.ref === ref);
  assert.deepEqual([line.collectAt, line.moments.includes('departure')], ['arrival', true]);
  const back = extraSale.changeLine(id, ref, { collectAt: 'departure' }, { now });
  assert.equal(back.status, 200, JSON.stringify(back.body));
});
