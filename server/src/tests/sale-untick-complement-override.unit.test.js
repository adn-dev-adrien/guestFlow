// specs/pricing-components.md §3 rule 103 (stabilisation loop t4, S4-2, 2026-11-16) — the check-in box unticked before the hour does not undo the false
// start of a stay whose arrival complement is the operator's own amount (`complementAmountOverride`): the override takes no line back, so the lines
// the start carved out keep their departure money. Before: the line went back to an arrival complement the override pinned, and 45 € landed in no bucket.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const money = (id) => [Math.round(row(id).complementAmount * 100), Math.round(row(id).endOfStayComplementAmount * 100)];
const patch = (id, body, now) => withNow(now, () => {
  let status = 200;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  controller.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
});

test('S4-2 — an overridden complement: unticked before the hour, the carved line keeps its departure money', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET complementAmountOverride = 20 WHERE id = ?').run(id);
  assert.equal(patch(id, { checkInDone: true }, at(id, '09:00')), 200);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '09:00') });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const eos = money(id)[1];
  assert.equal(patch(id, { checkInDone: false }, at(id, '09:30')), 200);
  assert.equal(money(id)[1], eos, 'the departure keeps the 45 €');
  const line = extraSale.saleDetailOf(id, at(id, '09:30')).lines.find((l) => l.label === 'Panier du terroir');
  assert.equal(line.collectAt, 'departure');
  assert.notEqual(row(id).arrivalExtrasBaseline, null);
});
