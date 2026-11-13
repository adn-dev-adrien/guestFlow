// specs/pricing-components.md §3 rules 13, 14, 85 — the arrival SAS « Offrir » names ONE line: a ref `{ kind, id }` is the article's first line, a
// ref with `lineId` a later sale of it; the recap keys its lines the same way (`option:5`, `option:5:12`), so the client's choice reaches one row.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, bath, stayWithTwoSales, rowsOf } = require('./trueLinesFixture');
const reservations = require('../models/reservationsModel');

function stayInComplement() {
  const id = stayWithTwoSales();
  db.prepare('UPDATE reservation_options SET inComplement = 1 WHERE reservationId = ? AND optionId = ?').run(id, bath);
  db.prepare('UPDATE reservations SET complementAmount = 130, complementPaid = 0 WHERE id = ?').run(id);
  const [first, second] = rowsOf(id).filter((r) => r.optionId === bath).map((r) => r.lineId);
  return { id, first, second };
}
const state = (id) => db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath).map((r) => [r.offered, r.totalPrice]);

test('rule 85 — a ref without lineId offers the first line only, a ref with lineId offers that later line only', () => {
  const { id, second } = stayInComplement();
  reservations.commitArrivalSas(id, { offeredExtras: [{ kind: 'option', id: bath }] });
  assert.deepEqual(state(id), [[1, 0], [0, 90]]);
  reservations.commitArrivalSas(id, { offeredExtras: [{ kind: 'option', id: bath, lineId: second }] });
  assert.deepEqual(state(id), [[0, 40], [1, 0]], 'the authoritative set: the first line is billed again, the later one offered');
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 40, 'the complement moves by the real price of the line that changed state');
});

test('rule 85 — the recap keys each line: the first keeps option:<id>, a later one is option:<id>:<lineId>', () => {
  const { id, first, second } = stayInComplement();
  const plan = reservations.planArrivalSas(id, { offeredExtras: [{ kind: 'option', id: bath, lineId: second }] });
  const lines = plan.lines.filter((l) => l.group === 'existing' && l.key && l.key.startsWith('option:'));
  assert.deepEqual(lines.map((l) => [l.key, l.offered]), [[`option:${bath}`, false], [`option:${bath}:${second}`, true]]);
  assert.ok(first < second);
});
