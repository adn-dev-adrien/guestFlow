// specs/pricing-components.md §3 rules 5 and 47 — the head prices a `per_hour` line through the plugin-owned `hourly`
// family it is given as an input, inside the safety every plugin answer gets (a throw, a malformed answer, a closed `extra`);
// without the family the declared hours are billed at the lodging's rate after the free minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const articles = require('../utils/pricing/articles');
const {
  STAY, optionRow, resourceRow, article,
} = require('./articlesFixtures');

const quiet = { error: () => {}, warn: () => {} };
const originalConsole = { error: console.error, warn: console.warn };
test.beforeEach(() => { console.error = quiet.error; console.warn = quiet.warn; });
test.afterEach(() => { console.error = originalConsole.error; console.warn = originalConsole.warn; });

const hourlyArticle = () => article(resourceRow(), 'resource');
const familyAnswering = (answer, calls = []) => ({
  id: 'hourly', configSchema: [], validate: () => [], describe: () => ({ label: '', detail: '' }),
  price: (...args) => {
    calls.push(args);
    if (answer instanceof Error) throw answer;
    return answer;
  },
});
const lineOf = (families, over = {}) => articles.quote({
  requests: [{ article: hourlyArticle(), quantity: 2, selected: { quantity: 2 }, locked: undefined, offered: false, ...over }],
  stayContext: STAY,
  families,
}).lines[0];

test('rule 47 — an unsold per_hour line calls the hourly family once and takes its amounts', () => {
  const calls = [];
  const line = lineOf({ hourly: familyAnswering({ quantity: 2, unitPrice: 40, billedUnits: 2, totalPrice: 80, extra: { scheduledHours: 2, detail: 'x', other: 1 } }, calls) });
  assert.equal(calls.length, 1);
  assert.deepEqual([line.figures.quantity, line.figures.unitPrice, line.figures.billedUnits, line.offeredFigures.totalPrice], [2, 40, 2, 80]);
  assert.deepEqual(line.extra, { scheduledHours: 2, detail: 'x' }, 'extra is closed');
});

test('rule 47 — without the hourly family the declared hours are billed at the lodging rate after the free minutes', () => {
  const line = lineOf({}, { quantity: 3, selected: { quantity: 3 } });
  assert.deepEqual([line.figures.billedUnits, line.figures.unitPrice, line.offeredFigures.totalPrice], [2, 30, 60]);
  assert.equal(line.extra, undefined);
});

test('rule 47 — a throwing hourly family, or one with no finite quantity, prices like no plugin', () => {
  const reference = lineOf({}).offeredFigures.totalPrice;
  assert.equal(lineOf({ hourly: familyAnswering(new Error('boom')) }).offeredFigures.totalPrice, reference);
  assert.equal(lineOf({ hourly: familyAnswering({ quantity: Number.NaN }) }).offeredFigures.totalPrice, reference);
  assert.equal(lineOf({ hourly: familyAnswering(null) }).offeredFigures.totalPrice, reference);
});

test('rule 47 — amounts that are not all finite are a plain quantity of hours', () => {
  const line = lineOf({ hourly: familyAnswering({ quantity: 2, unitPrice: 40, billedUnits: Number.NaN, totalPrice: 80, extra: {} }) });
  assert.deepEqual([line.figures.billedUnits, line.offeredFigures.totalPrice], [1, 30]);
});

test('rule 47 — a sold line never bills fewer hours than it was sold', () => {
  const locked = { quantity: 3, unitPrice: 30, billedUnits: 3, totalPrice: 90, offered: 0 };
  const line = lineOf({ hourly: familyAnswering({ quantity: 1, extra: {} }) }, {
    article: article(resourceRow({ freeMinutes: 0 }), 'resource'), locked, quantity: 3, selected: { quantity: 3 },
  });
  assert.equal(line.figures.quantity, 3);
  assert.equal(line.offeredFigures.totalPrice, 90);
});

test('rule 47 — a quantity that is not a count is no line, not a crash', () => {
  const quote = articles.quote({
    requests: [{ article: article(resourceRow({ priceType: 'per_stay' }), 'resource'), quantity: 'abc', offered: false }],
    stayContext: STAY,
    families: articles.liveFamilies(),
  });
  assert.deepEqual(quote.lines, [null]);
  assert.equal(quote.refusals.length, 1);
});

test('rule 47 — a placed planning card is priced from its moments, whatever quantity says', () => {
  const card = article(optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }), 'option');
  const moments = [{ date: '2027-07-01', time: '08:00' }, { date: '2027-07-02', time: '08:00' }]; // date-literal-ok: pure function input
  const billed = (quantity) => articles.quote({
    requests: [{ article: card, quantity, occurrences: moments, offered: false }], stayContext: STAY, families: articles.liveFamilies(),
  }).lines[0].figures.billedUnits;
  assert.deepEqual(['abc', Infinity, 1, 5].map(billed), [2, 2, 2, 2]);
});

test('rule 47 — a non-finite resource quantity is no line, not a crash', () => {
  for (const quantity of ['abc', 'Infinity', Infinity]) {
    const quote = articles.quote({
      requests: [{ article: article(resourceRow({ priceType: 'per_night' }), 'resource'), quantity, offered: false }],
      stayContext: STAY,
      families: articles.liveFamilies(),
    });
    assert.deepEqual(quote.lines, [null], String(quantity));
  }
});
