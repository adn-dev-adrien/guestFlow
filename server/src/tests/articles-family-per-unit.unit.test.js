// specs/pricing-components.md §3 rules 47 and 57 — article family `perUnit`: n moments placed on a planning card, or n portions still to place
const test = require('node:test');
const assert = require('node:assert/strict');
const { family } = require('../utils/pricing/articles/families/perUnit');
const {
  STAY, optionRow, article, priceWith, NO_VAT_KEYS, taggedShape,
} = require('./articlesFixtures');

test('rule 47 — the family declares its contract: id, config schema, validate, price, describe', () => {
  assert.equal(family.id, 'perUnit');
  assert.ok(Array.isArray(family.configSchema) && family.configSchema.every((entry) => entry.key && entry.validate));
  for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family[member], 'function');
});

test('rule 47 — validate refuses a quantity that is not a count', () => {
  const instance = article(optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }));
  for (const quantity of [-1, NaN, 'x', undefined]) {
    assert.deepEqual(family.validate(instance.config, { quantity }, STAY).map((r) => r.code), ['INVALID_QUANTITY'], String(quantity));
  }
  assert.deepEqual(family.validate(instance.config, { quantity: 0 }, STAY), []);
});

test('rule 47 — price is deterministic and emits a tagged amount without any VAT', () => {
  const first = priceWith(family, optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }), { quantity: 2 });
  const second = priceWith(family, optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }), { quantity: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.amounts.length, 1);
  const [amount] = first.amounts;
  assert.equal(taggedShape(amount), 'amountCents,customerContext,docKey,source,vatClass');
  assert.equal(amount.vatClass, 'options');
  assert.equal(amount.customerContext, 'hosted');
  assert.deepEqual(amount.source, { kind: 'line', ref: 'option:7' });
  NO_VAT_KEYS.forEach((key) => assert.equal(key in amount, false, key));
  assert.equal(amount.amountCents, 1300);
});

test('rule 47 — describe prints the label and the detail of the quoted line', () => {
  const instance = article(optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }));
  const priced = priceWith(family, optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }), { quantity: 2 });
  const described = family.describe(instance.config, { ...priced, freeUnits: 0, offered: false });
  assert.equal(described.label, 'Petit déjeuner');
  assert.match(described.detail, /^2 × 6,50 €$/);
});


test('rule 47 — perUnit: the placed moments are the units, times the covers when the option is per person', () => {
  const moments = [{ date: '2027-07-01', time: '08:00' }, { date: '2027-07-02', time: '08:00' }, { date: '2027-07-03', time: '08:00' }]; // date-literal-ok: pure function input
  const stay = priceWith(family, optionRow({ priceType: 'per_stay', showsPlanningCard: 1 }), { occurrences: moments });
  assert.deepEqual([stay.quantity, stay.billedUnits, stay.cardPersons], [3, 3, null]);
  const perPerson = priceWith(family, optionRow({ priceType: 'per_person', showsPlanningCard: 1 }), { occurrences: moments });
  assert.deepEqual([perPerson.quantity, perPerson.billedUnits, perPerson.cardPersons], [3, 12, null]);
});

test('rule 47 — perUnit: fewer covers than the party are stored, never more than the capacity', () => {
  const row = optionRow({ priceType: 'per_person', showsPlanningCard: 1 });
  const moments = [{ date: '2027-07-01', time: '08:00' }, { date: '2027-07-02', time: '08:00' }]; // date-literal-ok: pure function input
  assert.deepEqual([priceWith(family, row, { occurrences: moments, cardPersons: 2 }).billedUnits, priceWith(family, row, { occurrences: moments, cardPersons: 2 }).cardPersons], [4, 2]);
  assert.equal(priceWith(family, row, { occurrences: moments, cardPersons: 99 }).billedUnits, 12);
});

test('rule 47 — perUnit: no moment placed yet, the quantity is the portions to place', () => {
  const priced = priceWith(family, optionRow({ priceType: 'per_person', showsPlanningCard: 1 }), { quantity: 5, occurrences: [] });
  assert.deepEqual([priced.quantity, priced.billedUnits, priced.cardPersons], [5, 5, null]);
});

test('rule 47 — perUnit: an option with a planning card is counted in moments, an insurance or a percentage is not', () => {
  assert.equal(article(optionRow({ showsPlanningCard: 1 })).family, 'perUnit');
  assert.equal(article(optionRow({ showsPlanningCard: 1, priceType: 'percent_of_stay' })).family, 'percentOfStay');
  assert.equal(article(optionRow({ showsPlanningCard: 1, isCancellationInsurance: 1 })).family, 'fixed');
  assert.equal(article(optionRow({ showsPlanningCard: 1 }), 'resource').family, 'fixed');
});
