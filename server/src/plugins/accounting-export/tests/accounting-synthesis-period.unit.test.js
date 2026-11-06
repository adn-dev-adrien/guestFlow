// specs/accounting-synthesis.md §3 rules 1, 2 and 15 — the period of the synthesis and its chart buckets.
// The clock is pinned for the whole file: every date below is an input of pure functions whose « today » is
// that pinned day.
const test = require('node:test');
const assert = require('node:assert/strict');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 12) });

process.env.DB_PATH = ':memory:';
const sdk = require('../../sdk');
const { resolvePeriod, bucketsOf, granularityOf, isWholeMonths, monthsOf, isoWeek } = require('../synthesisPeriod');

const fiscalYear = sdk.coreModule('fiscalYear');
const { resolveWindow, MESSAGES } = sdk.coreModule('financeWindow');
const { dateWindowMessage, HORIZON_MESSAGE, PAST_HORIZON_MESSAGE } = sdk.coreModule('stayDates');

const TODAY = '2026-11-05';
const resolve = (query, fiscalEndMonth = 9) => resolvePeriod({
  query, today: TODAY, fiscalEndMonth, fiscalYear, resolveCustom: resolveWindow, dateWindowMessage,
});

test('rule 1 — a month, the current one by default', () => {
  const r = resolve({ period: 'month', month: '2026-02' });
  assert.equal(r.ok, true);
  assert.deepEqual(
    { kind: r.window.kind, from: r.window.from, to: r.window.to, label: r.window.label, granularity: r.window.granularity },
    { kind: 'month', from: '2026-02-01', to: '2026-02-28', label: 'février 2026', granularity: 'day' },
  );
  assert.equal(resolve({}).window.from, '2026-11-01', 'no period: the current month');
  assert.equal(resolve({ period: 'month' }).window.to, '2026-11-30');
  assert.equal(r.exercise.key, 2026, 'February 2026 lies in the exercise closing September 2026');
});

test('rule 1 — a calendar quarter, the current one by default', () => {
  const r = resolve({ period: 'quarter', quarter: '2026-Q3' });
  assert.deepEqual([r.window.from, r.window.to, r.window.label, r.window.granularity], ['2026-07-01', '2026-09-30', 'T3 2026', 'week']);
  assert.deepEqual([resolve({ period: 'quarter' }).window.from, resolve({ period: 'quarter' }).window.to], ['2026-10-01', '2026-12-31']);
});

test('rule 1 — the exercise of the app\'s closing month; an unusable key reads the current one', () => {
  const r = resolve({ period: 'fy', fiscalYear: '2026' });
  assert.deepEqual([r.window.from, r.window.to, r.window.label, r.window.granularity], ['2025-10-01', '2026-09-30', 'Exercice 2025-2026', 'month']);
  assert.equal(resolve({ period: 'fy', fiscalYear: 'abc' }).window.from, '2026-10-01');
  assert.equal(resolve({ period: 'fy' }).window.to, '2027-09-30');
  assert.equal(resolve({ period: 'fy', fiscalYear: '2026' }, 12).window.from, '2026-01-01', 'closing December: the calendar year');
});

test('rule 1 — a custom window, judged by the Suivi financier\'s own rule', () => {
  const r = resolve({ period: 'custom', from: '2026-03-10', to: '2026-04-20' });
  assert.deepEqual([r.window.from, r.window.to, r.window.label, r.window.granularity], ['2026-03-10', '2026-04-20', 'du 10/03/2026 au 20/04/2026', 'day']);
  assert.deepEqual(resolve({ period: 'custom', from: '2026-04-20', to: '2026-03-10' }), { ok: false, error: MESSAGES.reversed });
  assert.deepEqual(resolve({ period: 'custom', from: '2024-01-01', to: '2026-01-21' }), { ok: false, error: MESSAGES.tooWide }, '751 days');
  assert.equal(resolve({ period: 'custom', from: '2024-01-01', to: '2026-01-20' }).ok, true, '750 days');
  assert.deepEqual(resolve({ period: 'custom', from: '2026-02-30', to: '2026-03-10' }), { ok: false, error: MESSAGES.missingDates }, 'an impossible day');
  assert.deepEqual(resolve({ period: 'custom', from: ['2026-03-01'], to: '2026-03-10' }), { ok: false, error: MESSAGES.missingDates });
});

test('rule 1 — an unknown or malformed period is refused, never guessed', () => {
  for (const query of [
    { period: 'week' }, { period: ['month'] }, { period: 'month', month: '2026-13' }, { period: 'month', month: '2026-1' },
    { period: 'month', month: ['2026-01'] }, { period: 'quarter', quarter: '2026-Q5' }, { period: 'quarter', quarter: '2026Q1' },
    { period: 'fy', fiscalYear: ['2026'] },
  ]) {
    assert.deepEqual(resolve(query), { ok: false, error: 'Période inconnue.' }, JSON.stringify(query));
  }
});

test('rule 2 — a month or a quarter outside the entered-date window is refused, not clamped', () => {
  assert.deepEqual(resolve({ period: 'month', month: '2032-01' }), { ok: false, error: HORIZON_MESSAGE });
  assert.deepEqual(resolve({ period: 'quarter', quarter: '2021-Q3' }), { ok: false, error: PAST_HORIZON_MESSAGE });
  assert.deepEqual(resolve({ period: 'custom', from: '2031-12-01', to: '2031-12-10' }), { ok: false, error: HORIZON_MESSAGE });
});

test('rule 15 — granularity: a day for a month, a week for a quarter, a month for an exercise; a custom window by its width', () => {
  assert.equal(granularityOf('custom', '2026-01-01', '2026-03-04'), 'day', '62 days');
  assert.equal(granularityOf('custom', '2026-01-01', '2026-03-05'), 'week');
  assert.equal(granularityOf('custom', '2026-01-01', '2026-07-06'), 'week', '186 days');
  assert.equal(granularityOf('custom', '2026-01-01', '2026-07-07'), 'month');
});

test('rule 15 — buckets cover the window exactly, clipped at both ends', () => {
  const days = bucketsOf({ from: '2026-10-01', to: '2026-10-31', granularity: 'day' });
  assert.equal(days.length, 31);
  assert.deepEqual([days[0].label, days[30].label], ['1/10', '31/10']);

  const weeks = bucketsOf({ from: '2026-07-01', to: '2026-09-30', granularity: 'week' });
  assert.deepEqual(weeks[0], { key: '2026-07-01', label: 'S27', from: '2026-07-01', to: '2026-07-05' });
  assert.deepEqual(weeks[weeks.length - 1], { key: '2026-09-28', label: 'S40', from: '2026-09-28', to: '2026-09-30' });
  assert.equal(weeks.length, 14);
  for (let i = 1; i < weeks.length; i += 1) assert.equal(weeks[i].label, `S${27 + i}`);

  const months = bucketsOf({ from: '2025-10-01', to: '2026-09-30', granularity: 'month' });
  assert.equal(months.length, 12);
  assert.deepEqual([months[0].label, months[11].label], ['oct. 25', 'sept. 26'], 'two calendar years: the year is named, short (R5-04)');
  assert.deepEqual(bucketsOf({ from: '2026-01-15', to: '2026-03-10', granularity: 'month' }).map((b) => [b.label, b.from, b.to]),
    [['janv.', '2026-01-15', '2026-01-31'], ['févr.', '2026-02-01', '2026-02-28'], ['mars', '2026-03-01', '2026-03-10']]);
});

test('rule 8 — whole months, and the months a window touches', () => {
  assert.equal(isWholeMonths('2026-07-01', '2026-09-30'), true);
  assert.equal(isWholeMonths('2026-02-01', '2026-02-28'), true);
  assert.equal(isWholeMonths('2026-07-02', '2026-09-30'), false);
  assert.equal(isWholeMonths('2026-07-01', '2026-09-29'), false);
  assert.deepEqual(monthsOf('2025-11-20', '2026-02-03'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2027-01-01'), 53);
});
