// specs/pricing-components.md §3 rule 93 (loop t1 S-6) — a sale to the arrival leaves the instalment plan of a direct stay as it stands, even
// when the stay stores a plan the engine of today would restate at another figure.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

const plan = (id) => db.prepare('SELECT number, amountCents FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id).map((r) => r.amountCents);

test('S-6 — a stay storing a 310 € plan (the engine restates 300 €) keeps its three instalments through a sale to the arrival', () => {
  const id = stay(30);
  db.prepare('UPDATE reservations SET balanceAmount = 310, finalPrice = 310, totalPrice = 310 WHERE id = ?').run(id);
  const add = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, ?, ?, ?, 0)');
  [10334, 10333, 10333].forEach((cents, i) => add.run(id, i + 1, addDaysToIsoDate(todayIso(), 5 + i * 5), cents));
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], {});
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.collectAt, 'arrival');
  assert.deepEqual(plan(id), [10334, 10333, 10333], 'no instalment row is rewritten');
});
