// specs/pricing-components.md §3 rules 2 and 43 (F18) — the import-graph judgement proved on synthetic trees: every mutant
// (a planted import or call) turns it red, the clean file stays green. Nothing here reads the real tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { violationsOf, keyOf, rankOf } = require('./helpers/pricingImportGraph');

const ROOT = path.resolve('/virtual/utils/pricing');
const abs = (rel) => path.join(ROOT, rel);

// `tree` maps a path relative to utils/pricing/ (or `../x.js` for utils/x.js) to its source.
const judge = (name, source, tree = {}) => {
  const files = new Map(Object.entries(tree).map(([rel, src]) => [path.resolve(ROOT, rel), src]));
  const file = abs(`${name}.js`);
  files.set(file, source);
  return violationsOf({ file, source, root: ROOT, readFile: (candidate) => files.get(candidate) });
};

test('a clean unit is green (imports upstream, a neutral helper, no clock)', () => {
  assert.deepEqual(judge('totals', "const { roundMoney } = require('./money');\nconst a = require('./articles');\nconst h = require('../neutral');\n", { '../neutral.js': 'module.exports = {};\n' }), []);
});

test('M2 a unit importing a utils module that reaches a model is red (transitively)', () => {
  const found = judge('nights', "const { x } = require('../blockedDates');\n", {
    '../blockedDates.js': "const m = require('./occupancy');\n",
    '../occupancy.js': "const model = require('../models/reservationsModel');\n",
  });
  assert.ok(found.some((f) => f.includes('blockedDates') && f.includes('reaches')), found.join('|'));
});

test('M2b a direct import of a model or the database is red', () => {
  assert.ok(judge('totals', "require('../../models/ticketModel');\n").length > 0);
  assert.ok(judge('totals', "require('../../database');\n").length > 0);
});

test('M3 todayIso() in a unit, M4 new Date(undefined), M5 process.env are red', () => {
  assert.ok(judge('discounts', 'const t = todayIso();\n').some((f) => f.includes('todayIso')));
  assert.ok(judge('discounts', 'const t = getTodayIsoDate();\n').some((f) => f.includes('getTodayIsoDate')));
  assert.ok(judge('discounts', 'const t = new Date(undefined);\n').some((f) => f.includes('new Date(undefined')));
  assert.ok(judge('discounts', 'const t = Date.now();\nconst u = new Date();\n').length === 2);
  assert.ok(judge('discounts', 'const k = process.env.FLAG;\n').some((f) => f.includes('process.env')));
  assert.ok(judge('steps/nights', 'const k = process.env.FLAG;\n').some((f) => f.includes('process.env')), 'a step neither');
});

test('a step may read the loader clock, a unit may not (todayIso is judged outside steps only)', () => {
  assert.deepEqual(judge('steps/clock', 'const t = todayIso();\n'), []);
});

test('M8 articles/index → totals, M9 a family → settlement, M10 vat/index → articles are red', () => {
  assert.ok(judge('articles/index', "require('../totals');\n").some((f) => f.includes('not upstream')));
  assert.ok(judge('articles/families/fixed', "require('../../settlement');\n").some((f) => f.includes('not upstream')));
  assert.ok(judge('vat/index', "require('../articles');\n").some((f) => f.includes('not upstream')));
  assert.ok(judge('vat/settingsSchema', "require('../articles/registry');\n").length > 0, 'a sub-file takes its folder\'s rank');
});

test('imports inside the same folder are free, except a family reaching the head or the registry', () => {
  assert.deepEqual(judge('articles/families/fixed', "require('../familyKit');\nrequire('../units');\nrequire('../../money');\n"), []);
  assert.ok(judge('articles/families/fixed', "require('../index');\n").some((f) => f.includes('head or the registry')));
  assert.ok(judge('articles/families/fixed', "require('../registry');\n").some((f) => f.includes('head or the registry')));
  assert.deepEqual(judge('articles/index', "require('./registry');\nrequire('./families/fixed');\n"), []);
});

test('extras read the nights only: articles → touristTax and → extraGuests are red', () => {
  assert.ok(judge('articles/familyKit', "require('../touristTax');\n").some((f) => f.includes('nights only')));
  assert.ok(judge('articles/families/perPerson', "require('../../extraGuests');\n").some((f) => f.includes('nights only')));
  assert.deepEqual(judge('articles/familyKit', "require('../nights');\nrequire('../money');\n"), []);
});

test('a stay unit imports no extras or payments', () => {
  assert.ok(judge('touristTax', "require('./articles');\n").some((f) => f.includes('stay unit')));
  assert.ok(judge('nights', "require('./allowances');\n").length > 0);
});

test('a shim outside utils/pricing is judged against the unit it forwards to', () => {
  const tree = { '../midStayShim.js': "module.exports = require('./pricing/totals');\n" };
  assert.ok(judge('nights', "const s = require('../midStayShim');\n", tree).some((f) => f.includes('through a module outside utils/pricing')));
  assert.deepEqual(judge('totals', "const s = require('../midStayShim');\n", { '../midStayShim.js': "module.exports = require('./pricing/money');\n" }), []);
});

test('REFUNDS import money, vat, platformPayment and storedLines only, and no unit imports REFUNDS', () => {
  assert.deepEqual(judge('refunds/judge', "require('../money');\nrequire('../storedLines');\nrequire('../vat');\nrequire('./register');\n"), []);
  assert.ok(judge('refunds/judge', "require('../settlement');\n").some((f) => f.includes('REFUNDS may import')));
  assert.ok(judge('refunds/judge', "require('../schedule');\n").length > 0);
  assert.ok(judge('totals', "require('./refunds/register');\n").some((f) => f.includes('no pricing unit imports REFUNDS')));
  // Rule 72: not even SCHEDULE reaches REFUNDS; its excess keys are SETTLEMENT's `scheduleExcess`.
  assert.ok(judge('schedule', "require('./refunds/overpayment');\n").some((f) => f.includes('no pricing unit imports REFUNDS')));
  assert.ok(judge('schedule', "require('./refunds/register');\n").some((f) => f.includes('no pricing unit imports REFUNDS')));
});

test('a pure unit calls no ledger and requires no plugin registry; a step may require the registry', () => {
  assert.ok(judge('settlement', 'const x = paymentLedger.splitReceived(row);\n').some((f) => f.includes('ledger')));
  assert.ok(judge('settlement', 'const x = reservationLedger.read(id);\n').some((f) => f.includes('ledger')));
  assert.ok(judge('settlement', "require('../../plugins/sdk/registry');\n").length > 0);
  assert.ok(judge('settlement', "require('../priceLineContributors');\n").length > 0);
  assert.deepEqual(judge('steps/extras', "const r = require('../../priceLineContributors');\n", { '../priceLineContributors.js': 'module.exports = {};\n' }).filter((f) => f.includes('only a step')), []);
});

test('rank lookups: a sub-file takes its folder\'s rank, an unknown unit has none', () => {
  assert.equal(rankOf('articles/families/fixed'), rankOf('articles'));
  assert.equal(keyOf('mystery'), undefined);
  assert.ok(judge('totals', "require('./mystery');\n").some((f) => f.includes('without a declared rank')));
});
