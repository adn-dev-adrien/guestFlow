// specs/outside-booking-sas.md rule 39 (loop t1 UI-15) — the end of a sale link's validity is labelled by the server in Europe/Paris, whatever zone the screen runs in.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const { expiresLabelOf } = require('../utils/standaloneSaleLinks');

test('UI-15 — « JJ/MM à HH:MM » in Paris time, from an ISO instant or a stored SQLite UTC time; nothing for nothing', () => {
  assert.equal(expiresLabelOf('2026-11-16T13:30:00.000Z'), '16/11 à 14:30'); // date-literal-ok — input of a pure formatter, never compared with today
  assert.equal(expiresLabelOf('2026-07-01 22:15:00'), '02/07 à 00:15'); // date-literal-ok — input of a pure formatter, never compared with today
  assert.equal(expiresLabelOf(null), null);
  assert.equal(expiresLabelOf('not a date'), null);
});
