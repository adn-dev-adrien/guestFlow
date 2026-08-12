/**
 * Extra-guest per-night tiers — `resolveTierPrice(tiers, nightIndex)`.
 *
 * A supplement can be declared as a table of per-night prices instead of a single price:
 *
 *   [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]
 *     → « 15 € the first night, then 8 € a night »
 *
 * `nightIndex` is 1-based and is the night's rank IN THE STAY, not a calendar position: a 3-night
 * stay is 15 + 8 + 8 whatever seasons it crosses.
 *
 * The last tier carries forward — night 12 costs what night 2 costs — exactly as `progressiveTiers`
 * does for the nightly rate. Without carry-forward a stay longer than the table would fall back to
 * some other rule, which is how a supplement silently stops matching its own declaration.
 *
 * Deliberately NOT combined with the season's length-of-stay discount curve: a tier table already
 * IS a degressivity (15 → 8 is −47 %), and applying the curve on top would bill night 2 at 8 × 0,52
 * = 4,16 € — a halving invisible to whoever reads the recipe. `tariffRecipe.js` rejects a recipe
 * declaring both rather than resolving the ambiguity here.
 * See specs/tariff-events-and-extra-guest-tiers/spec.md §3.1 rules 1-5.
 */

/**
 * Sorted, validated copy of a tier list. Entries without a positive integer `fromNight` or a finite
 * non-negative `price` are dropped: a malformed tier must not silently become 0 €.
 * Returns `null` when nothing usable remains, which every caller reads as « no tiers, use the
 * single price » — the behaviour of every property that has never declared tiers.
 */
function normalizeExtraGuestTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const clean = tiers
    .filter((t) => t && Number.isInteger(Number(t.fromNight)) && Number(t.fromNight) >= 1
      && Number.isFinite(Number(t.price)) && Number(t.price) >= 0)
    .map((t) => ({ fromNight: Number(t.fromNight), price: Number(t.price) }))
    .sort((a, b) => a.fromNight - b.fromNight);
  if (clean.length === 0) return null;
  // Two tiers on the same night: the last one declared wins, so the list stays a function.
  const deduped = [];
  for (const tier of clean) {
    if (deduped.length && deduped[deduped.length - 1].fromNight === tier.fromNight) {
      deduped[deduped.length - 1] = tier;
    } else {
      deduped.push(tier);
    }
  }
  return deduped;
}

/**
 * Price of the `nightIndex`-th night (1-based), or `null` when there are no usable tiers.
 * A stay starting before the first declared tier uses the first tier — the validator requires
 * `fromNight: 1`, so this only guards a hand-edited row.
 */
function resolveTierPrice(tiers, nightIndex) {
  const normalized = normalizeExtraGuestTiers(tiers);
  if (!normalized) return null;
  const index = Math.max(1, Number(nightIndex) || 1);
  let price = normalized[0].price;
  for (const tier of normalized) {
    if (tier.fromNight > index) break;
    price = tier.price;
  }
  return price;
}

/** Total for `count` extra guests over `nights` nights. Used by the channel grid and the tests. */
function totalForNights(tiers, nights, count = 1) {
  const normalized = normalizeExtraGuestTiers(tiers);
  if (!normalized) return null;
  let total = 0;
  for (let i = 1; i <= Math.max(0, Number(nights) || 0); i += 1) {
    total += resolveTierPrice(normalized, i);
  }
  return total * Math.max(0, Number(count) || 0);
}

const ORDINALS = ['', '1ʳᵉ', '2ᵉ', '3ᵉ', '4ᵉ', '5ᵉ', '6ᵉ', '7ᵉ'];

function money(value) {
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

/**
 * Ready-to-render French sentence for a tier table — « 15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit ».
 * Built server-side because the client renders, it does not phrase business rules
 * (CLAUDE.md §6.0), and because the reservation summary, the recipe card and the channel grid must
 * not each invent their own wording.
 */
function describeExtraGuestTiers(tiers) {
  const normalized = normalizeExtraGuestTiers(tiers);
  if (!normalized) return null;
  if (normalized.length === 1) return `${money(normalized[0].price)}/nuit`;
  const parts = normalized.map((tier, i) => {
    const isLast = i === normalized.length - 1;
    if (isLast) return `puis ${money(tier.price)}/nuit`;
    const next = normalized[i + 1].fromNight;
    const span = next - tier.fromNight;
    if (span === 1) {
      return `${money(tier.price)} la ${ORDINALS[tier.fromNight] || `${tier.fromNight}ᵉ`} nuit`;
    }
    return `${money(tier.price)} de la ${ORDINALS[tier.fromNight] || `${tier.fromNight}ᵉ`} à la ${ORDINALS[next - 1] || `${next - 1}ᵉ`} nuit`;
  });
  return parts.join(', ');
}

module.exports = {
  normalizeExtraGuestTiers, resolveTierPrice, totalForNights, describeExtraGuestTiers,
};
