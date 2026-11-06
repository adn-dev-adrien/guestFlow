// A price lever never discounts the tourist tax itself (study of HIPPOCAMP, 2026-11-05: a −10 % promotion
// lowered a stay's tax there): specs/finance-data-checks.md §3 rule 11.
//   - per adult and night: the tax reads the rate, the adults and the nights, nothing else — a discount, an
//     adjusted price, an offered line, an offered extra-guest supplement, a pinned platform brut leave it whole;
//   - percentage of the accommodation: the lever reaches the tax only through its legal base, the
//     accommodation charged (tourist-tax-matches-the-office-calculation rules 2-3), never as a reduction of the
//     tax line: the tax is always the commune's percentage of that base, and the stay total adds it whole.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, seed, liveQuote } = require('./ledgerFixture');
const { computeTouristTaxBreakdown } = require('../utils/pricing');

seed();
db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('CanalRev', 1, 0)").run();

const dates = { startDate: inDays(300), endDate: inDays(303) };
const quote = (over = {}) => liveQuote(null, { ...dates, adults: 2, ...over });
const offeredLine = { customKey: 'Geste', description: 'Geste', amount: 80, offered: true, inComplement: 0 };

const LEVERS = [
  ['a discount', { discountPercent: 30 }],
  ['an adjusted accommodation price', { customPrice: 120 }],
  ['an offered line', { customOptions: [offeredLine] }],
  ['an offered extra-guest supplement', { adults: 2, extraGuestSurchargeOffered: 1 }],
];

test('rule 11: per adult and night, no price lever moves the tax', async () => {
  const plain = await quote({ propertyId: 1 });
  assert.equal(plain.touristTaxTotal, 7.2, '1,20 € × 2 adults × 3 nights');
  for (const [name, over] of LEVERS) {
    const levered = await quote({ propertyId: 1, ...over });
    assert.equal(levered.touristTaxTotal, plain.touristTaxTotal, name);
  }
  // The levers are real: the discount and the adjusted price did lower what the stay costs.
  assert.ok((await quote({ propertyId: 1, discountPercent: 30 })).finalPrice < plain.finalPrice);
  assert.ok((await quote({ propertyId: 1, customPrice: 120 })).finalPrice < plain.finalPrice);
  const brut = await quote({ propertyId: 1, platform: 'CanalRev', platformGrossAmount: 150 });
  assert.equal(brut.touristTaxTotal, plain.touristTaxTotal, 'a pinned platform brut');
});

test('rule 11: per adult and night, the stay total adds the tax whole', async () => {
  for (const [name, over] of LEVERS) {
    const levered = await quote({ propertyId: 1, ...over });
    assert.equal(Math.round((levered.totalStayPrice - levered.finalPrice) * 100) / 100, levered.touristTaxTotal, name);
  }
});

test('rule 11: percentage of the accommodation, the tax is the percentage of the base charged, never a reduced tax line', async () => {
  for (const [name, over] of [['no lever', {}], ...LEVERS]) {
    const q = await quote({ propertyId: 2, ...over });
    const fromBase = computeTouristTaxBreakdown({
      touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, nights: q.touristTaxNights,
      adults: q.touristTaxAdultsCount, occupants: q.touristTaxOccupantsCount, accommodationAmountTtc: q.touristTaxBaseAccommodation,
      accommodationVatRate: q.vatPercentageAccommodation,
    }).touristTaxTotal;
    assert.equal(q.touristTaxTotal, fromBase, name);
    assert.equal(Math.round((q.totalStayPrice - q.finalPrice) * 100) / 100, q.touristTaxTotal, `${name}: the total adds it whole`);
  }
  const plain = await quote({ propertyId: 2 });
  const discounted = await quote({ propertyId: 2, discountPercent: 30 });
  assert.ok(discounted.touristTaxBaseAccommodation < plain.touristTaxBaseAccommodation, 'the discount reached the base');
});

test('rule 11: percentage of the accommodation, an offered line leaves the base and the tax unchanged', async () => {
  const plain = await quote({ propertyId: 2 });
  const offered = await quote({ propertyId: 2, customOptions: [offeredLine] });
  assert.ok(plain.touristTaxTotal > 0);
  assert.equal(offered.touristTaxBaseAccommodation, plain.touristTaxBaseAccommodation);
  assert.equal(offered.touristTaxTotal, plain.touristTaxTotal);
});
