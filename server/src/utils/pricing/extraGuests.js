/**
 * EXTRA GUESTS — the supplement for the guests beyond those included (specs/pricing-components.md §3 rules 1, 2, 6).
 *
 * Contract: `computeExtraGuestSurcharge({...})` prices the extra guests of a stay, per stay or per night, from the
 * property's tiers and the nights' seasons; `splitExtraGuestCount({ persons, includedGuests, paidGuests })` tells how
 * many of them a platform already billed inside its gross.
 *
 * Pure: no DB, no clock, no settings. Reads NIGHTS (the season of a night), knows nothing of extras or payments.
 */
const { roundMoney } = require('./money');
const { getRuleNightBaseForDate, parseJsonArray } = require('./nights');
const {
  normalizeExtraGuestTiers, resolveTierPrice, describeExtraGuestTiers,
} = require('../extraGuestTiers');

// specs/tariff-recipes/spec.md §3.6 rules 37-38 — the extra-guest supplement, in either unit.
//   per_stay  (legacy, every existing property): flat `count × unitPrice`, byte-for-byte the
//             pre-recipe behaviour. This branch is the regression guarantee.
//   per_night: each night contributes `count × unitPrice(night) × ratio(night)` where
//             ratio = that night's billed price ÷ its season's full price — so a night sold at 70 %
//             of the rate carries 70 % of the supplement, and a locked snapshot's frozen night
//             prices drive the supplement too. A per-season `pricing_rules.extraGuestPrice`
//             override wins over the property's unit price for the nights it covers; a fixed-mode
//             season yields ratio 1 (a plain per-night fee).
// specs/platform-extra-guest-complement.md §3.3 rule 7 — the extra guests above BOTH the free count and
// what the platform billed are collected on arrival; the others stay inside the brut. No paid base
// (direct, or a brut never entered) → nothing goes to the complement.
function splitExtraGuestCount({ persons, includedGuests, paidGuests }) {
  const extra = Math.max(0, Number(persons || 0) - Math.max(0, Number(includedGuests || 0)));
  if (paidGuests == null) return { complementGuests: 0, inBrutGuests: extra };
  const complementGuests = Math.max(0, Number(persons || 0) - Math.max(Number(includedGuests || 0), Number(paidGuests)));
  return { complementGuests, inBrutGuests: extra - complementGuests };
}

// specs/tariff-recipes/spec.md §3 rule 58 — a sold night keeps the season it was sold under: its full
// price (the ratio's denominator) and the season's extra-guest unit price are carried in the tariff
// snapshot (`extraGuestNights`, by date) and replayed for every night whose price comes from the lock.
// Without it, raising a season after the sale re-priced the supplement of a booking already sold.
function extraGuestNightSeason(rules, date, baseUnit) {
  const { matchedRule, nightlyBase } = getRuleNightBaseForDate(rules, date);
  const override = matchedRule ? Number(matchedRule.extraGuestPrice) : NaN;
  const seasonUnit = Number.isFinite(override) && matchedRule.extraGuestPrice != null
    ? Math.max(0, override)
    : baseUnit;
  return { matchedRule, nightlyBase, seasonUnit };
}

function computeExtraGuestSurcharge({
  unit, extraGuestCount, propertyUnitPrice, nightlyBreakdown, rules, lockedTiers,
  lockedNights = null, lockedDates = null,
}) {
  const count = Math.max(0, Number(extraGuestCount || 0));
  const baseUnit = Math.max(0, Number(propertyUnitPrice || 0));
  if (unit !== 'per_night') {
    return { total: roundMoney(count * baseUnit), ratioTotal: null, unit: 'per_stay' };
  }
  if (!Array.isArray(nightlyBreakdown) || nightlyBreakdown.length === 0) {
    return { total: 0, ratioTotal: 0, unit: 'per_night' };
  }
  // The tiers are resolved even with nobody above the included guests: the tariff snapshot stores
  // them, and a party that grows after the sale must be billed at the table it was sold under — a
  // count of 0 at the sale used to store « no tiers » and bill the newcomer 0 € (spec review
  // 2026-10-27, tariff-events-and-extra-guest-tiers rule 23).
  let total = 0;
  let ratioTotal = 0;
  let tiers = null;
  for (let index = 0; index < nightlyBreakdown.length; index += 1) {
    const night = nightlyBreakdown[index];
    const live = extraGuestNightSeason(rules, night.date, baseUnit);
    const { matchedRule } = live;
    const sold = lockedNights && lockedDates && lockedDates.has(String(night.date))
      ? lockedNights[String(night.date)]
      : null;
    const nightlyBase = sold && Number.isFinite(Number(sold.base)) ? Number(sold.base) : live.nightlyBase;
    // A tier table already encodes the degressivity, so the season ratio must NOT compose with it:
    // night 2 costs its declared 8 €, not 8 × 0,52. The tier index is the night's rank in the STAY.
    // A sold reservation replays the tier table it was sold under; a fresh quote reads the season's.
    const nightTiers = lockedTiers !== undefined
      ? parseJsonArray(lockedTiers)
      : (matchedRule ? parseJsonArray(matchedRule.extraGuestTiers) : []);
    const tierPrice = resolveTierPrice(nightTiers, index + 1);
    if (tierPrice != null) {
      if (!tiers) tiers = normalizeExtraGuestTiers(nightTiers);
      ratioTotal += 1;
      total += count * tierPrice;
      continue;
    }
    const seasonUnit = sold && Number.isFinite(Number(sold.unit)) ? Math.max(0, Number(sold.unit)) : live.seasonUnit;
    const ratio = nightlyBase > 0 ? Number(night.price || 0) / nightlyBase : 1;
    ratioTotal += ratio;
    total += count * seasonUnit * ratio;
  }
  return {
    total: roundMoney(total),
    ratioTotal: count > 0 ? roundMoney(ratioTotal) : 0,
    unit: 'per_night',
    tiers,
    label: tiers ? describeExtraGuestTiers(tiers) : null,
  };
}

module.exports = {
  splitExtraGuestCount,
  extraGuestNightSeason,
  computeExtraGuestSurcharge,
};
