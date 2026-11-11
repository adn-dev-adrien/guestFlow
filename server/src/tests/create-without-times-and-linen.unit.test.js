// Spec review 2026-10-27 — two creation invariants read on what is actually stored:
//   - specs/reservations-backend-mvc.md rule 9: a stay posted without times takes the property's
//     default check-in / check-out, not 15:00 / 10:00;
//   - specs/bed-config-in-linen-card.md rule 12: the « no linen → beds zeroed » invariant reads the
//     lines the engine kept, so a linen option not offered on the property takes the beds with it.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

test('POST without times stores the property defaults (16:00 / 11:00)', () => {
  const body = f.stayBody({ startDate: f.inDays(150), endDate: f.inDays(152) });
  delete body.checkInTime; delete body.checkOutTime;
  const res = f.create(body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = f.rowOf(res.body.id);
  assert.equal(row.checkInTime, '16:00');
  assert.equal(row.checkOutTime, '11:00');
});

test('…so its first re-save bills no « Arrivée anticipée »', async () => {
  const body = f.stayBody({ startDate: f.inDays(154), endDate: f.inDays(156) });
  delete body.checkInTime; delete body.checkOutTime;
  const id = f.create(body).body.id;
  const before = f.rowOf(id).finalPrice;
  assert.equal((await f.save(id, { notes: 'x' })).statusCode, 200);
  assert.equal(f.rowOf(id).finalPrice, before);
});

test('a linen option the property does not offer leaves no bed counts behind', () => {
  const id = f.createStay({ startDate: f.inDays(159), endDate: f.inDays(161), options: [{ optionId: 52, quantity: 1 }], singleBeds: 1, doubleBeds: 1 });
  const row = f.rowOf(id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = 52').get(id).n, 0);
  assert.equal(row.singleBeds, 0);
  assert.equal(row.doubleBeds, 0);
});

test('an offered linen option keeps the bed counts', () => {
  const id = f.createStay({ startDate: f.inDays(164), endDate: f.inDays(166), options: [{ optionId: 51, quantity: 1 }], singleBeds: 1, doubleBeds: 1 });
  const row = f.rowOf(id);
  assert.equal(row.singleBeds, 1);
  assert.equal(row.doubleBeds, 1);
});
