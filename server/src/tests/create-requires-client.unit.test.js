// specs/reservations-backend-mvc.md rule 10 (spec review 2026-10-27) — a stay posted without a client is
// refused with a French 400 before anything is written, instead of a 500 from the NOT NULL constraint.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

test('POST /reservations without clientId answers 400 CLIENT_REQUIRED and writes nothing', () => {
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const body = f.stayBody({ startDate: f.inDays(180), endDate: f.inDays(182) });
  delete body.clientId;
  const res = f.create(body);
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CLIENT_REQUIRED');
  assert.match(res.body.error, /client/i);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before);
});
