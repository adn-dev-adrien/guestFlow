// specs/finance-dashboard-redesign.md rule 37 (review of PR #702, minor 3) — the « not before » bound of
// the arrival scheduling pairs the local hour with the local day. With the UTC day, between midnight and
// 02:00 in Paris it fell a day early.

const test = require('node:test');
const assert = require('node:assert/strict');

const { seed } = require('./hourlySchedulingFixture');
const { toAbsMinutes } = require('../availability');

test('rule 37 — at 00:30 local, « not before » is today 00:30, not yesterday', () => {
  const { scheduling } = seed();
  const now = new Date(2026, 9, 18, 0, 30);
  const { notBefore } = scheduling.stayBounds({ startDate: '2026-10-10', endDate: '2026-10-25', checkInTime: '16:00', checkOutTime: '10:00' }, now);
  assert.equal(notBefore, toAbsMinutes('2026-10-18', '00:30'));
});
