/**
 * Is the price a platform sold a stay at far from the « Prix plateformes » grid of that channel?
 * (specs/reservation-payment-ledger.md §3.8, rules 58-61 and 63.)
 *
 * Our own tariff always differs from what a platform charges — the platform's price is the grid, grossed
 * up by its commission — so comparing with the tariff would fire on every platform stay. Comparing with
 * the grid of THAT channel fires only when the channel is not listed at what the grid says: a season left
 * at another season's price, a missing extra-guest price or cleaning fee, a promotion stacked on another.
 *
 * Pure: the caller hands over the quote, the seasons, the grid (`propertiesModel.platformPrices`) and the
 * journal answer; the numbers it prints are the numbers the grid displays.
 */

const { isDirectChannel } = require('./platformNameFormat');
const { matchNightRule } = require('./pricing');

const BELOW_PERCENT = -15;
const ABOVE_PERCENT = 25;
const MIN_GAP_EUR = 30;

const cents = (value) => Math.round(Number(value || 0) * 100) / 100;

function seasonRatio(billed, grid) {
  return Number(billed) > 0 && Number.isFinite(Number(grid)) ? Number(grid) / Number(billed) : null;
}

/**
 * @param {object} p
 * @param {object} p.quote                 the live quote (`platformGrossAmount`, `accommodationAdjustedPrice`,
 *                                         `extraGuestInBrutSurcharge`, `nightlyBreakdown`, `unpricedNights`)
 * @param {{kind: string, startDate: string, platform: string, propertyId: number}} p.stay
 * @param {boolean} p.nightsReplayed       the nights come from the sale's stored snapshot
 * @param {() => {rules: Array, property: {extraGuestPrice?: number}, grid: {platforms: Array, seasons: Array},
 *            tariffChangedSinceBooking: boolean}} p.loadContext
 *        read only once the cheap guards pass, so a direct stay costs nothing: the property's
 *        `pricing_rules` rows, `propertiesModel.platformPrices(propertyId)` and the journal's answer
 *        (an event dated after the booking date)
 * @param {string} p.today                 YYYY-MM-DD
 * @returns {null | {platformLabel, paid, expected, gap, gapPercent, direction, gridPath}}
 */
function platformPriceCheck({
  quote, stay, nightsReplayed, loadContext, today,
}) {
  if (!quote || !stay || stay.kind !== 'reservation') return null;
  if (!stay.startDate || stay.startDate <= today) return null;
  if (!stay.platform || isDirectChannel(stay.platform)) return null;
  if (quote.platformGrossAmount == null || !(Number(quote.platformGrossAmount) > 0)) return null;
  if (Array.isArray(quote.unpricedNights) && quote.unpricedNights.length > 0) return null;

  const {
    rules, property = {}, grid, tariffChangedSinceBooking,
  } = loadContext();
  if (!nightsReplayed && tariffChangedSinceBooking) return null;

  const platformKey = String(stay.platform).trim().toLowerCase();
  const channel = (grid?.platforms || []).find((p) => String(p.name || '').trim().toLowerCase() === platformKey);
  if (!channel || !(Number(channel.commissionPercent) < 100)) return null;

  const seasonsById = new Map((grid.seasons || []).map((s) => [s.ruleId, s]));
  const nights = Array.isArray(quote.nightlyBreakdown) ? quote.nightlyBreakdown : [];
  if (nights.length === 0) return null;

  let expected = 0;
  const extraRatios = [];
  for (const night of nights) {
    const { matchedRule } = matchNightRule(rules, night.date);
    const season = matchedRule && seasonsById.get(matchedRule.id);
    const ratio = season ? seasonRatio(matchedRule.pricePerNight, season.byPlatform?.[channel.id]) : null;
    if (ratio == null) return null;
    expected += Number(night.price || 0) * ratio;
    const extraBilled = matchedRule.extraGuestPrice != null ? matchedRule.extraGuestPrice : property.extraGuestPrice;
    const extraRatio = seasonRatio(extraBilled, season.extraGuestByPlatform?.[channel.id]);
    if (extraRatio != null) extraRatios.push(extraRatio);
  }

  const surcharge = Number(quote.extraGuestInBrutSurcharge || 0);
  if (surcharge > 0) {
    const extraRatio = extraRatios.length
      ? extraRatios.reduce((sum, r) => sum + r, 0) / extraRatios.length
      : 1;
    expected += surcharge * extraRatio;
  }
  expected += Number(channel.cleaningFee || 0);

  const paid = cents(Number(quote.accommodationAdjustedPrice || 0) + surcharge);
  expected = cents(expected);
  if (!(expected > 0)) return null;
  const gap = cents(paid - expected);
  const gapPercent = (gap / expected) * 100;
  const outOfBand = gapPercent < BELOW_PERCENT || gapPercent > ABOVE_PERCENT;
  if (!outOfBand || Math.abs(gap) < MIN_GAP_EUR) return null;

  return {
    platformLabel: channel.name,
    paid,
    expected,
    gap,
    gapPercent: Math.round(gapPercent * 10) / 10,
    direction: gap < 0 ? 'below' : 'above',
    gridPath: `/properties/${stay.propertyId}/pricing-seasons`,
  };
}

module.exports = { platformPriceCheck, BELOW_PERCENT, ABOVE_PERCENT, MIN_GAP_EUR };
