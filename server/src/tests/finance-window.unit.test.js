const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 1-2 — the window of the Suivi financier: the exercise, one
// of its months, or a custom du / au; an invalid custom window is refused with the page's message.
const { resolveWindow, MESSAGES } = require('../utils/financeWindow');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

/** `YYYY-MM-DD`, `days` after today: a custom window lies within five years of today (rule 13 of reservations-backend-mvc). */
const inDays = (days) => addDaysToIsoDate(todayIso(), days);
const frDay = (iso) => iso.split('-').reverse().join('/');

// date-literal-ok: the exercise and its months are inputs of the pure window function, no date window reads them
const EXERCISE = { key: 2026, label: '2025-2026', from: '2025-10-01', to: '2026-09-30' };

test('rule 1 — « Exercice » is the whole exercise', () => {
  assert.deepEqual(resolveWindow({ exercise: EXERCISE }).window, { kind: 'fy', from: '2025-10-01', to: '2026-09-30', label: 'Exercice 2025-2026' }); // date-literal-ok: the exercise, echoed
});

test('rule 1 — « Mois » is a month of the exercise, to its last day', () => {
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'month', month: '2026-02' }).window,
    { kind: 'month', from: '2026-02-01', to: '2026-02-28', month: '2026-02', label: 'février 2026' }); // date-literal-ok: a month of the exercise
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'month', month: '2026-10' }).error, MESSAGES.badMonth);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'month', month: 'n' }).error, MESSAGES.badMonth);
});

test('rules 1-2 — « Personnalisée » takes two real dates, start before end', () => {
  const [from, to] = [inDays(-125), inDays(-64)];
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to }).window,
    { kind: 'custom', from, to, label: `du ${frDay(from)} au ${frDay(to)}` });
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: inDays(-63), to: inDays(-94) }).error, MESSAGES.reversed);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: inDays(-63) }).error, MESSAGES.missingDates);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from: '2026-02-30', to: inDays(-60) }).error, MESSAGES.missingDates);
  assert.equal(MESSAGES.reversed, 'La date de début doit précéder la date de fin.');
});

test('rule 2 — an unknown kind is refused', () => {
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'week' }).ok, false);
});
