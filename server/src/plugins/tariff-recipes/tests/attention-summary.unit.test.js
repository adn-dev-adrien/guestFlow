// specs/shell-and-home-day-first.md rule 6 — the attention subject of this plugin: titles, plurals and
// severities come from the server.

const test = require('node:test');
const assert = require('node:assert/strict');

const attention = require('../attention');

test('rule 6: recipes — a blocking run is a todo, an informative one an info', () => {
  assert.equal(attention.summarize({ runs: [{ blocking: 0 }], missingEvents: [] }).severity, 'info');
  assert.equal(attention.summarize({ runs: [{ blocking: 1 }], missingEvents: [] }).severity, 'todo');
  assert.equal(attention.summarize({ runs: [], missingEvents: [{}] }).detail, '1 point à relire');
});
