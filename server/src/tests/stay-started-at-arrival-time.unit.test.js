// specs/lock-at-arrival-time-and-arrival-complement-lines.md rule 1 — the fiche locks when the stay
// has started: the arrival time on the arrival day, or earlier once the arrival is marked.
const test = require('node:test');
const assert = require('node:assert/strict');

const { hasStayStarted } = require('../utils/arrivalMoment');
const { midStayExtrasWindow, buildEditLock } = require('../utils/midStayExtrasWindow');

const TODAY = '2026-11-13';
const row = (over = {}) => ({ kind: 'reservation', startDate: TODAY, checkInTime: '16:00', ...over });

test('the day before the arrival the stay has not started, whatever the clock says', () => {
  assert.equal(hasStayStarted(row({ startDate: '2026-11-14' }), TODAY, '23:59'), false);
});

test('on the arrival day it starts at the check-in time, not at midnight', () => {
  assert.equal(hasStayStarted(row(), TODAY, '00:00'), false);
  assert.equal(hasStayStarted(row(), TODAY, '15:59'), false);
  assert.equal(hasStayStarted(row(), TODAY, '16:00'), true);
  assert.equal(hasStayStarted(row(), TODAY, '21:00'), true);
});

test('an arrival day without a check-in time starts at 00:00', () => {
  assert.equal(hasStayStarted(row({ checkInTime: null }), TODAY, '00:00'), true);
});

test('a marked check-in or a completed arrival SAS starts the stay early', () => {
  assert.equal(hasStayStarted(row({ checkInDone: 1 }), TODAY, '09:00'), true);
  assert.equal(hasStayStarted(row({ arrivalSasDoneAt: '2026-11-13 09:00:00' }), TODAY, '09:00'), true);
});

test('a check-in time written « 9:00 » or « 09h00 » is read; an unreadable one starts at 00:00', () => {
  assert.equal(hasStayStarted(row({ checkInTime: '9:00' }), TODAY, '08:59'), false);
  assert.equal(hasStayStarted(row({ checkInTime: '09h00' }), TODAY, '09:00'), true);
  assert.equal(hasStayStarted(row({ checkInTime: 'soir' }), TODAY, '00:00'), true);
});

test('a later day is always started', () => {
  assert.equal(hasStayStarted(row({ startDate: '2026-11-12' }), TODAY, '00:00'), true);
});

test('the read lock (editLock) and the window agree on the boundary', () => {
  assert.equal(midStayExtrasWindow(row(), TODAY, '15:59').locked, false);
  assert.equal(midStayExtrasWindow(row(), TODAY, '15:59').extrasEditable, false);
  assert.equal(midStayExtrasWindow(row(), TODAY, '16:00').extrasEditable, true);
  assert.equal(buildEditLock(row(), TODAY, '{}', [], '15:59').locked, false);
  assert.equal(buildEditLock(row(), TODAY, '{}', [], '16:00').locked, true);
});
