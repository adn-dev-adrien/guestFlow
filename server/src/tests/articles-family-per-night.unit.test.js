// specs/pricing-components.md §3 rules 47 and 57 — article family `perNight`: one price per night counted
const test = require('node:test');
const assert = require('node:assert/strict');
const { family } = require('../utils/pricing/articles/families/perNight');
const {
  STAY, optionRow, article, priceWith, NO_VAT_KEYS, taggedShape,
} = require('./articlesFixtures');

test('rule 47 — the family declares its contract: id, config schema, validate, price, describe', () => {
  assert.equal(family.id, 'perNight');
  assert.ok(Array.isArray(family.configSchema) && family.configSchema.every((entry) => entry.key && entry.validate));
  for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family[member], 'function');
});

test('rule 47 — validate refuses a quantity that is not a count', () => {
  const instance = article(optionRow({ priceType: 'per_night' }));
  for (const quantity of [-1, NaN, 'x', undefined]) {
    assert.deepEqual(family.validate(instance.config, { quantity }, STAY).map((r) => r.code), ['INVALID_QUANTITY'], String(quantity));
  }
  assert.deepEqual(family.validate(instance.config, { quantity: 0 }, STAY), []);
});

test('rule 47 — price is deterministic and emits a tagged amount without any VAT', () => {
  const first = priceWith(family, optionRow({ priceType: 'per_night' }), { quantity: 1 });
  const second = priceWith(family, optionRow({ priceType: 'per_night' }), { quantity: 1 });
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
  const instance = article(optionRow({ priceType: 'per_night' }));
  const priced = priceWith(family, optionRow({ priceType: 'per_night' }), { quantity: 1 });
  const described = family.describe(instance.config, { ...priced, freeUnits: 0, offered: false });
  assert.equal(described.label, 'Petit déjeuner');
  assert.match(described.detail, /^3 × 6,50 €$/);
});


test('rule 47 — perNight: the nights of the stay, or the typed count of nights', () => {
  const row = optionRow({ priceType: 'per_night' });
  const followed = priceWith(family, row, { quantity: 1 });
  assert.deepEqual([followed.billedUnits, followed.typed.cardNights, followed.typed.servedNights], [3, null, 3]);
  const typed = priceWith(family, row, { quantity: 2, cardNights: 2 });
  assert.deepEqual([typed.billedUnits, typed.typed.cardNights, typed.typed.servedNights], [4, 2, 4]);
});

test('rule 47 — perNight: untyped follows the stay nights', () => {
  assert.equal(priceWith(family, optionRow({ priceType: 'per_night' }), { quantity: 1, untyped: true }).billedUnits, 3);
});

test('rule 47 — perNight: validate needs the nights of the stay', () => {
  const instance = article(optionRow({ priceType: 'per_night' }));
  assert.deepEqual(family.validate(instance.config, { quantity: 1 }, { persons: 2 }).map((r) => r.code), ['STAY_NIGHTS_MISSING']);
});
