// specs/pricing-components.md §3 rules 47 and 57 — article family `percentOfStay`: a percentage of the accommodation actually charged
const test = require('node:test');
const assert = require('node:assert/strict');
const { family } = require('../utils/pricing/articles/families/percentOfStay');
const {
  STAY, optionRow, article, priceWith, NO_VAT_KEYS, taggedShape,
} = require('./articlesFixtures');

test('rule 47 — the family declares its contract: id, config schema, validate, price, describe', () => {
  assert.equal(family.id, 'percentOfStay');
  assert.ok(Array.isArray(family.configSchema) && family.configSchema.every((entry) => entry.key && entry.validate));
  for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family[member], 'function');
});

test('rule 47 — validate refuses a quantity that is not a count', () => {
  const instance = article(optionRow({ priceType: 'percent_of_stay', price: 4 }));
  for (const quantity of [-1, NaN, 'x', undefined]) {
    assert.deepEqual(family.validate(instance.config, { quantity }, STAY).map((r) => r.code), ['INVALID_QUANTITY'], String(quantity));
  }
  assert.deepEqual(family.validate(instance.config, { quantity: 0 }, STAY), []);
});

test('rule 47 — price is deterministic and emits a tagged amount without any VAT', () => {
  const first = priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 4 }), { quantity: 1 });
  const second = priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 4 }), { quantity: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.amounts.length, 1);
  const [amount] = first.amounts;
  assert.equal(taggedShape(amount), 'amountCents,customerContext,docKey,source,vatClass');
  assert.equal(amount.vatClass, 'options');
  assert.equal(amount.customerContext, 'hosted');
  assert.deepEqual(amount.source, { kind: 'line', ref: 'option:7' });
  NO_VAT_KEYS.forEach((key) => assert.equal(key in amount, false, key));
  assert.equal(amount.amountCents, 2000);
});

test('rule 47 — describe prints the label and the detail of the quoted line', () => {
  const instance = article(optionRow({ priceType: 'percent_of_stay', price: 4 }));
  const priced = priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 4 }), { quantity: 1 });
  const described = family.describe(instance.config, { ...priced, freeUnits: 0, offered: false });
  assert.equal(described.label, 'Petit déjeuner');
  assert.match(described.detail, /4 % du séjour/);
});


test('rule 47 — percentOfStay: the unit price is the percentage of the accommodation charged, to the cent', () => {
  const priced = priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 4 }), { quantity: 1 }, { ...STAY, cancellationInsuranceBase: 333.33 });
  assert.deepEqual([priced.unitPrice, priced.billedUnits], [13.33, 1]);
});

test('rule 47 — percentOfStay: a corrupt percentage is clamped to 0-100, a missing base prices nothing', () => {
  assert.equal(priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 250 }), {}, STAY).unitPrice, 500);
  assert.equal(priceWith(family, optionRow({ priceType: 'percent_of_stay', price: -5 }), {}, STAY).unitPrice, 0);
  assert.equal(priceWith(family, optionRow({ priceType: 'percent_of_stay', price: 4 }), {}, { ...STAY, cancellationInsuranceBase: undefined }).unitPrice, 0);
});

test('rule 47 — percentOfStay: the config schema accepts a percentage only', () => {
  const price = family.configSchema.find((entry) => entry.key === 'price');
  assert.equal(price.validate(4), null);
  assert.equal(typeof price.validate(101), 'string');
  assert.equal(typeof price.validate(-1), 'string');
});

test('rule 47 — percentOfStay: computePercentOfStayAmount is the single formula the public preview reads', () => {
  const { computePercentOfStayAmount } = require('../utils/pricing/articles/families/percentOfStay');
  assert.equal(computePercentOfStayAmount(4, 500), 20);
  assert.equal(require('../utils/pricing').computePercentOfStayAmount, computePercentOfStayAmount);
});
