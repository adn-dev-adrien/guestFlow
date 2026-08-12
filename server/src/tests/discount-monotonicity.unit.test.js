const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeProgressiveTiers } = require('../utils/pricing');

// specs/tariff-recipes/spec.md §3.6 rules 36-37 — the commercial promise the Aventura curve must
// keep at every stay length: marginal night prices never increase, and the cumulative discount
// never exceeds 30 %. This is the test that catches a future well-meaning tier edit breaking it.

const SEASONS = [
  { label: 'LOW', base: 179, tier: 125.30 },
  { label: 'MID', base: 216, tier: 151.20 },
  { label: 'HIGH', base: 247, tier: 172.90 },
];

for (const { label, base, tier } of SEASONS) {
  test(`${label}: marginal nights non-increasing and total discount ≤ 30 % up to 60 nights`, () => {
    const tiers = normalizeProgressiveTiers(base, [{ nightNumber: 2, extraNightPrice: tier }], 60);
    let cumulative = base;
    let previousMarginal = base;
    for (const t of tiers) {
      assert.ok(
        t.extraNightPrice <= previousMarginal + 1e-9,
        `${label} night ${t.nightNumber}: ${t.extraNightPrice} > previous ${previousMarginal}`,
      );
      previousMarginal = t.extraNightPrice;
      cumulative += t.extraNightPrice;
      const nights = t.nightNumber;
      const discount = 1 - cumulative / (base * nights);
      assert.ok(discount <= 0.30 + 1e-9, `${label} ${nights} nights: discount ${(discount * 100).toFixed(2)} % > 30 %`);
    }
  });
}

test('the discount is asymptotic: it approaches 30 % without reaching it (spec rule 36)', () => {
  const tiers = normalizeProgressiveTiers(179, [{ nightNumber: 2, extraNightPrice: 125.30 }], 365);
  const total365 = 179 + tiers.reduce((s, t) => s + t.extraNightPrice, 0);
  const discount365 = 1 - total365 / (179 * 365);
  assert.ok(discount365 > 0.295 && discount365 < 0.30);
});
