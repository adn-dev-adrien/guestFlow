// specs/ds-sweep-planning.md rule 28 — GET /api/today is the server's date (Europe/Paris), readable by
// every signed-in role: the Dashboard and the Planning of the reception and the accountant start from it.
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
