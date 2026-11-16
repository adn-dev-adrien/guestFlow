// specs/pricing-components.md §3 rule 103 d (stabilisation loop t4, D4-1, 2026-11-16) — the baseline of an arrival line follows the line's own
// discount both ways. Before, `fitArrivalBaseline` only lowered it: a discount reduced or removed at an open arrival left the baseline at the
// old net, so the arrival complement collected the line whole and the departure billed the given-back part a second time (45 € + 16 € for a
// 45 € line and a 6 € beer).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const money = (id) => [Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)];
const baseline = (id) => JSON.parse(row(id).arrivalExtrasBaseline || 'null');
const panier = [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }];
const KEY = 'custom:panier du terroir';

function soldPanier() {
  const id = stay(20);
  const sold = extraSale.sell(id, panier, { now: at(id, '12:00', -3) });
  return { id, ref: sold.saleDetail.lines.find((l) => l.label === 'Panier du terroir').ref };
}

for (const [where, time] of [['before the arrival', '10:00'], ['at the open arrival', '18:00']]) {
  for (const [label, then, expected] of [['removed', 0, 4500], ['reduced 10 → 5', 5, 4000]]) {
    test(`D4-1 — a discount ${label} ${where}: the arrival collects the line once, the departure only the later sale`, () => {
      const { id, ref } = soldPanier();
      assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now: at(id, time) }).status, 200);
      assert.equal(extraSale.changeLine(id, ref, { discount: { amount: then } }, { now: at(id, time) }).status, 200);
      assert.deepEqual(money(id), [expected, 0]);
      db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
      const later = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '19:00') });
      assert.equal(later.status, 200, JSON.stringify(later.body));
      assert.deepEqual(money(id), [expected, 600]);
      assert.equal(baseline(id)[KEY], expected / 100);
    });
  }
}

test('D4-1 — a line wholly at the arrival: a discount comes off the arrival baseline, and comes back there when removed', () => {
  const { id, ref } = soldPanier();
  db.prepare('UPDATE reservations SET arrivalExtrasBaseline = ? WHERE id = ?').run(JSON.stringify({ [KEY]: 45 }), id);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 20 } }, { now: at(id, '18:00') }).status, 200);
  assert.equal(baseline(id)[KEY], 25);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 0 } }, { now: at(id, '18:00') }).status, 200);
  assert.equal(baseline(id)[KEY], 45);
});
