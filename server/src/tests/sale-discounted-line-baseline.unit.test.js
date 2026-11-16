// specs/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-8, 2026-11-16) — a line's own discount (rule 39) is weighed by the baseline as the
// engine weighs it: net. A line discounted before the arrival, or at an open arrival, no longer freezes the started stay (before: every later sale
// was refused 400 ARRIVAL_EXTRAS_FROZEN « reduced »), and a discounted line moved to the arrival keeps its money there (before: 409 MOMENT_NOT_AVAILABLE).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const money = (id) => [Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)];
const panier = [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }];

for (const [where, time] of [['before the arrival', '10:00'], ['at the open arrival', '18:00']]) {
  test(`T3-8 — a line discounted ${where}: once the arrival is validated, a sale still goes through and moves only its line`, () => {
    const id = stay(20);
    const sold = extraSale.sell(id, panier, { now: at(id, '12:00', -3) });
    const ref = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
    assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now: at(id, time) }).status, 200);
    assert.deepEqual(money(id), [3500, 0]);
    db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
    const later = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '19:00') });
    assert.equal(later.status, 200, JSON.stringify(later.body));
    assert.deepEqual(money(id), [3500, 600]);
  });
}

test('T3-8 — a departure line discounted then moved to the arrival takes its net amount there, and moves back', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const now = at(id, '12:00', 1);
  const sold = extraSale.sell(id, panier, { now });
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref;
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  assert.deepEqual(money(id), [0, 3500]);
  const moved = extraSale.changeLine(id, ref, { collectAt: 'arrival' }, { now });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(money(id), [3500, 0]);
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'departure' }, { now }).status, 200);
  assert.deepEqual(money(id), [0, 3500]);
});
