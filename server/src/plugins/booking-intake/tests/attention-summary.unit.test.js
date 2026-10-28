// specs/shell-and-home-day-first.md rule 6 — the attention subject of this plugin: titles, plurals and
// severities come from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const attention = require('../attention');

test('rule 6: Booking — the urgent and the later subjects', () => {
  const pending = [{ urgent: true }, { urgent: false }, { urgent: false }];
  assert.deepEqual(attention.summarizeUrgent(pending),
    { count: 1, title: 'Réservations Booking à compléter, arrivée proche', detail: '1 fiche à compléter', severity: 'urgent' });
  assert.equal(attention.summarizeLater(pending).count, 2);
  assert.equal(attention.summarizeLater([]), null);
});
