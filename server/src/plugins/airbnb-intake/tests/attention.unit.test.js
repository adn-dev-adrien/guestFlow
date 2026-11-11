// specs/airbnb-mail-intake.md rule 0 (inte/plugins note of 2026-10-26) and rule 15 — the Airbnb mails to
// check are one subject of the home, counted by the server (specs/shell-and-home-day-first.md rules 6, 9).
const test = require('node:test');
const assert = require('node:assert/strict');

const { summarize } = require('../attention');

test('rule 15: the mails to check become one « à faire » subject, counted by the server', () => {
  assert.deepEqual(summarize({ items: [{ id: 1 }, { id: 2 }] }), {
    count: 2, title: 'Mails Airbnb à vérifier', detail: '2 mails', severity: 'todo',
  });
  assert.equal(summarize({ items: [{ id: 1 }] }).detail, '1 mail');
});

test('rule 15: nothing to check, no subject', () => {
  assert.equal(summarize({ items: [] }), null);
  assert.equal(summarize(null), null);
});
