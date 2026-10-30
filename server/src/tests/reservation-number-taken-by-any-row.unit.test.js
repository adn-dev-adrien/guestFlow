// specs/reservation-number-and-search.md rule 16 (spec review 2026-10-27) — the « number already
// taken » check covers every row the unique index covers (cancelled stays and devis included), so a
// reused number is refused with the French 400, never by the index.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

test('the number of a cancelled stay is refused with the French 400', () => {
  const id = f.createStay({ startDate: f.inDays(180), endDate: f.inDays(182), reservationNumber: '202701555' });
  f.db.prepare("UPDATE reservations SET cancelledAt = datetime('now') WHERE id = ?").run(id);
  const res = f.create(f.stayBody({ startDate: f.inDays(189), endDate: f.inDays(191), reservationNumber: '202701555' }));
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'RESERVATION_NUMBER_TAKEN');
});

test('a number held by a devis row is refused with the French 400', () => {
  const id = f.createStay({ startDate: f.inDays(199), endDate: f.inDays(201) });
  f.db.prepare("UPDATE reservations SET kind = 'devis', reservationNumber = '202701777' WHERE id = ?").run(id);
  const res = f.create(f.stayBody({ startDate: f.inDays(211), endDate: f.inDays(213), reservationNumber: '202701777' }));
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'RESERVATION_NUMBER_TAKEN');
});
