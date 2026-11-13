// specs/outside-booking-sas.md rule 43 — the drinks revenue account is a setting of the export, empty by default: a journal export (CSV, sales JSON, synthesis) whose period holds a
// drink line is refused with 409 DRINKS_ACCOUNT_REQUIRED, an export with no drink is not, and a filled setting lets the drink through on that account.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const { create: createController } = require('../controller');
const { drinksAccountRefusal } = require('../drinksGuard');
const { DEFAULTS, DECLARED } = require('../settings');
const { buildStandaloneEntry } = require('../accountingModel');

const sale = (groups) => buildStandaloneEntry({
  key: 'standalone:1:2027-03-10', date: '2027-03-10', totalCents: 1000, booksCents: 1000, cardCents: 1000, label: 'Vente hors séjour', client: { firstName: '', lastName: 'Passage' }, vatRate: null, groups, invoiceNumber: null,
});
const drink = sale([{ vatClass: 'drinks', rate: 20, ttcCents: 1000, vatCents: 167 }]);
const meal = sale([{ vatClass: 'catering', rate: 10, ttcCents: 1000, vatCents: 91 }]);
const modelOf = (entries) => ({ encaissementsByMonth: () => [], standaloneSalesByMonth: () => entries });

function call(controller, method) {
  const out = { headers: {} };
  const res = {
    status(code) { out.status = code; return res; },
    json(body) { out.body = body; return res; },
    send(body) { out.body = body; return res; },
    setHeader(name, value) { out.headers[name] = value; },
  };
  controller[method]({ query: { month: '3', year: '2027' } }, res);
  return out;
}

test('rule 43 — the setting is empty by default and declared on the plugin\'s settings page', () => {
  assert.equal(DEFAULTS.drinksRevenueAccount, '');
  assert.ok(DECLARED.some((entry) => entry.key === 'drinksRevenueAccount'));
});

test('rule 43 — a period that holds a drink is refused with the setting named, in the CSV and the sales JSON', () => {
  const controller = createController(modelOf([drink]), { plan: () => ({}) });
  for (const method of ['salesCsv', 'salesJson']) {
    const result = call(controller, method);
    assert.equal(result.status, 409, method);
    assert.equal(result.body.code, 'DRINKS_ACCOUNT_REQUIRED');
    assert.equal(result.body.error, "Compte des boissons à renseigner avant l'export.");
    assert.equal(result.body.setting, 'drinksRevenueAccount');
  }
});

test('rule 43 — the synthesis is refused the same way', () => {
  const { buildSynthesis } = require('../synthesisController');
  const model = {
    today: () => '2027-03-31', fiscalEndMonth: () => 12, meansResolver: () => () => null, entriesBetween: () => [drink],
  };
  const result = buildSynthesis(model, { from: '2027-03-01', to: '2027-03-31' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'DRINKS_ACCOUNT_REQUIRED');
});

test('rule 43 — a period with no drink is unaffected, and so is one with the account set', () => {
  assert.equal(drinksAccountRefusal([meal], {}), null);
  assert.equal(drinksAccountRefusal([], undefined), null);
  assert.equal(drinksAccountRefusal([drink], { drinksRevenueAccount: '70650000' }), null);
  assert.notEqual(drinksAccountRefusal([drink], { drinksRevenueAccount: '  ' }), null, 'blank is empty');
  const filled = call(createController(modelOf([drink]), { plan: () => ({ drinksRevenueAccount: '70650000' }) }), 'salesJson');
  assert.equal(filled.status, undefined, 'answered, not refused');
  assert.ok(JSON.stringify(filled.body).includes('70650000'));
  const clean = call(createController(modelOf([meal]), { plan: () => ({}) }), 'salesCsv');
  assert.equal(clean.status, undefined);
});
