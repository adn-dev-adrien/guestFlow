// specs/edit-reservation-blocked-by-overlap.md rule 5 (spec review 2026-10-27) — a check-in / check-out
// time change and a baby-bed increase on an existing fiche re-run the guards they can break.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

test('a departure moved past the next arrival + cleaning is refused (409), as on create', async () => {
  const a = f.createStay({ startDate: '2027-02-10', endDate: '2027-02-13' });
  f.createStay({ startDate: '2027-02-13', endDate: '2027-02-15' });
  const res = await f.save(a, { checkOutTime: '18:00' });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(f.rowOf(a).checkOutTime, '11:00');
});

test('an arrival moved before the previous departure + cleaning is refused (409)', async () => {
  f.createStay({ startDate: '2027-03-01', endDate: '2027-03-04' });
  const b = f.createStay({ startDate: '2027-03-04', endDate: '2027-03-06' });
  const res = await f.save(b, { checkInTime: '12:00' });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
});

test('a stay stored without times is not seen as moved when the fiche sends the property defaults', async () => {
  const a = f.createStay({ startDate: '2027-04-10', endDate: '2027-04-13' });
  const b = f.createStay({ startDate: '2027-04-13', endDate: '2027-04-15' });
  // A pre-existing conflict the edit did not introduce (an old iCal row with NULL times overlapping).
  f.db.prepare("UPDATE reservations SET checkInTime = NULL, checkOutTime = NULL WHERE id = ?").run(b);
  f.db.prepare("UPDATE reservations SET checkOutTime = '18:00' WHERE id = ?").run(a);
  const res = await f.save(b, { checkInTime: '16:00', checkOutTime: '11:00', notes: 'Finance only' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('a baby-bed increase re-runs the baby-bed check', async () => {
  const id = f.createStay({ startDate: '2027-05-10', endDate: '2027-05-12', babies: 1, babyBeds: 1 });
  const res = await f.save(id, { babyBeds: 2 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /lits bébé/i);
});
