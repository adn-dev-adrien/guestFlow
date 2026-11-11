const pricingInputModel = require('../models/pricingInputModel');
const { resolveGlobalPlatformTaxRow } = pricingInputModel;
const { roundMoney } = require('./pricing/money');
const {
  computeTouristTaxBreakdown, resolveAddedGuestsTouristTax, platformCollectsTouristTax, touristTaxRemittedByOwner,
} = require('./pricing/touristTax');
const {
  parseJsonArray,
  addDaysToIsoDate,
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  buildDefaultProgressiveTiers,
  normalizeProgressiveTiers,
  buildProgressivePreview,
  getRuleNightBaseForDate,
  matchNightRule,
  effectiveMinNightsForDate,
  calculateBaseStayPrice,
  hasUnpricedNights,
} = require('./pricing/nights');
const { grossFromNet } = require('./pricing/platformPrice');
const articles = require('./pricing/articles');
const { applyFreeUnitsToLine } = require('./pricing/allowances');
const { computeExtraGuestSurcharge, splitExtraGuestCount } = require('./pricing/extraGuests');
const { getApplicableOptions, getApplicableResources } = require('../models/ports/catalogueProvider');
const { compose } = require('./pricing/compose');
const { withQuantityUnit, timeToDecimalHour, computeAutoTimedOptionContext } = require('./pricing/steps/extras');

const {
  getTypeMultiplier, computePercentOfStayAmount, resolveServedPersons, resolveNonCardUnits,
  calculateProgressiveParticipantOptionTotal, normalizeOptionProgressiveTiers,
} = articles;

function isPlatformCollectingTouristTax(db, propertyId, platformKey) {
  return platformCollectsTouristTax(platformKey, resolveGlobalPlatformTaxRow(db, platformKey));
}

function isTouristTaxRemittedByOwner(db, propertyId, platformKey) {
  return touristTaxRemittedByOwner(platformKey, resolveGlobalPlatformTaxRow(db, platformKey));
}

function calculateReservationQuote(input) {
  const stay = pricingInputModel.load(input);
  if (stay.error) return stay;
  return compose(stay);
}

module.exports = {
  roundMoney,
  calculateBaseStayPrice,
  grossFromNet,
  computeExtraGuestSurcharge,
  splitExtraGuestCount,
  parseJsonArray,
  normalizeOptionProgressiveTiers,
  calculateProgressiveParticipantOptionTotal,
  computeTouristTaxBreakdown,
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  addDaysToIsoDate,
  buildDefaultProgressiveTiers,
  normalizeProgressiveTiers,
  buildProgressivePreview,
  calculateReservationQuote,
  isPlatformCollectingTouristTax,
  isTouristTaxRemittedByOwner,
  getTypeMultiplier,
  computePercentOfStayAmount,
  resolveServedPersons,
  resolveNonCardUnits,
  effectiveMinNightsForDate,
  getRuleNightBaseForDate,
  matchNightRule,
  hasUnpricedNights,
  // The engine's own reading of a lodging's catalogue and of the free units, for the guest app's shop
  // (specs/guest-app.md rules 24-25): it shows what the fiche will price.
  applyFreeUnitsToLine,
  getApplicableOptions,
  getApplicableResources,
};

module.exports.__test = {
  withQuantityUnit,
  timeToDecimalHour,
  computeAutoTimedOptionContext,
  normalizeOptionProgressiveTiers,
  calculateProgressiveParticipantOptionTotal,
  computeTouristTaxBreakdown,
  resolveAddedGuestsTouristTax,
  calculateReservationQuote,
  isPlatformCollectingTouristTax,
  isTouristTaxRemittedByOwner,
};