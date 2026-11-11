// specs/pricing-components.md §3 rule 57 — every registered article family, the seven core ones and `hourly`, goes through the
// same cases: validate refuses out-of-bounds, price is deterministic and shaped the same, tagged amounts carry no VAT,
// describe matches the quote.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../utils/pricing/articles/registry');
const articles = require('../utils/pricing/articles');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const {
  STAY, optionRow, resourceRow, article, NO_VAT_KEYS,
} = require('./articlesFixtures');

const hourlyPricing = optionalPlugin(() => require('../plugins/hourly-resources/pricing'));
const hourlyFamily = optionalPlugin(() => require('../plugins/hourly-resources/hourlyFamily'));
const HOURLY_SKIP = skipWithout(['hourly-resources']);
if (!HOURLY_SKIP) registry.register('hourly', hourlyFamily.createHourlyFamily(hourlyPricing.createHourlyContributor()), { owner: 'hourly-resources' });

const MOMENTS = [{ date: '2027-07-01', time: '08:00' }, { date: '2027-07-02', time: '08:00' }]; // date-literal-ok: pure function input
const SESSIONS = [{ date: '2027-07-01', start: '18:00', end: '20:00' }]; // date-literal-ok: pure function input

// family id → [catalogue row, kind, request]
const CASES = {
  fixed: [optionRow({ priceType: 'per_stay' }), 'option', { quantity: 3 }],
  perUnit: [optionRow({ priceType: 'per_person', showsPlanningCard: 1 }), 'option', { quantity: 2, occurrences: MOMENTS }],
  perNight: [optionRow({ priceType: 'per_night' }), 'option', { quantity: 2 }],
  perPerson: [optionRow({ priceType: 'per_person' }), 'option', { quantity: 2 }],
  perPersonPerNight: [optionRow({ priceType: 'per_person_per_night' }), 'option', { quantity: 1 }],
  percentOfStay: [optionRow({ priceType: 'percent_of_stay', price: 4 }), 'option', { quantity: 1 }],
  perParticipantProgressive: [optionRow({ priceType: 'per_participant_progressive', price: 10, optionProgressiveTiers: [{ participantNumber: 3, unitPrice: 5 }] }), 'option', { quantity: 4 }],
  hourly: [resourceRow({ hourlyEveningRate: 50, hourlyEveningStart: '19:00', slotDuration: 60, openTime: '08:00', closeTime: '23:00' }), 'resource', { quantity: 2, selected: { quantity: 2, sessions: SESSIONS }, sold: false }],
};

const registered = () => registry.ids();

test('rule 57 — the registry holds the seven core families and the hourly one, each with a case below', { skip: HOURLY_SKIP }, () => {
  assert.deepEqual([...registered()].sort(), Object.keys(CASES).sort());
});

for (const [id, [row, kind, request]] of Object.entries(CASES)) {
  const family = () => registry.get(id);
  const instance = () => article(row, kind);
  const pricedWith = () => family().price(instance().config, { ref: instance().ref, ...request }, STAY);

  test(`rule 57 — ${id}: the family is a contract of plain functions with a config schema`, { skip: id === 'hourly' && HOURLY_SKIP }, () => {
    assert.equal(family().id, id);
    for (const member of ['validate', 'price', 'describe']) assert.equal(typeof family()[member], 'function', member);
    assert.ok(family().configSchema.length > 0);
    for (const entry of family().configSchema) {
      assert.deepEqual(Object.keys(entry).sort(), ['default', 'key', 'scope', 'type', 'validate'], entry.key);
      assert.equal(entry.validate(entry.default === '' && entry.key === 'vatClass' ? 'options' : entry.default), null, `${id}.${entry.key} default`);
    }
  });

  test(`rule 57 — ${id}: validate refuses out-of-bounds quantities and accepts a count`, { skip: id === 'hourly' && HOURLY_SKIP }, () => {
    for (const quantity of [-1, NaN, 'x']) {
      assert.ok(family().validate(instance().config, { ...request, quantity }, STAY).length > 0, String(quantity));
    }
    assert.deepEqual(family().validate(instance().config, { ...request }, STAY), []);
  });

  test(`rule 57 — ${id}: price is deterministic and shaped the same`, { skip: id === 'hourly' && HOURLY_SKIP }, () => {
    const first = pricedWith();
    assert.deepEqual(first, pricedWith());
    for (const key of ['quantity', 'unitPrice', 'billedUnits']) assert.ok(Number.isFinite(first[key]) && first[key] >= 0, key);
    assert.ok(Array.isArray(first.components));
    assert.ok(Number.isFinite(first.allowanceUsed) && first.allowanceUsed >= 0);
    assert.ok(Array.isArray(first.amounts));
  });

  test(`rule 57 — ${id}: tagged amounts name their source and carry no VAT`, { skip: id === 'hourly' && HOURLY_SKIP }, () => {
    for (const amount of pricedWith().amounts) {
      assert.ok(Number.isInteger(amount.amountCents));
      assert.equal(amount.customerContext, 'hosted');
      assert.deepEqual(amount.source, { kind: 'line', ref: instance().ref });
      assert.equal(typeof amount.vatClass, 'string');
      NO_VAT_KEYS.forEach((key) => assert.equal(key in amount, false, key));
    }
  });

  test(`rule 57 — ${id}: describe matches the quote`, { skip: id === 'hourly' && HOURLY_SKIP }, () => {
    const priced = pricedWith();
    const described = family().describe(instance().config, { ...priced, ...(priced.extra || {}), freeUnits: 0, offered: false });
    assert.equal(described.label, instance().config.label);
    const units = String(priced.billedUnits).replace('.', ',');
    if (id === 'percentOfStay') assert.match(described.detail, /4 % du séjour/);
    else assert.ok(described.detail.startsWith(`${units} `), `${described.detail} should open with ${units}`);
  });
}

test('rule 57 — through the head, every core family gives the same line shape', () => {
  for (const [id, [row, kind]] of Object.entries(CASES)) {
    if (id === 'hourly' || id === 'perUnit') continue;
    const line = articles.quote({ requests: [{ article: article(row, kind), quantity: 1 }], stayContext: STAY }).lines[0];
    assert.deepEqual(Object.keys(line.offeredFigures), ['originalTotalPrice', 'totalPrice', 'offered'], id);
    assert.equal(line.taggedAmounts[0].amountCents, Math.round(line.offeredFigures.totalPrice * 100), id);
  }
});

test('rule 47 and 65 — a family prices with its own formula whatever config.priceType says', () => {
  const stay = { ...STAY, persons: 4, nights: 3 };
  const units = (id) => {
    const config = { ...article(optionRow({ priceType: 'per_night' }), 'option').config };
    return registry.get(id).price(config, { ref: 'option:1', quantity: 1, untyped: true }, stay).billedUnits;
  };
  assert.deepEqual(['fixed', 'perNight', 'perPersonPerNight'].map(units), [1, 3, 12]);
});

test('rule 47 — the head dispatches a price type to the family namesake and an unknown type to fixed', () => {
  assert.equal(articles.getTypeMultiplier('per_person_per_night', 4, 3), 12);
  assert.equal(articles.getTypeMultiplier('per_night', 4, 3), 3);
  assert.equal(articles.getTypeMultiplier('per_person', 4, 3), 4);
  for (const type of ['per_stay', 'free', 'percent_of_stay', 'per_hour', 'toString', undefined]) assert.equal(articles.getTypeMultiplier(type, 4, 3), 1, String(type));
});
