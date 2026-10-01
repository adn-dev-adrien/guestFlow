// The linen settings' validators, moved from the core settings validation with the settings
// (specs/plugins-phase-2-hosts.md rule 15). Assertions unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateLaundryWeekday } = require('../settings');

// Weekly bed-linen tracking — laundry weekday validator (specs/weekly-bed-linen-tracking.md §4.3).
test('validateLaundryWeekday accepts 0..6 and null/empty as no-op', () => {
  for (let i = 0; i <= 6; i++) {
    assert.equal(validateLaundryWeekday(i), null, `weekday ${i} should be valid`);
  }
  assert.equal(validateLaundryWeekday(null), null);
  assert.equal(validateLaundryWeekday(''), null);
});

test('validateLaundryWeekday rejects out-of-range and non-integer values', () => {
  assert.match(validateLaundryWeekday(-1), /entre 0/);
  assert.match(validateLaundryWeekday(7), /entre 0/);
  assert.match(validateLaundryWeekday(2.5), /entre 0/);
  assert.match(validateLaundryWeekday('mardi'), /entre 0/);
});
