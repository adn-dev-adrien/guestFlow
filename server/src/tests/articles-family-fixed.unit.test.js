// specs/pricing-components.md §3 rules 47 and 57 — article family `fixed`: one price per unit sold, whatever the stay
const test = require('node:test');
const assert = require('node:assert/strict');
const { family } = require('../utils/pricing/articles/families/fixed');
const {
  STAY, optionRow, article, priceWith, NO_VAT_KEYS, taggedShape,
} = require('./articlesFixtures');

test('rule 47 — the family declares its contract: id, config schema, validate, price, describe', () => {
  assert.equal(family.id, 'fixed');
  assert.ok(Array.isArray(family.configSchema) && family.configSchema.every((entry) => entry.key && entry.validate));
  for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family[member], 'function');
});

test('rule 47 — validate refuses a quantity that is not a count', () => {
  const instance = article(optionRow({ priceType: 'per_stay' }));
  for (const quantity of [-1, NaN, 'x', undefined]) {
    assert.deepEqual(family.validate(instance.config, { quantity }, STAY).map((r) => r.code), ['INVALID_QUANTITY'], String(quantity));
  }
  assert.deepEqual(family.validate(instance.config, { quantity: 0 }, STAY), []);
});

test('rule 47 — price is deterministic and emits a tagged amount without any VAT', () => {
  const first = priceWith(family, optionRow({ priceType: 'per_stay' }), { quantity: 3 });
  const second = priceWith(family, optionRow({ priceType: 'per_stay' }), { quantity: 3 });
  assert.deepEqual(first, second);
  assert.equal(first.amounts.length, 1);
  const [amount] = first.amounts;
  assert.equal(taggedShape(amount), 'amountCents,customerContext,docKey,source,vatClass');
  assert.equal(amount.vatClass, 'options');
  assert.equal(amount.customerContext, 'hosted');
  assert.deepEqual(amount.source, { kind: 'line', ref: 'option:7' });
  NO_VAT_KEYS.forEach((key) => assert.equal(key in amount, false, key));
  assert.equal(amount.amountCents, 1950);
});

test('rule 47 — describe prints the label and the detail of the quoted line', () => {
  const instance = article(optionRow({ priceType: 'per_stay' }));
  const priced = priceWith(family, optionRow({ priceType: 'per_stay' }), { quantity: 3 });
  const described = family.describe(instance.config, { ...priced, freeUnits: 0, offered: false });
  assert.equal(described.label, 'Petit déjeuner');
  assert.match(described.detail, /^3 × 6,50 €$/);
});


test('rule 47 — fixed: a quantity of units at the unit price, per_stay and free alike; the typed counts stay null', () => {
  const priced = priceWith(family, optionRow({ priceType: 'per_stay' }), { quantity: 3 });
  assert.deepEqual([priced.quantity, priced.unitPrice, priced.billedUnits], [3, 6.5, 3]);
  assert.deepEqual(priced.typed, { billedUnits: 3, cardPersons: null, cardNights: null });
  const free = priceWith(family, optionRow({ priceType: 'free', price: 0 }), { quantity: 2 });
  assert.deepEqual([free.unitPrice, free.billedUnits, free.amounts[0].amountCents], [0, 2, 0]);
});

test('rule 47 — fixed: an unknown price type is a fixed price, like the engine\'s type multiplier always read it', () => {
  assert.equal(article(optionRow({ priceType: 'weird' })).family, 'fixed');
  assert.equal(priceWith(family, optionRow({ priceType: 'weird' }), { quantity: 2 }).billedUnits, 2);
});

test('rule 47 — fixed: untyped (a resource, an insurance) follows the stay multiplier, 1', () => {
  const priced = priceWith(family, optionRow(), { quantity: 2, untyped: true });
  assert.equal(priced.typed, null);
  assert.equal(priced.billedUnits, 2);
});
