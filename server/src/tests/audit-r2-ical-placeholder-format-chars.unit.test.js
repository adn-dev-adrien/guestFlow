// specs/wordpress-plugin.md rule 32 (review of PR 859) — the iCal placeholder clients go through the same stripping.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveIcalClientIdentity } = require('../utils/icalParser');

test('rule 32: format characters are stripped from an iCal guest name and from the platform label', () => {
  assert.deepEqual(resolveIcalClientIdentity({ firstName: 'Cl​aire', lastName: 'Gar‮nier' }, 'x'), { firstName: 'Claire', lastName: 'Garnier' });
  assert.deepEqual(resolveIcalClientIdentity({ isFallback: true }, 'Air‮bnb'), { firstName: 'Ical', lastName: 'Airbnb' });
});
