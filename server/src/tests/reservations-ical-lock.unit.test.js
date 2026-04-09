const test = require('node:test');
const assert = require('node:assert/strict');

const reservationsRoute = require('../routes/reservations');

const { computeNextIcalSyncLocked } = reservationsRoute.__test;

test('computeNextIcalSyncLocked enables lock after manual edit for iCal reservations', () => {
  assert.equal(computeNextIcalSyncLocked({ sourceType: 'ical', icalSyncLocked: 0 }), 1);
  assert.equal(computeNextIcalSyncLocked({ sourceType: 'ical', icalSyncLocked: 1 }), 1);
});

test('computeNextIcalSyncLocked keeps manual reservations unchanged', () => {
  assert.equal(computeNextIcalSyncLocked({ sourceType: 'manual', icalSyncLocked: 0 }), 0);
  assert.equal(computeNextIcalSyncLocked({ sourceType: 'manual', icalSyncLocked: 1 }), 1);
  assert.equal(computeNextIcalSyncLocked(null), 0);
});
