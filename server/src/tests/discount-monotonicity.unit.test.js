const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeProgressiveTiers } = require('../utils/pricing');

// specs/tariff-recipes/spec.md §3.6 rules 36-37 — the commercial promise the Aventura curve must
// keep at every stay length: marginal night prices never increase (a further night is never dearer
// than the one before it), and a 7-night stay lands on the source document's 45 % discount.
// This is the test that catches a future well-meaning tier edit breaking either.

const RATIO = 0.475;
const r2 = (v) => Math.round(v * 100) / 100;

const SEASONS = [
  { label: 'LOW', base: 179 },
  { label: 'MID', base: 216 },
  { label: 'HIGH', base: 247 },
];

for (const { label, base } of SEASONS) {
  const tier = r2(base * RATIO);

  test(`${label}: marginal nights never increase, up to 60 nights`, () => {
    const tiers = normalizeProgressiveTiers(base, [{ nightNumber: 2, extraNightPrice: tier }], 60);
    let previousMarginal = base;
    for (const t of tiers) {
      assert.ok(
        t.extraNightPrice <= previousMarginal + 1e-9,
        `${label} night ${t.nightNumber}: ${t.extraNightPrice} > previous ${previousMarginal}`,
      );
      previousMarginal = t.extraNightPrice;
    }
  });

  test(`${label}: a 7-night stay is discounted 45 % (the source document's target)`, () => {
    const tiers = normalizeProgressiveTiers(base, [{ nightNumber: 2, extraNightPrice: tier }], 7);
    const total = base + tiers.reduce((sum, t) => sum + t.extraNightPrice, 0);
    const discount = 1 - total / (base * 7);
    assert.ok(
      Math.abs(discount - 0.45) < 0.001,
      `${label}: 7-night discount ${(discount * 100).toFixed(2)} % should be 45 %`,
    );
  });
}

test('the discount deepens monotonically with the stay length and settles near 52,5 %', () => {
  const base = 179;
  const tiers = normalizeProgressiveTiers(base, [{ nightNumber: 2, extraNightPrice: r2(base * RATIO) }], 365);
  let cumulative = base;
  let previousDiscount = 0;
  tiers.forEach((t, index) => {
    cumulative += t.extraNightPrice;
    const nights = index + 2;
    const discount = 1 - cumulative / (base * nights);
    assert.ok(discount >= previousDiscount - 1e-9, `discount shrank at ${nights} nights`);
    previousDiscount = discount;
  });
  // Asymptote = 1 − ratio; never reached, always approached from below.
  assert.ok(previousDiscount > 0.52 && previousDiscount < 1 - RATIO + 1e-6);
});
