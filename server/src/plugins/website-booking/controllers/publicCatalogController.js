/**
 * Public catalog controller (specs/public-api.md) — read-only property list/detail, per-property
 * options, and consolidated availability. Reuses the existing models + occupancy util; applies the
 * public projections so nothing sensitive leaks. No business logic lives here beyond orchestration.
 */

const sdk = require('../../sdk');

const db = sdk.coreModule('database');
const propertiesModel = sdk.coreModule('propertiesModel');
const optionsModel = sdk.coreModule('optionsModel');
const quotePostProcessors = sdk.coreModule('quotePostProcessors');
const resourcesModel = sdk.coreModule('resourcesModel');
const { hideUnoffered } = sdk.coreModule('resourceOffer');
const { computeBlockedDates, rangeHasBlockedNight } = sdk.coreModule('blockedDates');
const { validateAvailabilityQuery } = require('../publicInputValidation');
const { findNextAvailableDate, stayRulesPredicate } = require('../nextAvailability');
const { computeArrivalWindows, addDays } = require('../publicArrivalWindows');
const { effectiveMinNightsForDate, getRuleNightBaseForDate } = sdk.coreModule('pricing');
const {
  toPublicProperty, toPublicPropertyDetail, toPublicOption, toPublicResource, toPublicAvailability,
  toPublicCancellationInsurance,
} = require('../publicProjections');
const { ok, failT, langOf } = sdk.coreModule('publicHttp');
const translationResolver = sdk.coreModule('translationResolver');
const { publicSelectableOptions } = require('../publicSelectableOptions');
const { groupOptionsByCategory } = sdk.coreModule('optionGrouping');

function todayIso() {
  return sdk.coreModule('reservationHelpers').getTodayIsoDate();
}

function propertyExists(propertyId) {
  return Boolean(db.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(propertyId)));
}

function listProperties(req, res) {
  const lang = langOf(req);
  return ok(res, propertiesModel.list().map((row) => toPublicProperty(row, lang)));
}

function getProperty(req, res) {
  // Read-only on purpose: the public API never mutates server state on a GET, so we use the
  // side-effect-free reader instead of getByIdWithDetails (which seeds default timed options).
  const property = propertiesModel.getByIdPublicReadOnly(Number(req.params.id));
  if (!property) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
  return ok(res, toPublicPropertyDetail(property, langOf(req)));
}

/** Public catalog ordering: cheapest first (ties keep the model's order via a stable sort). */
function byPriceAsc(a, b) {
  return Number(a.price || 0) - Number(b.price || 0);
}

function listOptions(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
  const lang = langOf(req);
  const translate = translationResolver.forLang(lang);
  const visible = publicSelectableOptions(propertyId, { db, optionsModel })
    .map((opt) => toPublicOption(opt, lang, translate));
  // The cancellation insurance leaves the supplements lists entirely
  // (specs/cancellation-insurance.md §3.3 rule 18): it gets its own block, with a mandatory
  // Oui/Non choice, and must never also appear as one row among the extras. Picked out of the
  // ALREADY filtered list, so an insurance the property offers for free, hides from clients or
  // doesn't apply to simply isn't there.
  const insuranceOption = visible.find((opt) => opt.isCancellationInsurance) || null;
  const selectable = visible.filter((opt) => !opt.isCancellationInsurance);
  // Grouped, render-ready payload (specs/option-categories.md §4.4). Cheapest-first ordering is
  // preserved inside each bucket — the widget renders what it receives, in order.
  const { ungrouped, groups } = groupOptionsByCategory(selectable);
  // Rule 16 — the grouping above ran on the FRENCH category, so the drawer groups identically in
  // both languages; only the label it shows is translated, here, once the buckets are settled.
  return ok(res, {
    ungrouped: ungrouped.slice().sort(byPriceAsc),
    groups: groups.map((g) => ({
      category: translate.category(g.category),
      options: g.options.slice().sort(byPriceAsc).map((o) => ({ ...o, category: translate.category(o.category) })),
    })),
    // Null while unpriced (rule 15) or not offered (specs/plugins-phase-3b-neat.md rule 6) — the
    // projection and the option list enforce it: no block, no mandatory question. With a plugin pricing
    // it the block stays even at a static 0 and its label announces a per-stay tariff.
    cancellationInsurance: toPublicCancellationInsurance(insuranceOption, {
      dynamicPrice: quotePostProcessors.dynamicInsurance(),
      lang,
    }),
  });
}

function listResources(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
  const lang = langOf(req);
  // resourcesModel.list resolves applicability (resource_properties pivot, empty = global) and the
  // EFFECTIVE per-property price (property_resource_prices). Public projection strips stock/slots.
  return ok(res, hideUnoffered(resourcesModel.list(propertyId)).map((row) => toPublicResource(row, lang, translationResolver.forLang(lang))).sort(byPriceAsc));
}

function getAvailability(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
  const v = validateAvailabilityQuery({ from: req.query.from, to: req.query.to, todayIso: todayIso() });
  if (!v.ok) return failT(res, req, 422, 'VALIDATION_FAILED', 'periodInvalid', v.errors);
  const { from, to } = v.value;
  // Blocked nights are read a month past `to`, so an arrival near the end of the window still gets
  // its true earliest departure (specs/booking-drawer-friction.md rule 10). Only [from, to) is returned.
  const lookahead = computeBlockedDates(propertyId, from, addDays(to, ARRIVAL_LOOKAHEAD_NIGHTS));
  const blockedDates = lookahead.filter((d) => d >= from && d < to);
  const rules = propertiesModel.listPricingRules(propertyId);
  // Where the calendar can jump when its window holds no bookable arrival (specs/public-api.md, additive).
  const nextAvailableDate = findNextAvailableDate({
    from,
    to,
    todayIso: todayIso(),
    blockedDates,
    loadBlocked: (a, b) => computeBlockedDates(propertyId, a, b),
    // The seasons as the pricing engine reads them: a free night the quote would refuse (minimum
    // stay, arrival day) is not an availability.
    isStayAllowed: stayRulesPredicate(rules),
  });
  const { arrivals, nightPrices } = calendarHints(rules, from, to, new Set(lookahead), stayRulesPredicate(rules));
  return ok(res, toPublicAvailability({ propertyId, from, to, blockedDates, nextAvailableDate, arrivals, nightPrices }));
}

const ARRIVAL_LOOKAHEAD_NIGHTS = 31;

// Rules 10 + 13: per bookable arrival, the minimum and the earliest departure; per free night, its
// base price. Both read the pricing rules exactly as the quote does (pricing.js first-match rule).
function calendarHints(rules, from, to, blockedSet, isStayAllowed) {
  const today = todayIso();
  const arrivals = computeArrivalWindows({
    from, to, todayIso: today, blockedSet,
    minNightsFor: (date) => effectiveMinNightsForDate(rules, date),
    maxNights: ARRIVAL_LOOKAHEAD_NIGHTS - 1,
    isStayAllowed,
  });
  const nightPrices = [];
  for (let date = from < today ? today : from; date < to; date = addDays(date, 1)) {
    if (blockedSet.has(date)) continue;
    const { matchedRule, nightlyBase } = getRuleNightBaseForDate(rules, date);
    if (matchedRule) nightPrices.push({ date, price: nightlyBase });
  }
  return { arrivals, nightPrices };
}

module.exports = {
  listProperties,
  getProperty,
  listOptions,
  listResources,
  getAvailability,
  // shared helpers — the availability check lives in the core (utils/blockedDates.js), where the
  // public payment of online-payment also reads it
  computeBlockedDates,
  rangeHasBlockedNight,
  propertyExists,
};
