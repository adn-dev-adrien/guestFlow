// specs/tourist-tax-report-v2.md §3 rules 2, 3, 4 and 5 — the window of the tourist-tax report, pure: a month, a quarter
// or a year as whole months, a custom window by day under the finance window's own validation (D7), and the months
// to come left out. Today is an input; every date is built on a year from the real calendar, inside the date window.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTaxPeriod, MESSAGES } = require('../utils/touristTaxPeriod');
const { MESSAGES: WINDOW_MESSAGES } = require('../utils/financeWindow');
const { addDays } = require('../utils/dateDays');

const Y = new Date().getFullYear() + 1;
const TODAY = `${Y}-11-05`;
const resolve = (input) => resolveTaxPeriod({ today: TODAY, ...input });
const windowOf = (input) => {
  const result = resolve(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.window;
};

test('rule 2: a month is the extraction month, first day to last', () => {
  assert.deepEqual(windowOf({ period: 'month', month: `${Y}-08` }), {
    kind: 'month', from: `${Y}-08-01`, to: `${Y}-08-31`, toExclusive: `${Y}-09-01`, label: `août ${Y}`, month: `${Y}-08`,
    coveredTo: `${Y}-08-31`, coveredToExclusive: `${Y}-09-01`, futureExcluded: false,
  });
  assert.equal(windowOf({ month: `${Y}-02` }).kind, 'month');
  assert.equal(windowOf({ period: 'month', month: `${Y - 1}-12` }).toExclusive, `${Y}-01-01`);
  // The current month is open, as on the monthly page.
  assert.equal(windowOf({ period: 'month', month: `${Y}-11` }).futureExcluded, false);
});

test('rule 3: a quarter and a year are whole months, labelled for the screen', () => {
  const q3 = windowOf({ period: 'quarter', quarter: `${Y}-Q3` });
  assert.deepEqual([q3.from, q3.to, q3.toExclusive, q3.label, q3.quarter], [`${Y}-07-01`, `${Y}-09-30`, `${Y}-10-01`, `T3 ${Y} (juil.–sept.)`, `${Y}-Q3`]);
  const q1 = windowOf({ period: 'quarter', quarter: `${Y}-Q1` });
  assert.deepEqual([q1.from, q1.to, q1.label], [`${Y}-01-01`, `${Y}-03-31`, `T1 ${Y} (janv.–mars)`]);
  const q4 = windowOf({ period: 'quarter', quarter: `${Y - 1}-Q4` });
  assert.deepEqual([q4.from, q4.to, q4.toExclusive], [`${Y - 1}-10-01`, `${Y - 1}-12-31`, `${Y}-01-01`]);
  const year = windowOf({ period: 'year', year: String(Y - 1) });
  assert.deepEqual([year.from, year.to, year.toExclusive, year.label, year.year], [`${Y - 1}-01-01`, `${Y - 1}-12-31`, `${Y}-01-01`, `Année ${Y - 1}`, String(Y - 1)]);
});

test('rule 4: a custom window is by day, both ends included, validated like the finance window', () => {
  const w = windowOf({ period: 'custom', from: `${Y}-07-14`, to: `${Y}-08-02` });
  assert.deepEqual([w.from, w.to, w.toExclusive, w.label], [`${Y}-07-14`, `${Y}-08-02`, `${Y}-08-03`, `du 14/07/${Y} au 02/08/${Y}`]);
  assert.equal(windowOf({ period: 'custom', from: `${Y}-07-14`, to: `${Y}-07-14` }).toExclusive, `${Y}-07-15`);
  const refusals = [
    [{ from: `${Y}-02-30`, to: `${Y}-03-01` }, WINDOW_MESSAGES.missingDates],
    [{ from: `${Y}-13-01`, to: `${Y}-03-01` }, WINDOW_MESSAGES.missingDates],
    [{ from: `${Y}-03-01` }, WINDOW_MESSAGES.missingDates],
    [{ from: `${Y}-3-1`, to: `${Y}-03-02` }, WINDOW_MESSAGES.missingDates],
    [{ from: `${Y}-03-02`, to: `${Y}-03-01` }, WINDOW_MESSAGES.reversed],
    [{ from: `${Y - 2}-01-01`, to: addDays(`${Y - 2}-01-01`, 751) }, WINDOW_MESSAGES.tooWide],
    [{ from: `${Y - 6}-01-01`, to: `${Y - 6}-02-01` }, WINDOW_MESSAGES.tooOld],
  ];
  for (const [input, error] of refusals) {
    assert.deepEqual(resolve({ period: 'custom', ...input }), { ok: false, error }, JSON.stringify(input));
  }
  assert.equal(WINDOW_MESSAGES.missingDates, 'Deux dates à choisir.');
  // 750 days exactly still fits (two whole exercises).
  assert.equal(resolve({ period: 'custom', from: `${Y - 2}-01-01`, to: addDays(`${Y - 2}-01-01`, 750) }).ok, true);
});

test('rule 5: what cannot be read is refused, never clamped', () => {
  const refusals = [
    [{ period: 'month', month: `${Y}-13` }, MESSAGES.badMonth],
    [{ period: 'month', month: `${Y}-00` }, MESSAGES.badMonth],
    [{ period: 'month', month: `${Y}-8` }, MESSAGES.badMonth],
    [{ period: 'month' }, MESSAGES.badMonth],
    [{ period: 'quarter', quarter: `${Y}-Q0` }, MESSAGES.badQuarter],
    [{ period: 'quarter', quarter: `${Y}-T3` }, MESSAGES.badQuarter],
    [{ period: 'quarter' }, MESSAGES.badQuarter],
    [{ period: 'year', year: `${Y}x` }, MESSAGES.badYear],
    [{ period: 'year', year: '0000' }, MESSAGES.badYear],
    [{ period: 'year' }, MESSAGES.badYear],
    [{ period: 'semester' }, MESSAGES.badKind],
    [{ period: ['month'] }, MESSAGES.badKind],
  ];
  for (const [input, error] of refusals) {
    assert.deepEqual(resolve(input), { ok: false, error }, JSON.stringify(input));
  }
  assert.equal(MESSAGES.badMonth, 'Mois invalide. Format attendu: YYYY-MM.');
  assert.equal(MESSAGES.future, 'Les mois futurs ne sont pas autorisés.');
});

test('rule 5: a window starting after the current month is refused; one running past it stops at its end', () => {
  for (const input of [
    { period: 'month', month: `${Y}-12` },
    { period: 'quarter', quarter: `${Y + 1}-Q1` },
    { period: 'year', year: String(Y + 1) },
    { period: 'custom', from: `${Y}-12-01`, to: `${Y}-12-10` },
  ]) {
    assert.deepEqual(resolve(input), { ok: false, error: MESSAGES.future }, JSON.stringify(input));
  }
  const q4 = windowOf({ period: 'quarter', quarter: `${Y}-Q4` });
  assert.deepEqual([q4.to, q4.coveredTo, q4.coveredToExclusive, q4.futureExcluded], [`${Y}-12-31`, `${Y}-11-30`, `${Y}-12-01`, true]);
  const year = windowOf({ period: 'year', year: String(Y) });
  assert.deepEqual([year.coveredTo, year.futureExcluded], [`${Y}-11-30`, true]);
  const custom = windowOf({ period: 'custom', from: `${Y}-11-20`, to: `${Y + 1}-01-10` });
  assert.deepEqual([custom.coveredTo, custom.futureExcluded], [`${Y}-11-30`, true]);
  // Inside the current month nothing is cut, today's day or not.
  const inMonth = windowOf({ period: 'custom', from: `${Y}-11-01`, to: `${Y}-11-30` });
  assert.deepEqual([inMonth.coveredTo, inMonth.futureExcluded], [`${Y}-11-30`, false]);
  const past = windowOf({ period: 'quarter', quarter: `${Y}-Q3` });
  assert.deepEqual([past.coveredTo, past.futureExcluded], [past.to, false]);
});
