/**
 * PLATFORM PRICE — the accommodation a platform stay is priced at (specs/pricing-components.md §3 rules 17, 50, 70).
 *
 * Contract: `resolvePlatformPrice({ gross, extraGuestsInBrut, platformLines, withheldTax })` →
 * `{ accommodation, commission, payout }`. `accommodation` is the engine's gross pin: the platform's gross less the
 * extra guests billed inside it, less the lines sold through the platform (`inComplement = 0` today), less the tourist
 * tax the platform withheld or reverses, floored at 0 and rounded to the cent; `null` without a gross. `platformLines`
 * is a total or a list of line totals; `withheldTax` is a total or the list `[reversed, withheld]`. `commission` and
 * `payout` are always `null`: the engine never computes a commission from a rate (rule 70), it is a stored figure read
 * by PLATFORM PAYMENT.
 * `grossFromNet(net, commissionPercent, opts)` is the display-only gross-up the platform grid prints.
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('./money');

// Gross-up a net price by a platform commission % so that, after the platform takes its commission,
// the owner nets `net`: gross = (net + fixedCost) / (1 − c/100). c is clamped to [0, 99.99]; a value
// ≥ 100 (would divide by ≤ 0) returns null = "invalid, no price". c ≤ 0 / blank → gross = net.
// specs/platform-price-from-commission.md §3.3 + specs/tariff-recipes/spec.md §3.6 rules 31-33:
//  - `fixedCost` is a per-stay cost the displayed price must cover AFTER commission (the direct
//    channel's welcome pack) — added to the net before the gross-up;
//  - `rounding: 'euro_up'` (the default) ceils to the whole euro: this is a price to DISPLAY on a
//    channel's back office, not an amount to bill. 'cents' keeps the historic 2-decimal rounding.
// Display-only by construction: the two callers are the platform grid and its unit test — no billed
// amount ever flows through here.
function grossFromNet(net, commissionPercent, { fixedCost = 0, rounding = 'euro_up' } = {}) {
  const amount = Number(net || 0) + Math.max(0, Number(fixedCost || 0));
  const finish = (value) => (rounding === 'cents' ? roundMoney(value) : Math.ceil(roundMoney(value)));
  let c = Number(commissionPercent);
  if (!Number.isFinite(c) || c <= 0) return finish(amount);
  if (c >= 100) return null;
  return finish(amount / (1 - c / 100));
}

const sumOf = (value) => (Array.isArray(value)
  ? roundMoney(value.reduce((s, amount) => s + Number(amount || 0), 0))
  : Number(value || 0));

function resolvePlatformPrice({
  gross = null, extraGuestsInBrut = 0, platformLines = 0, withheldTax = 0,
} = {}) {
  const platformGrossPin = gross == null || gross === '' ? null : roundMoney(Number(gross));
  const extraGuestInBrutSurcharge = Number(extraGuestsInBrut || 0);
  const preArrivalOptionsResources = sumOf(platformLines);
  const withheldTerms = Array.isArray(withheldTax) ? withheldTax : [withheldTax];
  const reversedTouristTaxInBrut = Number(withheldTerms[0] || 0);
  const withheldTouristTaxInBrut = Number(withheldTerms[1] || 0);
  const pinnedAccommodation = platformGrossPin != null
    ? roundMoney(Math.max(
      0,
      platformGrossPin - extraGuestInBrutSurcharge - preArrivalOptionsResources
        - reversedTouristTaxInBrut - withheldTouristTaxInBrut,
    ))
    : null;
  return { accommodation: pinnedAccommodation, commission: null, payout: null };
}

// specs/pricing-components.md §3 rule 50 — the settings of this unit, read through SettingsProvider.for('platformPrice', scope).
const settingsSchema = [
  {
    key: 'commissionRate', type: 'number', default: 0, scope: 'global',
    validate: (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) < 100 ? null : 'Un pourcentage inférieur à 100 est attendu.'),
  },
];

module.exports = { resolvePlatformPrice, grossFromNet, settingsSchema };
