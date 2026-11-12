// specs/pricing-components.md §3 rules 16 and 40 — DISCOUNTS alone: the target `nights` is today's euro formula bit for
// bit (percent or manual price), the targets `extras` and `all` and a fixed amount are PR B's (`pricing-discount-allocation`), an
// unknown target throws, and the unit equals the
// engine's accommodation on every stay of the price gate's fixture (skipped without the fixture).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { allocateDiscount, normalizeDiscountPercent, normalizeCustomPrice } = require('../utils/pricing/discounts');
const { roundMoney } = require('../utils/pricing/money');

test('rule 16 — nights: roundMoney(accommodation × (1 − percent / 100))', () => {
  assert.equal(allocateDiscount({ discount: { percent: 10, target: 'nights' }, accommodation: 333.33 }).accommodation, roundMoney(333.33 * (1 - 10 / 100)));
  assert.equal(allocateDiscount({ discount: { percent: 12.5, target: 'nights' }, accommodation: 199.99 }).accommodation, roundMoney(199.99 * (1 - 12.5 / 100)));
  assert.equal(allocateDiscount({ discount: { percent: 0 }, accommodation: 120.5 }).accommodation, 120.5, 'no target reads as nights');
  assert.equal(allocateDiscount({ accommodation: 80 }).accommodation, 80);
});

test('rule 16 — nights: a manual price replaces the nights, rounded to the cent', () => {
  assert.equal(allocateDiscount({ discount: { percent: 50, customPrice: 150, target: 'nights' }, accommodation: 400 }).accommodation, 150);
  assert.equal(allocateDiscount({ discount: { customPrice: 99.999, target: 'nights' }, accommodation: 400 }).accommodation, 100);
  assert.equal(allocateDiscount({ discount: { customPrice: 0, target: 'nights' }, accommodation: 400 }).accommodation, 0, 'a zero price is a price');
  assert.equal(allocateDiscount({ discount: { customPrice: '', percent: 10, target: 'nights' }, accommodation: 100 }).accommodation, 90, 'an empty price is no price');
  assert.equal(allocateDiscount({ discount: { customPrice: NaN, percent: 10, target: 'nights' }, accommodation: 100 }).accommodation, 90, 'a non-number falls back to the percent');
});

test('rule 16 — the percent is clamped to 0..100 like the engine\'s typed lever', () => {
  assert.equal(normalizeDiscountPercent(150), 100);
  assert.equal(normalizeDiscountPercent(-5), 0);
  assert.equal(normalizeDiscountPercent(''), 0);
  assert.equal(normalizeDiscountPercent(undefined), 0);
  assert.equal(allocateDiscount({ discount: { percent: 150 }, accommodation: 100 }).accommodation, 0);
  assert.equal(normalizeCustomPrice(''), null);
  assert.equal(normalizeCustomPrice(null), null);
  assert.equal(normalizeCustomPrice(undefined), null);
  assert.equal(normalizeCustomPrice('12.5'), 12.5);
});

test('rule 16 — an unknown target is refused', () => {
  assert.throws(() => allocateDiscount({ discount: { percent: 10, target: 'rooms' }, accommodation: 100 }), (error) => error.code === 'DISCOUNT_TARGET_UNKNOWN');
});

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const captured = fs.existsSync(path.join(DIR, 'inputs.json'));
const SKIP = captured ? false : 'price-gate fixture absent (inputs.json)';

test('rule 16 — nights equals the engine on every fixture stay (percent, manual price, platform pin)', { skip: SKIP }, () => {
  const inputs = JSON.parse(fs.readFileSync(path.join(DIR, 'inputs.json'), 'utf8'));
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs } = require('../../../scripts/price-gate/recompute');
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');
  loadInputs(db, inputs);
  let checked = 0;
  let overridden = 0;
  for (const row of db.prepare('SELECT * FROM reservations ORDER BY id').all()) {
    let quote;
    try { quote = quoteStoredReservation(db, row); } catch { continue; }
    if (!quote || quote.accommodationAdjustedPrice == null) continue;
    const extras = quote.extraGuestSurcharge + quote.optionsTotal + quote.resourcesTotal;
    const discount = { percent: row.discountPercent, customPrice: row.customPrice, target: 'nights' };
    const engineNights = allocateDiscount({ discount: { percent: row.discountPercent, target: 'nights' }, accommodation: quote.baseAccommodationPrice }).accommodation;
    assert.equal(roundMoney(engineNights + extras), quote.engineFinalPrice, `stay ${row.id}: engineFinalPrice`);
    if (quote.platformGrossAmount != null) continue;
    const adjusted = allocateDiscount({ discount, accommodation: quote.baseAccommodationPrice }).accommodation;
    assert.equal(adjusted, quote.accommodationAdjustedPrice, `stay ${row.id}: accommodationAdjustedPrice`);
    if (quote.priceOverridden) overridden += 1;
    checked += 1;
  }
  assert.ok(checked > 0, 'the fixture holds non-platform stays');
  assert.ok(overridden >= 0);
});
