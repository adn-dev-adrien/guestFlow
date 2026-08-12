const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeProgressiveTiers } = require('../utils/pricing');
const { validateRecipe } = require('../utils/tariffRecipe');

// specs/tariff-recipes/spec.md §3.6 rules 36-37 — the degressivity of the source document's §6,
// reproduced exactly, and the commercial promise that must hold at every stay length: a further
// night is never dearer than the one before it. This is the test that catches a future
// well-meaning tier edit breaking either.

// §6 of the source document — one set of percentages for the three seasons.
const DOCUMENT_TABLE = { 2: 24, 3: 33, 4: 38, 5: 41, 6: 43, 7: 45 };

const RECIPE = validateRecipe(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', 'aventura-lodge-2026.json'), 'utf8')),
);

test('the shipped recipe carries the document table (not a paraphrase of it)', () => {
  assert.equal(RECIPE.valid, true, RECIPE.error);
  const declared = Object.fromEntries(
    RECIPE.recipe.lengthOfStayDiscounts.map((row) => [row.nights, row.discountPct]),
  );
  assert.deepEqual(declared, DOCUMENT_TABLE);
});

for (const season of (RECIPE.recipe?.seasons || [])) {
  const { label, pricePerNight: base } = season;

  test(`${label}: the cumulative totals land on the document's percentages to the cent`, () => {
    const tiers = normalizeProgressiveTiers(base, season.progressiveTiers, 7);
    let cumulative = base;
    for (const t of tiers) {
      cumulative = Math.round((cumulative + t.extraNightPrice) * 100) / 100;
      const expected = Math.round(base * t.nightNumber * (1 - DOCUMENT_TABLE[t.nightNumber] / 100) * 100) / 100;
      assert.equal(cumulative, expected, `${label} at ${t.nightNumber} nights`);
    }
  });

  test(`${label}: a further night is never dearer than the previous one, up to 60 nights`, () => {
    const tiers = normalizeProgressiveTiers(base, season.progressiveTiers, 60);
    let previousMarginal = base;
    for (const t of tiers) {
      assert.ok(
        t.extraNightPrice <= previousMarginal + 1e-9,
        `${label} night ${t.nightNumber}: ${t.extraNightPrice} > previous ${previousMarginal}`,
      );
      previousMarginal = t.extraNightPrice;
    }
  });
}

test('past 7 nights the 7th night repeats — a literal « 45 % et plus » would make night 8 dearer', () => {
  const base = 179;
  const season = RECIPE.recipe.seasons.find((s) => s.pricePerNight === base);
  const tiers = normalizeProgressiveTiers(base, season.progressiveTiers, 12);
  const byNight = new Map(tiers.map((t) => [t.nightNumber, t.extraNightPrice]));
  assert.equal(byNight.get(7), 76.97);
  assert.equal(byNight.get(8), 76.97);
  assert.equal(byNight.get(12), 76.97);
  // What the literal reading would have charged for night 8, and why it is rejected.
  const literalNight8 = Math.round((base * 8 * 0.55 - base * 7 * 0.55) * 100) / 100;
  assert.ok(literalNight8 > byNight.get(7), 'the literal reading really does make night 8 dearer');
});

test('the discount deepens with the stay length and never shrinks', () => {
  const base = 179;
  const season = RECIPE.recipe.seasons.find((s) => s.pricePerNight === base);
  const tiers = normalizeProgressiveTiers(base, season.progressiveTiers, 60);
  let cumulative = base;
  let previousDiscount = 0;
  tiers.forEach((t) => {
    cumulative += t.extraNightPrice;
    const discount = 1 - cumulative / (base * t.nightNumber);
    assert.ok(discount >= previousDiscount - 1e-9, `discount shrank at ${t.nightNumber} nights`);
    previousDiscount = discount;
  });
});
