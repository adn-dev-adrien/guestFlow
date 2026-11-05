// specs/tourist-tax-report-v2.md §3 rule 15 — what the period pickers of the tourist-tax page offer, pure: every month,
// quarter and year from the first stay to the current month, newest first and labelled, never before the date
// window's start, and the month the page opens on. Today is an input, built on a year from the real calendar.

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

test('rule 15: no stay, or a first stay in the future, offers the current month alone; January opens on December', () => {
  for (const firstMonth of [null, '', `${Y + 1}-03`, `${Y}-13`]) {
    const choices = periodChoices({ firstMonth, today: `${Y}-01-20` });
    assert.deepEqual(choices.months, [{ value: `${Y}-01`, label: `janvier ${Y}` }], String(firstMonth));
    assert.equal(choices.defaultMonth, `${Y - 1}-12`);
  }
});

test('rule 15: nothing older than the date window is offered', () => {
  const choices = periodChoices({ firstMonth: '0001-01', today: `${Y}-06-15` });
  assert.equal(choices.months.at(-1).value, `${Y - 5}-06`);
  assert.equal(choices.months.length, 61);
  assert.equal(choices.years.at(-1).value, String(Y - 5));
});
