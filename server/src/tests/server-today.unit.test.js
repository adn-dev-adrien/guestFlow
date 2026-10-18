// specs/ds-sweep-planning.md rule 28 — GET /api/today is the server's date (Europe/Paris), readable by
// every signed-in role: the Dashboard and the Planning of the reception and the accountant start from it
// (specs/upcoming-reservations-cards.md rule 7 too).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

test('rule 28 — GET /api/today answers the server date, and every role may read it', async () => {
  const app = express();
  let roles = ['reception'];
  app.use('/api', (req, res, next) => { req.user = { roles }; next(); }, enforceRoleAccess);
  app.use('/api/today', require('../routes/today'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/today`;
  for (const held of [['reception'], ['accountant'], ['admin']]) {
    roles = held;
    const res = await fetch(url);
    assert.equal(res.status, 200, held.join());
    const body = await res.json();
    assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.today, getTodayIsoDate());
  }
  await new Promise((resolve) => server.close(resolve));
});

// specs/upcoming-reservations-cards.md rule 7 — between midnight and 2 a.m. in Paris the UTC date is
// still yesterday: the dashboard and the planning used to open on it (review #8, n-1).
test('rule 7 — at 01:54 in Paris the day is already the 18th, though UTC still reads the 17th', (t) => {
  const before = process.env.TZ;
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-17T23:54:00Z') });
  try {
    process.env.TZ = 'Europe/Paris';
    assert.equal(new Date().toISOString().slice(0, 10), '2026-10-17');
    assert.equal(getTodayIsoDate(), '2026-10-18');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
  assert.equal(process.env.TZ, before);
});
