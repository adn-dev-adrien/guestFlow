// specs/shell-and-home-day-first.md rule 6 — the attention subject of this plugin: titles, plurals and
// severities come from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const attention = require('../attention');

test('rule 6: the site — the quotes waiting', () => {
  assert.equal(attention.summarize({ alerts: [{}, {}, {}] }).detail, '3 devis en attente');
});
