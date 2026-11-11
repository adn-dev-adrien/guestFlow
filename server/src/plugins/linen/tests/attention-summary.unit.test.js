// specs/shell-and-home-day-first.md rule 6 — the attention subject of this plugin: titles, plurals and
// severities come from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const attention = require('../attention');

test('rule 6: linen — the first shortage date, in the year only when it is not this one', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  assert.equal(attention.summarize({ shortagesByType: [{ firstShortageDate: '2026-10-23' }, { firstShortageDate: '2026-10-21' }] }, now).detail,
    '2 types en rupture à partir du 21 octobre');
  assert.equal(attention.summarize({ shortagesByType: [{ firstShortageDate: '2027-01-04' }] }, now).detail,
    '1 type en rupture à partir du 4 janvier 2027');
  assert.equal(attention.summarize({ shortagesByType: [] }), null);
});
