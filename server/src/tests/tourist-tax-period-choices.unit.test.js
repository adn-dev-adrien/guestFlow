// specs/tourist-tax-report-v2.md §3 rules 15 and 29 — what the period pickers of the tourist-tax page offer, pure: every month,
// quarter and year from the first stay to the current month, newest first and labelled, never before the date
// window's start, and the month the page opens on; rule 29: the month the page opens on and the selection read are
// always offered. Today is an input, built on a year from the real calendar.

const test = require('node:test');
const assert = require('node:assert/strict');
const { periodChoices } = require('../utils/touristTaxPeriod');

const Y = new Date().getFullYear() + 1;

test('rule 15: months, quarters and years from the first stay to the current month, newest first', () => {
  const choices = periodChoices({ firstMonth: `${Y - 1}-11`, today: `${Y}-02-03` });
  assert.deepEqual(choices.months, [
    { value: `${Y}-02`, label: `février ${Y}` },
    { value: `${Y}-01`, label: `janvier ${Y}` },
    { value: `${Y - 1}-12`, label: `décembre ${Y - 1}` },
    { value: `${Y - 1}-11`, label: `novembre ${Y - 1}` },
  ]);
  assert.deepEqual(choices.quarters, [
    { value: `${Y}-Q1`, label: `T1 ${Y} (janv.–mars)` },
    { value: `${Y - 1}-Q4`, label: `T4 ${Y - 1} (oct.–déc.)` },
  ]);
  assert.deepEqual(choices.years, [{ value: String(Y), label: String(Y) }, { value: String(Y - 1), label: String(Y - 1) }]);
  assert.equal(choices.defaultMonth, `${Y}-01`);
});

test('rules 15 and 29: no stay, or a first stay in the future, offers the current month and the one the page opens on', () => {
  for (const firstMonth of [null, '', `${Y + 1}-03`, `${Y}-13`]) {
    const choices = periodChoices({ firstMonth, today: `${Y}-01-20` });
    assert.deepEqual(choices.months, [{ value: `${Y}-01`, label: `janvier ${Y}` }, { value: `${Y - 1}-12`, label: `décembre ${Y - 1}` }], String(firstMonth));
    assert.equal(choices.defaultMonth, `${Y - 1}-12`);
    assert.ok(choices.months.some((m) => m.value === choices.defaultMonth));
    assert.deepEqual(choices.years.map((y) => y.value), [String(Y), String(Y - 1)]);
  }
});

test('rule 29: the month, quarter or year being read is offered even when older than the first stay', () => {
  const month = periodChoices({ firstMonth: `${Y}-05`, today: `${Y}-06-15`, window: { kind: 'month', month: `${Y - 3}-03`, label: `mars ${Y - 3}` } });
  assert.deepEqual(month.months.at(-1), { value: `${Y - 3}-03`, label: `mars ${Y - 3}` });
  assert.deepEqual(month.months.map((m) => m.value), [...month.months.map((m) => m.value)].sort().reverse());
  const quarter = periodChoices({ firstMonth: `${Y}-05`, today: `${Y}-06-15`, window: { kind: 'quarter', quarter: `${Y - 2}-Q1`, label: `T1 ${Y - 2} (janv.–mars)` } });
  assert.deepEqual(quarter.quarters.at(-1), { value: `${Y - 2}-Q1`, label: `T1 ${Y - 2} (janv.–mars)` });
  const year = periodChoices({ firstMonth: `${Y}-05`, today: `${Y}-06-15`, window: { kind: 'year', year: String(Y - 2) } });
  assert.deepEqual(year.years.at(-1), { value: String(Y - 2), label: String(Y - 2) });
  const custom = periodChoices({ firstMonth: `${Y}-05`, today: `${Y}-06-15`, window: { kind: 'custom' } });
  assert.equal(custom.months.length, 2);
});

test('rule 15: nothing older than the date window is offered', () => {
  const choices = periodChoices({ firstMonth: `${Y - 40}-01`, today: `${Y}-06-15` });
  assert.equal(choices.months.at(-1).value, `${Y - 5}-06`);
  assert.equal(choices.months.length, 61);
  assert.equal(choices.years.at(-1).value, String(Y - 5));
});
