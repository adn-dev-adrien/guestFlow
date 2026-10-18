const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/todayController');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

// specs/upcoming-reservations-cards.md rule 7 — the pages that open « on today » start from the
// server's calendar day. Between midnight and 2 a.m. in Paris the UTC date is still yesterday: the
// dashboard and the planning used to open on it (review #8, n-1).

test('rule 7 — GET /api/today answers the server calendar day', () => {
  let body = null;
  buildController({ today: () => '2026-10-18' }).getToday({}, { json: (b) => { body = b; } });
  assert.deepEqual(body, { today: '2026-10-18' });
});

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

test('rule 7 — every signed-in role may read it, the reception home included', () => {
  const { isSelfPath } = enforceRoleAccess.__test;
  assert.equal(isSelfPath('/today'), true);
  for (const roles of [['reception'], ['accountant']]) {
    let passed = false;
    enforceRoleAccess({ user: { roles }, path: '/today', method: 'GET' }, { status: () => ({ json: () => {} }) }, () => { passed = true; });
    assert.equal(passed, true, roles.join());
  }
});
