// specs/shell-and-home-day-first.md rule 6 — the attention subject of this plugin: titles, plurals and
// severities come from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const attention = require('../attention');

test('rule 6: gate keys — count, title, detail and severity', () => {
  assert.deepEqual(attention.summarize({ failures: [{}, {}], stale: true }),
    { count: 3, title: 'Clés portail', detail: 'Sowel ne lit plus les clés · 2 clés en échec', severity: 'urgent' });
  assert.equal(attention.summarize({ failures: [], stale: false }), null);
});
