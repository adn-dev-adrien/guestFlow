const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 1-2 — the window of the Suivi financier: the exercise, one
// of its months, or a custom du / au; an invalid custom window is refused with the page's message.
const { resolveWindow, MESSAGES } = require('../utils/financeWindow');

const EXERCISE = { key: 2026, label: '2025-2026', from: '2025-10-01', to: '2026-09-30' };

test('rule 1 — « Exercice » is the whole exercise', () => {
  assert.deepEqual(resolveWindow({ exercise: EXERCISE }).window, { kind: 'fy', from: '2025-10-01', to: '2026-09-30', label: 'Exercice 2025-2026' });
});

test('rule 1 — « Mois » is a month of the exercise, to its last day', () => {
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'month', month: '2026-02' }).window,
    { kind: 'month', from: '2026-02-01', to: '2026-02-28', month: '2026-02', label: 'février 2026' });
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'month', month: '2026-10' }).error, MESSAGES.badMonth);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'month', month: 'n' }).error, MESSAGES.badMonth);
});

test('rules 1-2 — « Personnalisée » takes two real dates, start before end', () => {
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: '2026-07-01', to: '2026-08-31' }).window,
    { kind: 'custom', from: '2026-07-01', to: '2026-08-31', label: 'du 01/07/2026 au 31/08/2026' });
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: '2026-09-01', to: '2026-08-01' }).error, MESSAGES.reversed);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: '2026-09-01' }).error, MESSAGES.missingDates);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: '2026-02-30', to: '2026-03-01' }).error, MESSAGES.missingDates);
  assert.equal(MESSAGES.reversed, 'La date de début doit précéder la date de fin.');
});

test('rule 2 — an unknown kind is refused', () => {
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'week' }).ok, false);
});
