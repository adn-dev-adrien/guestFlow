// specs/reservations-backend-mvc.md rules 15, 18, 19 (audit R22, 2026-11-04) — one reading of a number on a stay's
// writes: the party is whole and ≥ 0, a line is not sent twice, the money stops at the usable range, and the
// preview refuses what the save refuses. Refused, never clamped; a stored value sent back unchanged passes.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devis = require('../models/devisModel');
const devisController = require('../controllers/devisController');
const { lineInputRefusal, usableNumber, readNumber, numberRefused } = require('../utils/lineInputBounds');
const { validateMoneyAmount, validatePercentage, validateStayFinance, validateClientGrossAmount } = require('../utils/financeValidation');

const OPTION = 70;
const RESOURCE = 71;

test.before(() => {
  f.seed();
  f.db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${OPTION}, 'Bois', 'per_stay', 10)`).run();
  f.db.prepare(`INSERT INTO property_options (propertyId, optionId) VALUES (1, ${OPTION})`).run();
  f.db.prepare(`INSERT INTO resources (id, name, quantity, price, priceType) VALUES (${RESOURCE}, 'Vélo', 2, 5, 'per_stay')`).run();
});

let month = 0;
function dates() {
  month += 1;
  return { startDate: f.inDays(30 + month * 5), endDate: f.inDays(33 + month * 5) };
}
const PROBE = () => ({ startDate: f.inDays(1500), endDate: f.inDays(1503) });

async function preview(body) {
  const res = f.respond();
  await f.controller.calculatePrice({ body: { propertyId: 1, adults: 2, ...PROBE(), ...body }, user: f.ADMIN }, res);
  return res;
}
async function update(id, over) {
  const res = f.respond();
  await f.controller.update({ params: { id: String(id) }, body: f.ficheBody(id, over), user: f.ADMIN, query: {} }, res);
  return res;
}
const create = (body) => f.create(f.stayBody({ ...PROBE(), ...body }));
const devisBody = (over) => ({ propertyId: 1, clientId: 1, adults: 2, ...PROBE(), ...over });

const BAD_PARTY = [-3, -1, 1.5, 0.5, '2.5', '-1'];
const PARTY_FIELDS = ['adults', 'children', 'teens', 'babies', 'babyBeds', 'singleBeds', 'doubleBeds'];

test('reservations-backend-mvc rule 15: a party number is whole and ≥ 0 on every path, and the fiche reads the reason', async () => {
  const stay = f.createStay(dates());
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  for (const field of PARTY_FIELDS) {
    for (const value of BAD_PARTY) {
      const label = `${field} ${value}`;
      const asPreview = await preview({ [field]: value });
      assert.deepEqual([asPreview.statusCode, asPreview.body.code, asPreview.body.field], [400, 'INVALID_QUANTITY', field], `preview ${label}`);
      assert.deepEqual([create({ [field]: value }).statusCode, create({ [field]: value }).body.code], [400, 'INVALID_QUANTITY'], `create ${label}`);
      const asUpdate = await update(stay, { [field]: value });
      assert.deepEqual([asUpdate.statusCode, asUpdate.body.code], [400, 'INVALID_QUANTITY'], `update ${label}`);
      assert.equal(devis.create(devisBody({ [field]: value })).code, 'INVALID_QUANTITY', `devis create ${label}`);
      assert.equal(devis.update(quote, { [field]: value }).code, 'INVALID_QUANTITY', `devis update ${label}`);
    }
  }
  assert.match((await preview({ adults: -3 })).body.error, /nombre entier/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE adults < 0 OR adults != CAST(adults AS INTEGER)').get().n, 0);
});

test('reservations-backend-mvc rule 15: adults 0 still means one adult, and quantity fractions stay allowed', async () => {
  const none = await preview({ adults: 0 });
  const one = await preview({ adults: 1 });
  assert.equal(none.statusCode, 200);
  assert.equal(none.body.finalPrice, one.body.finalPrice);
  assert.equal(lineInputRefusal({ adults: 0, children: 0, teens: '0', babies: '', babyBeds: null, options: [{ optionId: OPTION, quantity: 0.75 }] }), null);
});

test('reservations-backend-mvc rule 15: a party the stay already stores is not re-judged, a changed one is', async () => {
  const id = f.createStay(dates());
  f.db.prepare('UPDATE reservations SET adults = 1.5 WHERE id = ?').run(id);
  const saved = await update(id, { adults: 1.5 });
  assert.notEqual(saved.body.code, 'INVALID_QUANTITY', JSON.stringify(saved.body).slice(0, 200));
  const row = f.rowOf(id);
  const quoted = await preview({ reservationId: id, adults: 1.5, startDate: row.startDate, endDate: row.endDate });
  assert.equal(quoted.statusCode, 200, JSON.stringify(quoted.body).slice(0, 200));
  const changed = await update(id, { adults: 2.5 });
  assert.deepEqual([changed.statusCode, changed.body.code], [400, 'INVALID_QUANTITY']);
});

test('reservations-backend-mvc rule 18: a repeated optionId or resourceId is 400 INVALID_LINES on the preview and the save, never a 500', async () => {
  const stay = f.createStay(dates());
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  const options = [{ optionId: OPTION, quantity: 1 }, { optionId: String(OPTION), quantity: 2 }];
  const resources = [{ resourceId: RESOURCE, quantity: 1 }, { resourceId: RESOURCE, quantity: 1 }];
  for (const [asStay, asQuote] of [[{ options }, { selectedOptions: options }], [{ resources }, { selectedResources: resources }]]) {
    const answers = [await preview(asQuote), create(asStay), await update(stay, asStay)];
    for (const res of answers) assert.deepEqual([res.statusCode, res.body.code], [400, 'INVALID_LINES'], JSON.stringify(asStay));
    assert.equal(devis.create(devisBody(asQuote)).code, 'INVALID_LINES');
    assert.equal(devis.update(quote, asQuote).code, 'INVALID_LINES');
  }
  assert.equal(lineInputRefusal({ options: [{ optionId: 1 }, { optionId: 2 }], selectedOptions: [{ optionId: 1 }], resources: [{ resourceId: 1 }] }), null);
  assert.equal(lineInputRefusal({ customOptions: [{ customOptionId: 3, amount: 1 }, { customOptionId: 3, amount: 2 }] }), null);
});

test('reservations-backend-mvc rule 19: validateMoneyAmount and validatePercentage reuse the one reading of a number', () => {
  for (const value of [1e308, 1e300, Number.MAX_SAFE_INTEGER + 2, Infinity, '1e999', 'abc', '0x10', 'Infinity', true, false, [], [5], {}, { a: 1 }]) {
    assert.equal(validateMoneyAmount(value), 'NOT_A_NUMBER', `money ${String(value)}`);
    assert.equal(validatePercentage(value), 'NOT_A_NUMBER', `percent ${String(value)}`);
  }
  for (const value of ['', '  ', null, undefined, 0, 12.5, '12.5', ' 7 ', Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateMoneyAmount(value), null, `money ${String(value)}`);
  }
  for (const value of ['', '  ', null, undefined, 0, 100, '50', 12.5]) assert.equal(validatePercentage(value), null, String(value));
  assert.equal(validateMoneyAmount(-1), 'NEGATIVE_AMOUNT');
  assert.equal(validatePercentage(101), 'INVALID_PERCENTAGE');
  assert.equal(validateClientGrossAmount(1e308, 10), 'NOT_A_NUMBER');
  assert.equal(validateClientGrossAmount('100', 10), null);
  assert.equal(validateClientGrossAmount('', 10), null);
  assert.equal(validateClientGrossAmount(5, 10), 'GROSS_BELOW_NET');
  assert.equal(usableNumber(Number.MAX_SAFE_INTEGER), true);
  assert.equal(usableNumber(-Number.MAX_SAFE_INTEGER - 2), false);
  assert.equal(readNumber(''), undefined);
  assert.equal(readNumber(' 12 '), 12);
  assert.ok(Number.isNaN(readNumber('  ')));
  assert.equal(numberRefused(1e308, undefined, 1e308), false);
});

const MONEY = ['customPrice', 'depositAmount', 'depositAmountOverride', 'complementAmountOverride', 'endOfStayComplementAmountOverride',
  'balanceAmount', 'cautionAmount', 'platformCommissionAmount', 'acompteCommissionAmount', 'platformGrossAmount', 'platformPayoutAmount', 'platformTouristTaxAmount'];

test('reservations-backend-mvc rule 19: the preview refuses what the create and the update refuse, field by field', async () => {
  const stay = f.createStay(dates());
  for (const field of MONEY) {
    for (const [value, code] of [[1e308, 'NOT_A_NUMBER'], ['abc', 'NOT_A_NUMBER'], [true, 'NOT_A_NUMBER'], [-100, 'NEGATIVE_AMOUNT']]) {
      const label = `${field} ${String(value)}`;
      for (const res of [await preview({ [field]: value }), create({ [field]: value }), await update(stay, { [field]: value })]) {
        assert.deepEqual([res.statusCode, res.body.code], [400, code], label);
      }
    }
  }
  for (const res of [await preview({ discountPercent: 101 }), create({ discountPercent: 101 })]) assert.equal(res.body.code, 'INVALID_PERCENTAGE');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE finalPrice > 1e15 OR balanceAmount > 1e15 OR complementAmount > 1e15').get().n, 0);
});

function devisCall(fn, params, body) {
  const res = f.respond();
  devisController[fn]({ params, body, query: {}, user: f.ADMIN }, res);
  return res;
}

test('reservations-backend-mvc rule 19: the devis shares the list, on its create and its update', () => {
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  for (const field of MONEY) {
    assert.deepEqual([devisCall('create', {}, devisBody({ [field]: 1e308 })).statusCode], [400], field);
    assert.deepEqual([devisCall('update', { id: String(quote) }, { [field]: 1e308 }).statusCode], [400], field);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis' AND finalPrice > 1e15").get().n, 0);
});

test('reservations-backend-mvc rule 19: a stored amount sent back unchanged is not re-judged, on the preview nor the save', async () => {
  const id = f.createStay(dates());
  f.db.prepare('UPDATE reservations SET cautionAmount = ?, platformGrossAmount = ? WHERE id = ?').run(1e300, 1e300, id);
  assert.equal(validateStayFinance({ cautionAmount: 1e300 }, f.rowOf(id)), null);
  assert.equal(validateStayFinance({ cautionAmount: 1e301 }, f.rowOf(id)), 'NOT_A_NUMBER');
  const row = f.rowOf(id);
  const quoted = await preview({ reservationId: id, cautionAmount: 1e300, startDate: row.startDate, endDate: row.endDate });
  assert.notEqual(quoted.body.code, 'NOT_A_NUMBER');
  const patched = f.respond();
  await f.controller.updatePayment({ params: { id: String(id) }, body: { cautionAmount: 1e300 }, user: f.ADMIN, query: {} }, patched);
  assert.notEqual(patched.body.code, 'NOT_A_NUMBER');
});

test('reservations-backend-mvc rule 19: the fiche\'s ordinary values still quote and save', async () => {
  const id = f.createStay(dates());
  const saved = await update(id, { customPrice: '450.50', discountPercent: '10', cautionAmount: '', platformGrossAmount: null });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body).slice(0, 200));
  assert.equal((await preview({ customPrice: 450.5, platformGrossAmount: '', balanceAmount: '100' })).statusCode, 200);
});

const SPACES = ['  ', ' ', '\t', ' \n '];

test('reservations-backend-mvc rule 15: text of spaces alone is not a number: refused on the party on every path, never stored as text', async () => {
  const stay = f.createStay(dates());
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  for (const field of PARTY_FIELDS) {
    for (const value of SPACES) {
      const label = `${field} ${JSON.stringify(value)}`;
      const asPreview = await preview({ [field]: value });
      assert.deepEqual([asPreview.statusCode, asPreview.body.code, asPreview.body.field], [400, 'INVALID_QUANTITY', field], `preview ${label}`);
      assert.deepEqual([create({ [field]: value }).statusCode, create({ [field]: value }).body.code], [400, 'INVALID_QUANTITY'], `create ${label}`);
      const asUpdate = await update(stay, { [field]: value });
      assert.deepEqual([asUpdate.statusCode, asUpdate.body.code], [400, 'INVALID_QUANTITY'], `update ${label}`);
      assert.equal(devis.create(devisBody({ [field]: value })).code, 'INVALID_QUANTITY', `devis create ${label}`);
      assert.equal(devis.update(quote, { [field]: value }).code, 'INVALID_QUANTITY', `devis update ${label}`);
    }
  }
  const asText = PARTY_FIELDS.map((field) => `typeof(${field}) = 'text'`).join(' OR ');
  assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE ${asText}`).get().n, 0);
  assert.equal(lineInputRefusal({ adults: '', children: null, teens: undefined }), null);
});

test('reservations-backend-mvc rule 15: text of spaces alone is refused on a typed count, a quantity, an amount and a line contrib', () => {
  for (const value of SPACES) {
    for (const list of ['options', 'selectedOptions']) {
      assert.equal(lineInputRefusal({ [list]: [{ optionId: OPTION, cardPersons: value }] })?.code, 'INVALID_CARD_PERSONS', list);
      assert.equal(lineInputRefusal({ [list]: [{ optionId: OPTION, cardNights: value }] })?.code, 'INVALID_CARD_NIGHTS', list);
      assert.equal(lineInputRefusal({ [list]: [{ optionId: OPTION, quantity: value }] })?.code, 'INVALID_QUANTITY', list);
      assert.equal(lineInputRefusal({ [list]: [{ optionId: OPTION, acompteContribTtc: value }] })?.code, 'INVALID_AMOUNT', list);
    }
    assert.equal(lineInputRefusal({ customOptions: [{ customOptionId: 1, amount: value }] })?.code, 'INVALID_AMOUNT');
  }
  assert.equal(lineInputRefusal({ options: [{ optionId: OPTION, cardPersons: '', cardNights: null, quantity: '' }] }), null);
});

test('reservations-backend-mvc rule 19: text of spaces alone on a money field or a percentage stays « not provided »', async () => {
  for (const value of SPACES) {
    assert.equal(validateMoneyAmount(value), null);
    assert.equal(validatePercentage(value), null);
    assert.equal(validateClientGrossAmount(value, 10), null);
    assert.equal(validateStayFinance({ cautionAmount: value, discountPercent: value }), null);
  }
  const quoted = await preview({ cautionAmount: '  ', platformGrossAmount: '  ', discountPercent: '  ' });
  assert.equal(quoted.statusCode, 200, JSON.stringify(quoted.body).slice(0, 200));
});

test('reservations-backend-mvc rule 19: the update route reads the stored row, so a stored amount passes and a changed one does not', async () => {
  const id = f.createStay(dates());
  f.db.prepare('UPDATE reservations SET cautionAmount = ? WHERE id = ?').run(1e300, id);
  const kept = await update(id, { cautionAmount: 1e300 });
  assert.notEqual(kept.body.code, 'NOT_A_NUMBER', JSON.stringify(kept.body).slice(0, 200));
  const changed = await update(id, { cautionAmount: 1e301 });
  assert.deepEqual([changed.statusCode, changed.body.code], [400, 'NOT_A_NUMBER']);
});

test('reservations-backend-mvc rule 19: the devis update route reads the stored row, so a stored amount passes and a changed one does not', () => {
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  f.db.prepare('UPDATE reservations SET cautionAmount = ? WHERE id = ?').run(1e300, quote);
  const kept = devisCall('update', { id: String(quote) }, { cautionAmount: 1e300 });
  assert.notEqual(kept.body?.error, 'NOT_A_NUMBER', JSON.stringify(kept.body).slice(0, 200));
  const changed = devisCall('update', { id: String(quote) }, { cautionAmount: 1e301 });
  assert.deepEqual([changed.statusCode, changed.body.error], [400, 'NOT_A_NUMBER']);
});

test('reservations-backend-mvc rule 15: the devis update passes the stored row to the guard, so a stored party passes and a changed one does not', () => {
  const quote = devis.create({ ...devisBody({}), ...dates() }).data.id;
  f.db.prepare('UPDATE reservations SET adults = -2 WHERE id = ?').run(quote);
  assert.notEqual(devis.update(quote, { adults: -2 }).code, 'INVALID_QUANTITY');
  assert.equal(devis.update(quote, { adults: -3 }).code, 'INVALID_QUANTITY');
});
