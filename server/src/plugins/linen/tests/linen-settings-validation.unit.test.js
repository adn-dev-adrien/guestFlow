// The linen settings' validators, moved from the core settings validation with the settings
// (specs/plugins-phase-2-hosts.md rule 15), plus the freeze of `laundryWeekday`.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateLaundryWeekday } = require('../settings');

// The laundry weekday is frozen since the laundry schedule (specs/linen-laundry-days.md §3.5 rule 26): the
// generic settings write refuses it and says where the laundry days are set now.
test('specs/linen-laundry-days.md rule 26: validateLaundryWeekday refuses any value and points to the schedule endpoint, empty stays a no-op', () => {
  for (const value of [0, 2, 6, '4', 9, -1, 2.5, 'mardi']) {
    assert.match(validateLaundryWeekday(value), /PUT \/api\/laundry\/schedule/, String(value));
  }
  assert.equal(validateLaundryWeekday(null), null);
  assert.equal(validateLaundryWeekday(''), null);
});
