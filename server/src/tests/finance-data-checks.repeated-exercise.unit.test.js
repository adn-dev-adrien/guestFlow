// D-HC16 (Adrien, 2026-11-06): specs/finance-data-checks.md §3 rule 22 — a repeated `fiscalYear` is refused, one
// unusable value still reads as the current exercise.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, respond } = require('./ledgerFixture');
const controller = require('../controllers/financeDataChecksController');
const { todayIso } = require('../utils/localDate');

seed();
const ask = (query) => { const res = respond(); controller.getDataChecks({ query }, res); return res; };
const currentKey = Number(todayIso().slice(0, 4));

test('rule 22: a repeated fiscalYear is « Exercice inconnu. » (400, code UNKNOWN_EXERCISE)', () => {
  for (const fiscalYear of [['2026', '2027'], ['2026', '2026'], [currentKey.toString(), 'abc']]) {
    const res = ask({ fiscalYear });
    assert.equal(res.statusCode, 400, JSON.stringify(fiscalYear));
    assert.deepEqual(res.body, { error: 'Exercice inconnu.', code: 'UNKNOWN_EXERCISE' });
  }
});

test('rule 22: an object-shaped fiscalYear is refused the same way', () => {
  const res = ask({ fiscalYear: { a: '2026' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_EXERCISE');
});

test('rule 22: one unusable value keeps reading the current exercise', () => {
  for (const fiscalYear of ['abc', '', '1999', '2027.5', '-1', undefined]) {
    const res = ask(fiscalYear === undefined ? {} : { fiscalYear });
    assert.equal(res.statusCode, 200, String(fiscalYear));
    assert.equal(res.body.exercise.key, currentKey, String(fiscalYear));
  }
});

test('rule 22: a repeated logement stays « Logement inconnu. », without the exercise code', () => {
  const res = ask({ propertyId: ['1', '2'] });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Logement inconnu.' });
});
