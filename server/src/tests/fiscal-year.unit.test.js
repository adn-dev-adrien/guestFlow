const test = require('node:test');
const assert = require('node:assert/strict');

// specs/fiscal-year-and-nights-sold.md §3.1 — the exercise ends on the last day of the configured
// CLOSING month and starts the day after. Pure arithmetic: every function takes its reference date as
// a parameter, so nothing here depends on the wall clock.
const fy = require('../utils/fiscalYear');

// ── bounds & labels ──────────────────────────────────────────────────────────────────────

test('closing September → 1 Oct N-1 … 30 Sep N, labelled « 2025-2026 »', () => {
  assert.deepEqual(fy.boundsForEndYear(9, 2026), {
    key: 2026, label: '2025-2026', from: '2025-10-01', to: '2026-09-30',
  });
});

test('closing December → the calendar year, labelled with the single year', () => {
  assert.deepEqual(fy.boundsForEndYear(12, 2026), {
    key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31',
  });
});

test('closing February → the last day is 28 or 29 depending on the year, never hard-coded', () => {
  assert.equal(fy.boundsForEndYear(2, 2024).to, '2024-02-29'); // leap
  assert.equal(fy.boundsForEndYear(2, 2025).to, '2025-02-28');
  assert.equal(fy.boundsForEndYear(2, 2025).from, '2024-03-01');
});

test('closing January → a one-month-shifted exercise (1 Feb … 31 Jan)', () => {
  assert.deepEqual(fy.boundsForEndYear(1, 2026), {
    key: 2026, label: '2025-2026', from: '2025-02-01', to: '2026-01-31',
  });
});

// ── which exercise contains a date ───────────────────────────────────────────────────────

test('closing September: 30/09 closes the exercise, 01/10 opens the next one', () => {
  assert.equal(fy.containing(9, '2026-09-30').key, 2026);
  assert.equal(fy.containing(9, '2026-10-01').key, 2027);
  // …and the boundary dates are the exercise bounds themselves.
  assert.equal(fy.containing(9, '2026-09-30').to, '2026-09-30');
  assert.equal(fy.containing(9, '2026-10-01').from, '2026-10-01');
});

test('closing September: a January date belongs to the exercise that closes THAT year', () => {
  assert.equal(fy.containing(9, '2026-01-15').key, 2026);
  assert.equal(fy.containing(9, '2026-01-15').from, '2025-10-01');
});

test('closing December: the exercise is the date own calendar year, boundaries included', () => {
  assert.equal(fy.containing(12, '2026-01-01').key, 2026);
  assert.equal(fy.containing(12, '2026-12-31').key, 2026);
});

test('containing(): an unparseable date yields null rather than a bogus exercise', () => {
  assert.equal(fy.containing(9, ''), null);
  assert.equal(fy.containing(9, 'jamais'), null);
  assert.equal(fy.containing(9, null), null);
});

// ── invalid closing months degrade to the calendar year ──────────────────────────────────

test('an out-of-range / non-integer closing month degrades to December', () => {
  for (const bad of [0, 13, -3, 9.5, null, undefined, '', 'septembre', NaN]) {
    assert.equal(fy.normaliseEndMonth(bad), 12, `expected ${String(bad)} to degrade to 12`);
  }
  // …and the degradation flows through the bounds, so a corrupt setting still reports a real year.
  assert.deepEqual(fy.boundsForEndYear(99, 2026).from, '2026-01-01');
});

test('a numeric string closing month is accepted as-is (form values arrive as strings)', () => {
  assert.equal(fy.normaliseEndMonth('9'), 9);
  assert.equal(fy.boundsForEndYear('9', 2026).from, '2025-10-01');
});

// ── resolve(): explicit key vs the exercise of today ─────────────────────────────────────

test('resolve() honours an explicit key, whatever today is', () => {
  assert.equal(fy.resolve(9, { key: 2024, today: '2026-08-12' }).key, 2024);
  assert.equal(fy.resolve(9, { key: '2024', today: '2026-08-12' }).from, '2023-10-01');
});

test('resolve() falls back to the current exercise on an absent or nonsense key', () => {
  // specs/fiscal-year-and-nights-sold.md §3.5 rule 24 — a hand-edited URL degrades, never 400s.
  for (const key of [undefined, null, '', 'abc', 0, 1999, 12345]) {
    assert.equal(fy.resolve(9, { key, today: '2026-08-12' }).key, 2026, `key=${String(key)}`);
  }
});

// ── list(): the selector's options ───────────────────────────────────────────────────────

test('list() spans the data range, newest first, current one flagged', () => {
  const out = fy.list(9, { minDate: '2024-11-02', maxDate: '2026-08-01', today: '2026-08-12' });
  assert.deepEqual(out.map((e) => e.label), ['2025-2026', '2024-2025']);
  assert.deepEqual(out.map((e) => e.isCurrent), [true, false]);
});

test('list() widens to a future exercise when reservations already point into it', () => {
  const out = fy.list(9, { minDate: '2026-08-01', maxDate: '2027-03-01', today: '2026-08-12' });
  assert.deepEqual(out.map((e) => e.key), [2027, 2026]);
  assert.equal(out.find((e) => e.key === 2026).isCurrent, true);
});

test('list() on an empty database still offers the current exercise', () => {
  const out = fy.list(9, { minDate: null, maxDate: null, today: '2026-08-12' });
  assert.deepEqual(out.map((e) => e.label), ['2025-2026']);
  assert.equal(out[0].isCurrent, true);
});
