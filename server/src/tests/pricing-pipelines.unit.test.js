// specs/pricing-components.md §3 rules 43, 52 and 60 — `utils/pricing/pipelines.js`: the `stayQuote` use case is built from the
// steps (the build is the check, at module load), its steps follow the order of the rule, and the QuoteContext typedef lists
// every key a step provides.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stayQuote } = require('../utils/pricing/pipelines');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const START = addDaysToIsoDate(todayIso(), 120);
const END = addDaysToIsoDate(START, 3);


const STEPS_DIR = path.join(__dirname, '..', 'utils', 'pricing', 'steps');
const stepFiles = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));

test('rule 52: stayQuote is built and runs loadStay → clock → nights → extraGuests → extras → … → schedule → settlement', () => {
  assert.equal(stayQuote.steps[0], 'loadStay');
  assert.equal(stayQuote.steps[1], 'clock');
  const index = (id) => stayQuote.steps.indexOf(id);
  const inOrder = ['nights', 'extraGuests', 'extras', 'platformPrice', 'discounts', 'touristTax', 'vat', 'totals', 'schedule', 'settlement'];
  assert.ok(inOrder.every((id) => index(id) > 0), 'every unit of the rule is a step');
  for (const [before, after] of [['nights', 'extraGuests'], ['extraGuests', 'extras'], ['extras', 'touristTax'], ['touristTax', 'platformPrice'], ['platformPrice', 'vat'], ['vat', 'totals'], ['totals', 'schedule'], ['schedule', 'settlement']]) {
    assert.ok(index(before) < index(after), `${before} before ${after}`);
  }
  assert.ok(index('schedule') < index('platformPayment') && index('platformPayment') < index('settlement'), 'rule 70: the platform payment follows the schedule');
});

test('rule 52: every step file is in stayQuote and none builds a sale use case (ficheSale, sasSale, shopSale, externalSale are not in PR A)', () => {
  assert.deepEqual([...stayQuote.steps].sort(), [...stepFiles].sort());
  assert.deepEqual(Object.keys(require('../utils/pricing/pipelines')), ['stayQuote', 'touristTaxFigure']);
});

test('rule 3: the tourist-tax slice is the head of stayQuote up to the TOURIST TAX step, nothing else', () => {
  const { touristTaxFigure } = require('../utils/pricing/pipelines');
  const upTo = stayQuote.steps.indexOf('touristTax');
  assert.deepEqual([...touristTaxFigure.steps], [...stayQuote.steps].slice(0, upTo + 1));
});

test('rule 52: the QuoteContext typedef names every key a step provides', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing', 'pipelines.js'), 'utf8');
  const typedef = source.slice(source.indexOf('@typedef {object} QuoteContext'));
  assert.ok(typedef.length > 0);
  for (const id of stepFiles) {
    const { provides } = require(path.join(STEPS_DIR, id));
    for (const key of provides) if (key !== 'halt') assert.match(typedef, new RegExp(`\\b${key}\\b`), `${id} provides ${key}`);
  }
});

test('rule 52: a step never mutates the context it receives and returns a new one', () => {
  const nights = require('../utils/pricing/steps/nights');
  const ctx = Object.freeze({
    startDate: START, endDate: END, lockedNightlyBreakdown: null, property: { id: 1 }, vatRate: 10, vatRegime: { rate: 10 },
    rules: [{ id: 1, pricePerNight: 100, pricingMode: 'fixed', dateRanges: '[]', progressiveTiers: '[]', startDate: null, endDate: null, minNights: 1 }],
  });
  const next = nights.apply(ctx);
  assert.notEqual(next, ctx);
  assert.equal(next.nights, 3);
  assert.equal(ctx.nights, undefined);
});
