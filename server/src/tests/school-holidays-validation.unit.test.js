const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePeriod } = require('../utils/schoolHolidaysValidation');

// ---------- validatePeriod ----------

test('validatePeriod: all three zones configured returns null', () => {
  assert.equal(
    validatePeriod({
      label: 'Toussaint',
      zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
      zoneB_start: '2026-10-17', zoneB_end: '2026-11-01',
      zoneC_start: '2026-10-17', zoneC_end: '2026-11-01',
    }),
    null,
  );
});

test('validatePeriod: only Zone A configured returns null', () => {
  assert.equal(
    validatePeriod({
      label: 'Local',
      zoneA_start: '2026-10-17', zoneA_end: '2026-11-01',
    }),
    null,
  );
});

test('validatePeriod: missing label rejected', () => {
  const err = validatePeriod({ zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.match(err, /libellé/);
});

test('validatePeriod: empty/whitespace label rejected', () => {
  const err = validatePeriod({ label: '   ', zoneA_start: '2026-10-17', zoneA_end: '2026-11-01' });
  assert.match(err, /libellé/);
});

test('validatePeriod: start without end rejected per zone', () => {
  const err = validatePeriod({ label: 'X', zoneA_start: '2026-10-17' });
  assert.match(err, /Zone A/);
});

test('validatePeriod: end without start rejected per zone', () => {
  const err = validatePeriod({ label: 'X', zoneB_end: '2026-11-01' });
  assert.match(err, /Zone B/);
});

test('validatePeriod: start > end rejected mentioning "postérieure"', () => {
  const err = validatePeriod({
    label: 'X',
    zoneA_start: '2026-11-01', zoneA_end: '2026-10-17',
  });
  assert.match(err, /postérieure/);
});

test('validatePeriod: start === end is valid (one-day holiday)', () => {
  assert.equal(
    validatePeriod({ label: 'X', zoneA_start: '2026-10-17', zoneA_end: '2026-10-17' }),
    null,
  );
});

test('validatePeriod: all three zones empty rejected mentioning "au moins une zone"', () => {
  const err = validatePeriod({ label: 'X' });
  assert.match(err, /au moins une zone/);
});
