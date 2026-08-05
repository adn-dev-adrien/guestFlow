// specs/reception-sas-today-only.md §3.1 — the « Accueil » role only handles the SAS of the DAY:
// window = [D 00:00, D+1 04:00). The 4-hour tail covers a check-in validated after midnight and an
// early check-out, without ever opening the following day's arrivals.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SAS_WINDOW_END_HOUR, isWithinSasWindow, sasLockReason } = require('../utils/sasEditWindow');

// Local-time Date builder so the tests don't depend on the runner's timezone.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('the tolerance is a single tunable constant', () => {
  assert.equal(SAS_WINDOW_END_HOUR, 4);
});

test('isWithinSasWindow — the whole day of D is inside', () => {
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 4, 0, 0)), true);
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 4, 15, 12)), true);
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 4, 23, 59)), true);
});

test('isWithinSasWindow — the tail runs to D+1 04:00 exclusive', () => {
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 5, 0, 15)), true);
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 5, 3, 59)), true);
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 5, 4, 0)), false);
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 5, 4, 1)), false);
});

test('isWithinSasWindow — the day before is outside', () => {
  assert.equal(isWithinSasWindow('2026-08-04', at(2026, 8, 3, 23, 59)), false);
});

test('isWithinSasWindow — a missing / unusable date fails closed', () => {
  assert.equal(isWithinSasWindow(null, at(2026, 8, 4, 12)), false);
  assert.equal(isWithinSasWindow('', at(2026, 8, 4, 12)), false);
  assert.equal(isWithinSasWindow('pas-une-date', at(2026, 8, 4, 12)), false);
});

test('isWithinSasWindow — a datetime value is read on its day part', () => {
  assert.equal(isWithinSasWindow('2026-08-04 15:00:00', at(2026, 8, 4, 18)), true);
});

test('sasLockReason — inside the window and never committed → editable (null)', () => {
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt: null, now: at(2026, 8, 4, 16) }), null);
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt: null, now: at(2026, 8, 5, 2) }), null);
});

test('sasLockReason — before the day → future, after the tail → past', () => {
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt: null, now: at(2026, 8, 3, 20) }), 'future');
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt: null, now: at(2026, 8, 5, 9) }), 'past');
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt: null, now: at(2026, 9, 1, 9) }), 'past');
});

test('sasLockReason — « done » wins over every date reason', () => {
  const doneAt = '2026-08-04 15:12:00';
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt, now: at(2026, 8, 4, 16) }), 'done');
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt, now: at(2026, 8, 3, 10) }), 'done');
  assert.equal(sasLockReason({ dateIso: '2026-08-04', doneAt, now: at(2026, 8, 9, 10) }), 'done');
});

test('sasLockReason — an unusable date is locked as past, never editable', () => {
  assert.equal(sasLockReason({ dateIso: null, doneAt: null, now: at(2026, 8, 4, 16) }), 'past');
});

test('sasLockReason — a one-night stay opens each SAS on its own day', () => {
  const stay = { startDate: '2026-08-04', endDate: '2026-08-05' };
  const onArrivalDay = at(2026, 8, 4, 16);
  assert.equal(sasLockReason({ dateIso: stay.startDate, doneAt: null, now: onArrivalDay }), null);
  assert.equal(sasLockReason({ dateIso: stay.endDate, doneAt: null, now: onArrivalDay }), 'future');

  const onDepartureDay = at(2026, 8, 5, 10);
  assert.equal(sasLockReason({ dateIso: stay.startDate, doneAt: null, now: onDepartureDay }), 'past');
  assert.equal(sasLockReason({ dateIso: stay.endDate, doneAt: null, now: onDepartureDay }), null);
});
