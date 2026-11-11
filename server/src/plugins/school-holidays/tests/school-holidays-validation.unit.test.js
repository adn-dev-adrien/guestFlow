const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePeriod } = require('../validation');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

/** `YYYY-MM-DD`, `days` after today: the dates of this suite hang on it (specs/server-test-isolation.md rule 6). */
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

// ---------- validatePeriod ----------

test('validatePeriod: all three zones configured returns null', () => {
  assert.equal(
    validatePeriod({
      label: 'Toussaint',
      zoneA_start: inDays(-17), zoneA_end: inDays(-2),
      zoneB_start: inDays(-17), zoneB_end: inDays(-2),
      zoneC_start: inDays(-17), zoneC_end: inDays(-2),
    }),
    null,
  );
});

test('validatePeriod: only Zone A configured returns null', () => {
  assert.equal(
    validatePeriod({
      label: 'Local',
      zoneA_start: inDays(-17), zoneA_end: inDays(-2),
    }),
    null,
  );
});

test('validatePeriod: missing label rejected', () => {
  const err = validatePeriod({ zoneA_start: inDays(-17), zoneA_end: inDays(-2) });
  assert.match(err, /libellé/);
});

test('validatePeriod: empty/whitespace label rejected', () => {
  const err = validatePeriod({ label: '   ', zoneA_start: inDays(-17), zoneA_end: inDays(-2) });
  assert.match(err, /libellé/);
});

test('validatePeriod: start without end rejected per zone', () => {
  const err = validatePeriod({ label: 'X', zoneA_start: inDays(-17) });
  assert.match(err, /Zone A/);
});

test('validatePeriod: end without start rejected per zone', () => {
  const err = validatePeriod({ label: 'X', zoneB_end: inDays(-2) });
  assert.match(err, /Zone B/);
});

test('validatePeriod: start > end rejected mentioning "postérieure"', () => {
  const err = validatePeriod({
    label: 'X',
    zoneA_start: inDays(-2), zoneA_end: inDays(-17),
  });
  assert.match(err, /postérieure/);
});

test('validatePeriod: start === end is valid (one-day holiday)', () => {
  assert.equal(
    validatePeriod({ label: 'X', zoneA_start: inDays(-17), zoneA_end: inDays(-17) }),
    null,
  );
});

test('validatePeriod: all three zones empty rejected mentioning "au moins une zone"', () => {
  const err = validatePeriod({ label: 'X' });
  assert.match(err, /au moins une zone/);
});
