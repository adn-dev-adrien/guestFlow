// specs/finance-dashboard-redesign.md §3 rule 57 (D-HC16, 2026-11-06) — over HTTP, a repeated `fiscalYear` answers
// 400 { error: 'Exercice inconnu.', code: 'UNKNOWN_EXERCISE' } on the dashboard, its detail tables and the stay
// profile, the data checks' own answer; one unusable value still reads the current exercise.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, respond } = require('./ledgerFixture');
const finance = require('../controllers/financeController');
const profile = require('../controllers/stayProfileController');

seed();
const call = (handler, req) => { const res = respond(); handler(req, res); return res; };
const REFUSED = { error: 'Exercice inconnu.', code: 'UNKNOWN_EXERCISE' };

test('rule 57 — a repeated or nested fiscalYear: 400 with the data checks\' message and code, on every endpoint', () => {
  for (const fiscalYear of [['2026', '2027'], ['2026', '2026'], { a: '2026' }]) {
    for (const [name, handler, req] of [
      ['dashboard', finance.getDashboard, { query: { fiscalYear } }],
      ['detail', finance.getDashboardDetail, { query: { fiscalYear }, params: { tile: 'stays' } }],
      ['profile', profile.getStayProfile, { query: { fiscalYear } }],
    ]) {
      const res = call(handler, req);
      assert.equal(res.statusCode, 400, `${name} ${JSON.stringify(fiscalYear)}`);
      assert.deepEqual(res.body, REFUSED, name);
    }
  }
});

test('rule 57 — one unusable value keeps the dashboard convention (current exercise), no code', () => {
  const res = call(finance.getDashboard, { query: { fiscalYear: 'abc' } });
  assert.notEqual(res.statusCode, 400);
  assert.equal(res.body.code, undefined);
  assert.ok(res.body.fiscalYear && res.body.fiscalYear.key);
});
