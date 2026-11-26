/**
 * The review a manual accommodation price gets when its booking moves (specs/reservations/manual-price-on-placement-change.md).
 *
 * `buildManualPriceReview({ customPrice, reference, placement, excluded, evaluate })` → the review or `null`.
 * - `reference` / `placement`: `{ propertyId, propertyName, startDate, endDate, quote }`, the engine's quote of the placement the
 *   manual price was decided against and of the one the fiche now shows; `reference.useBreakdown` false hides its season groups
 *   (rule 7: a reference with no stored breakdown shows totals only).
 * - `excluded`: a platform sale or a started stay (rule 3).
 * - `evaluate(customPrice)` → the full quote of the new placement at that manual price (`''` = the engine price); each choice's
 *   price and total séjour come from it (rule 9).
 *
 * Pure: no DB, no clock.
 */
const { roundMoneyOrZero: round2 } = require('./pricing/money');
const { stayGross } = require('./quoteHeadline');

const KEEP_GAP_TOO_LARGE = 'Écart supérieur au nouveau tarif';

const hasManualPrice = (customPrice) => customPrice !== '' && customPrice !== null && customPrice !== undefined
  && Number.isFinite(Number(customPrice));

const samePlacement = (a, b) => Number(a.propertyId) === Number(b.propertyId)
  && a.startDate === b.startDate && a.endDate === b.endDate;

function seasonGroups(nightlyBreakdown) {
  if (!Array.isArray(nightlyBreakdown) || nightlyBreakdown.length === 0) return null;
  const groups = new Map();
  for (const night of nightlyBreakdown) {
    const label = night.seasonLabel || 'Standard';
    const group = groups.get(label) || { label, nights: 0, amount: 0 };
    group.nights += 1;
    group.amount = round2(group.amount + Number(night.price || 0));
    groups.set(label, group);
  }
  return [...groups.values()];
}

function side({ propertyId, propertyName, startDate, endDate, quote, useBreakdown = true }) {
  const breakdown = quote.nightlyBreakdown || [];
  return {
    propertyId: Number(propertyId),
    propertyName: propertyName || '',
    startDate,
    endDate,
    nights: breakdown.length,
    totalPrice: round2(quote.totalPrice),
    seasons: useBreakdown ? seasonGroups(breakdown) : null,
  };
}

function choiceAt(key, customPrice, evaluate) {
  const quote = evaluate(customPrice);
  return { key, customPrice, finalPrice: round2(quote.finalPrice), totalStay: stayGross(quote) };
}

function buildManualPriceReview({ customPrice, reference, placement, excluded = false, evaluate }) {
  if (excluded || !hasManualPrice(customPrice) || !reference || !placement) return null;
  if (samePlacement(reference, placement)) return null;
  const before = side(reference);
  const after = side(placement);
  const tariffDelta = round2(after.totalPrice - before.totalPrice);
  if (Math.abs(tariffDelta) < 0.01) return null;

  const manual = round2(customPrice);
  const gap = round2(manual - before.totalPrice);
  const choices = [choiceAt('keep', manual, evaluate)];
  if (gap !== 0) {
    const withGap = round2(after.totalPrice + gap);
    choices.push(withGap < 0
      ? { key: 'keepGap', customPrice: withGap, finalPrice: withGap, totalStay: null, disabledReason: KEEP_GAP_TOO_LARGE }
      : choiceAt('keepGap', withGap, evaluate));
  }
  choices.push(choiceAt('engine', '', evaluate));

  return { reference: before, placement: after, tariffDelta, customPrice: manual, gap, choices };
}

module.exports = { buildManualPriceReview, seasonGroups, KEEP_GAP_TOO_LARGE };
