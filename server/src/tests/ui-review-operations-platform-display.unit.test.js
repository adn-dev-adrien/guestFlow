// specs/ui-review-2026-10-19-operations.md rule 15 — one source for a platform's display name: the
// server, with the reservation list.
const test = require('node:test');
const assert = require('node:assert/strict');

const { platformDisplay } = require('../utils/platformDisplay');

test('rule 15 — the reservation list carries the display name the calendar prints', () => {
  assert.equal(platformDisplay('GitesDeFrance'), 'Gîtes de France');
  assert.equal(platformDisplay('greengo'), 'GreenGo');
  assert.equal(platformDisplay('abracadaroom'), 'Abracadaroom');
  assert.equal(platformDisplay('direct'), 'Direct');
  assert.equal(platformDisplay(''), '');
});
