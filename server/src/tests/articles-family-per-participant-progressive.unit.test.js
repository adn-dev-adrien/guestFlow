// specs/pricing-components.md §3 rules 47 and 57 — article family `perParticipantProgressive`: a unit price that changes with the participant rank
const test = require('node:test');
const assert = require('node:assert/strict');
const { family } = require('../utils/pricing/articles/families/perParticipantProgressive');
const {
  STAY, optionRow, article, priceWith, NO_VAT_KEYS, taggedShape,
} = require('./articlesFixtures');

test('rule 47 — the family declares its contract: id, config schema, validate, price, describe', () => {
  assert.equal(family.id, 'perParticipantProgressive');
  assert.ok(Array.isArray(family.configSchema) && family.configSchema.every((entry) => entry.key && entry.validate));
  for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family[member], 'function');
});

test('rule 47 — validate refuses a quantity that is not a count', () => {
  const instance = article(optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }));
  for (const quantity of [-1, NaN, 'x', undefined]) {
    assert.deepEqual(family.validate(instance.config, { quantity }, STAY).map((r) => r.code), ['INVALID_QUANTITY'], String(quantity));
  }
  assert.deepEqual(family.validate(instance.config, { quantity: 0 }, STAY), []);
});

test('rule 47 — price is deterministic and emits a tagged amount without any VAT', () => {
  const first = priceWith(family, optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }), { quantity: 4 });
  const second = priceWith(family, optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }), { quantity: 4 });
  assert.deepEqual(first, second);
  assert.equal(first.amounts.length, 1);
  const [amount] = first.amounts;
  assert.equal(taggedShape(amount), 'amountCents,customerContext,docKey,source,vatClass');
  assert.equal(amount.vatClass, 'options');
  assert.equal(amount.customerContext, 'hosted');
  assert.deepEqual(amount.source, { kind: 'line', ref: 'option:7' });
  NO_VAT_KEYS.forEach((key) => assert.equal(key in amount, false, key));
  assert.equal(amount.amountCents, 3000);
});

test('rule 47 — describe prints the label and the detail of the quoted line', () => {
  const instance = article(optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }));
  const priced = priceWith(family, optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }), { quantity: 4 });
  const described = family.describe(instance.config, { ...priced, freeUnits: 0, offered: false });
  assert.equal(described.label, 'Petit déjeuner');
  assert.match(described.detail, /tarif dégressif/);
});


test('rule 47 — perParticipantProgressive: each participant pays the tier of their rank', () => {
  const row = optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }, { participantNumber: 1, unitPrice: 10 }] });
  const priced = priceWith(family, row, { quantity: 4 });
  assert.deepEqual([priced.billedUnits, priced.computed.totalPrice, priced.unitPrice, priced.computed.lastUnitPrice], [4, 30, 7.5, 5]);
  assert.deepEqual(priced.tiers.map((t) => t.participantNumber), [1, 3]);
});

test('rule 47 — perParticipantProgressive: tiers stored as JSON text read the same; none falls back to the unit price', () => {
  const asText = optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: '[{"participantNumber":2,"unitPrice":4}]' });
  assert.equal(priceWith(family, asText, { quantity: 3 }).computed.totalPrice, 18);
  const none = optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: null });
  assert.equal(priceWith(family, none, { quantity: 3 }).computed.totalPrice, 30);
});

test('rule 47 — perParticipantProgressive: a quantity of 0 prices nothing', () => {
  const priced = priceWith(family, optionRow({ priceType: 'per_participant_progressive', price: 10 }), { quantity: 0 });
  assert.deepEqual([priced.billedUnits, priced.unitPrice, priced.computed.totalPrice], [0, 0, 0]);
});

test('rule 47 — perParticipantProgressive: the tier helpers are the ones the pricing module has always exported', () => {
  const module_ = require('../utils/pricing/articles/families/perParticipantProgressive');
  const pricing = require('../utils/pricing');
  assert.equal(pricing.calculateProgressiveParticipantOptionTotal, module_.calculateProgressiveParticipantOptionTotal);
  assert.equal(pricing.normalizeOptionProgressiveTiers, module_.normalizeOptionProgressiveTiers);
});
