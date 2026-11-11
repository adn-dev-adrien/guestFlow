/**
 * NIGHTS — the price of the nights of a stay (specs/pricing-components.md §3 rules 1, 2, 6, 7).
 *
 * Contract: from the property's pricing rules (seasons, date ranges, weekly model, degressive tiers, min / max nights
 * per range) and a stay's dates, `calculateBaseStayPrice(rules, startDate, endDate)` returns the nightly breakdown,
 * the accommodation base, the unpriced nights and the validation of the stay; the other exports are its helpers
 * (date arithmetic on ISO days, range normalisation, degressive tiers) and `mergeNightlyBreakdownWithLocked`, which
 * keeps the nights already sold.
 *
 * Pure: no DB, no clock, no settings; knows nothing of extras, payments or the tourist tax.
 */
const { roundMoney } = require('./money');

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseIsoDateParts(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isoToUtcDate(isoDate) {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() !== parts.month - 1
    || date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return date;
}

function utcDateToIso(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToIsoDate(isoDate, daysDelta) {
  const date = isoToUtcDate(isoDate);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(daysDelta || 0));
  return utcDateToIso(date);
}

function diffIsoDatesInDays(startIsoDate, endIsoDate) {
  const start = isoToUtcDate(startIsoDate);
  const end = isoToUtcDate(endIsoDate);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function normalizeDateRanges(dateRanges, startDate, endDate) {
  const source = Array.isArray(dateRanges) && dateRanges.length > 0
    ? dateRanges
    : [{ startDate, endDate }];

  return source
    .map((range) => {
      const normalized = {
        startDate: range?.startDate || '',
        endDate: range?.endDate || '',
      };
      // A per-range minimum-nights override travels inside the dateRanges JSON
      // (specs/pricing-min-nights-per-range.md). Keep it only when it's a real integer ≥ 1; a blank /
      // absent value means "inherit the season-level minNights", so we drop the key entirely.
      const minNights = Math.floor(Number(range?.minNights));
      if (Number.isFinite(minNights) && minNights >= 1) normalized.minNights = minNights;
      const maxNights = Math.floor(Number(range?.maxNights));
      if (Number.isFinite(maxNights) && maxNights >= 1) normalized.maxNights = maxNights;
      // Per-range changeover overrides ride the same JSON with the same "blank = inherit the season"
      // rule (specs/tariff-recipes/spec.md §3.4). JS weekday convention: 0 = dimanche … 6 = samedi.
      const arrival = Math.floor(Number(range?.changeoverArrival));
      if (Number.isFinite(arrival) && arrival >= 0 && arrival <= 6 && range?.changeoverArrival !== '' && range?.changeoverArrival != null) {
        normalized.changeoverArrival = arrival;
      }
      const departure = Math.floor(Number(range?.changeoverDeparture));
      if (Number.isFinite(departure) && departure >= 0 && departure <= 6 && range?.changeoverDeparture !== '' && range?.changeoverDeparture != null) {
        normalized.changeoverDeparture = departure;
      }
      // The event that painted this range, so the seasons table can say WHY a June week is high
      // season (specs/tariff-events-and-extra-guest-tiers §3.3 rule 15bis). Display-only — nothing
      // prices off it — but this whitelist is rebuilt from scratch, so an unlisted key is lost.
      if (range?.eventKey) {
        normalized.eventKey = String(range.eventKey);
        if (range.eventLabel) normalized.eventLabel = String(range.eventLabel);
      }
      return normalized;
    })
    .filter((range) => range.startDate && range.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function getBoundsFromDateRanges(dateRanges) {
  if (!dateRanges.length) return { startDate: null, endDate: null };
  return {
    startDate: dateRanges[0].startDate,
    endDate: dateRanges[dateRanges.length - 1].endDate,
  };
}

function parseRuleDateRanges(rule) {
  const parsed = normalizeDateRanges(parseJsonArray(rule?.dateRanges), rule?.startDate, rule?.endDate);
  return parsed;
}

/**
 * Calculates the total price of the stay based on the weekly price.
 * Logic based on standard vacation rental decreasing rates.
 * * @param {number} weeklyPrice - The rate for 7 nights (the baseline)
 * @param {number} numberOfNights - The requested number of nights
 * @returns {number} The calculated total price
 */
function calculateStayPrice(weeklyPrice, numberOfNights) {
    // Handling cases from 1 to 7 nights (decreasing coefficients)
    const pricingScale = {
        1: 0.25, // 25% of the weekly price
        2: 0.50, // 50%
        3: 0.60, // 60%
        4: 0.70, // 70%
        5: 0.80, // 80%
        6: 0.90, // 90%
        7: 1.00  // 100%
    };

    if (numberOfNights <= 7) {
        return Math.round(weeklyPrice * pricingScale[numberOfNights]);
    } 
    
    // Beyond 7 nights, we apply a pro-rata nightly rate (weeklyPrice / 7)
    const flatNightlyRate = weeklyPrice / 7;
    return Math.round(numberOfNights * flatNightlyRate);
}

function getWeekPriceEquivalent(baseNightPrice) {
  return Number(baseNightPrice || 0) * 4;
}

function getTotalFromWeeklyModel(baseNightPrice, nights) {
  const base = Number(baseNightPrice || 0);
  const weekPrice = getWeekPriceEquivalent(base);

  return calculateStayPrice(weekPrice, nights); 
}

function buildDefaultProgressiveTiers(baseNightPrice, maxNights = 365) {
  const base = Number(baseNightPrice || 0);
  if (!base || base <= 0) return [];

  const tiers = [];
  for (let night = 2; night <= maxNights; night += 1) {
    const totalPrev = getTotalFromWeeklyModel(base, night - 1);
    const totalCurrent = getTotalFromWeeklyModel(base, night);
    const extraNightPrice = Math.max(0, totalCurrent - totalPrev);
    const extraNightDiscountPct = Math.max(0, 100 - (extraNightPrice / base) * 100);
    tiers.push({
      nightNumber: night,
      extraNightPrice: roundMoney(extraNightPrice),
      extraNightDiscountPct: roundMoney(extraNightDiscountPct),
    });
  }
  return tiers;
}

function normalizeProgressiveTiers(baseNightPrice, progressiveTiers, maxNights = 365) {
  const base = Number(baseNightPrice || 0);
  const defaults = buildDefaultProgressiveTiers(base, maxNights);
  const providedByNight = new Map(
    parseJsonArray(progressiveTiers)
      .filter((tier) => Number(tier?.nightNumber) > 1)
      .map((tier) => [Number(tier.nightNumber), tier])
  );
  // specs/tariff-recipes/spec.md §3.6 rule 39 — beyond the LAST provided tier the last resolved price
  // carries forward, replacing the legacy weekly-model fallback that priced long stays off a formula
  // unrelated to the configured curve. No provided tier at all → the legacy defaults stay untouched
  // (an unconfigured season behaves exactly as before). Also what makes a single night-2 tier enough
  // to declare a whole "every later night at X" curve.
  const maxProvidedNight = providedByNight.size > 0 ? Math.max(...providedByNight.keys()) : 0;
  let carriedPrice = null;

  return defaults.map((defaultTier) => {
    const nightNumber = Number(defaultTier.nightNumber);
    const provided = providedByNight.get(nightNumber) || {};
    const providedPrice = Number(provided.extraNightPrice);
    const providedPct = Number(provided.extraNightDiscountPct);

    let extraNightPrice = defaultTier.extraNightPrice;
    if (Number.isFinite(providedPrice)) {
      extraNightPrice = Math.max(0, providedPrice);
    } else if (Number.isFinite(providedPct)) {
      extraNightPrice = Math.max(0, base * (1 - providedPct / 100));
    } else if (maxProvidedNight >= 2 && nightNumber > maxProvidedNight && carriedPrice !== null) {
      extraNightPrice = carriedPrice;
    }

    if (nightNumber === maxProvidedNight) carriedPrice = extraNightPrice;

    const extraNightDiscountPct = base > 0
      ? Math.max(0, 100 - (extraNightPrice / base) * 100)
      : 0;

    return {
      nightNumber,
      extraNightPrice: roundMoney(extraNightPrice),
      extraNightDiscountPct: roundMoney(extraNightDiscountPct),
    };
  });
}

function buildProgressivePreview(baseNightPrice, progressiveTiers, maxNights = 365) {
  const base = roundMoney(baseNightPrice);
  const normalizedTiers = normalizeProgressiveTiers(base, progressiveTiers, maxNights);
  let cumulative = 0;

  const rows = [
    {
      nightNumber: 1,
      extraNightPrice: base,
      extraNightDiscountPct: 0,
      cumulativePrice: base,
      readOnly: true,
    },
  ];

  cumulative += base;
  normalizedTiers.forEach((tier) => {
    cumulative += Number(tier.extraNightPrice || 0);
    rows.push({
      ...tier,
      cumulativePrice: roundMoney(cumulative),
      readOnly: false,
    });
  });

  return {
    baseNightPrice: base,
    weekPriceEquivalent: roundMoney(getWeekPriceEquivalent(base)),
    progressiveTiers: normalizedTiers,
    rows,
  };
}

function getNightBasePriceForDate(rules, dateStr) {
  let nightlyBase = 100;
  for (const rule of rules || []) {
    const ranges = parseRuleDateRanges(rule);
    if (!ranges.length) {
      nightlyBase = Number(rule.pricePerNight || 0);
      break;
    }
    if (ranges.some((range) => dateStr >= range.startDate && dateStr <= range.endDate)) {
      nightlyBase = Number(rule.pricePerNight || 0);
      break;
    }
  }
  return roundMoney(nightlyBase);
}

function getRuleNightBaseForDate(rules, dateStr) {
  let matchedRule = null;
  let nightlyBase = 100;

  for (const rule of rules || []) {
    const ranges = parseRuleDateRanges(rule);
    if (!ranges.length) {
      matchedRule = rule;
      nightlyBase = Number(rule.pricePerNight || 0);
      break;
    }
    if (ranges.some((range) => dateStr >= range.startDate && dateStr <= range.endDate)) {
      matchedRule = rule;
      nightlyBase = Number(rule.pricePerNight || 0);
      break;
    }
  }

  return {
    matchedRule,
    nightlyBase: roundMoney(nightlyBase),
  };
}

// specs/tariff-recipes/spec.md §3 rule 57 — the nights a reservation was sold at are kept only while
// its ARRIVAL date is unchanged. A progressive tariff prices a night by its rank in the stay, so a
// locked night moved to another rank (arrival one day earlier or later) carries a price that no
// longer means anything: the whole stay is then repriced at the current tariff. Extending or
// shortening the END keeps every locked night and prices the new ones at the tariff, with their rank.
function mergeNightlyBreakdownWithLocked(lockedNightlyBreakdown, freshNightlyBreakdown) {
  const lockedLines = (Array.isArray(lockedNightlyBreakdown) ? lockedNightlyBreakdown : [])
    .filter((line) => line?.date);
  const freshLines = Array.isArray(freshNightlyBreakdown) ? freshNightlyBreakdown : [];
  const lockedArrival = lockedLines.map((line) => String(line.date)).sort()[0] || null;
  const freshArrival = freshLines.length ? String(freshLines[0].date) : null;
  const lockedByDate = lockedArrival && lockedArrival === freshArrival
    ? new Map(lockedLines.map((line) => [String(line.date), line]))
    : new Map();

  let total = 0;
  const lockedDates = new Set();
  const merged = freshLines
    .map((line, index) => {
      const locked = lockedByDate.get(String(line.date));
      if (locked?.price !== undefined) lockedDates.add(String(line.date));
      const price = roundMoney(locked?.price !== undefined ? locked.price : line.price);
      total += price;
      return {
        date: String(line.date),
        nightNumber: index + 1,
        pricingMode: locked?.pricingMode || line.pricingMode || 'fixed',
        seasonLabel: locked?.seasonLabel || line.seasonLabel || 'Standard',
        price,
      };
    });

  return {
    nightlyBreakdown: merged,
    totalPrice: roundMoney(total),
    lockedDates,
  };
}

function getProgressiveExtraNightPrice(rule, nightNumber, fallbackBasePrice) {
  const normalizedTiers = normalizeProgressiveTiers(Number(rule?.pricePerNight || fallbackBasePrice || 0), rule?.progressiveTiers);
  const tier = normalizedTiers.find((entry) => Number(entry.nightNumber) === Number(nightNumber));
  return tier ? Number(tier.extraNightPrice || 0) : Number(fallbackBasePrice || 0);
}

// The rule (and the date range inside it) that prices one night: the first rule whose ranges cover
// the date, or the first rule without ranges. No match → the engine's historical 100 € fallback.
function matchNightRule(rules, dateStr) {
  for (const rule of rules || []) {
    const ranges = parseRuleDateRanges(rule);
    if (!ranges.length) return { matchedRule: rule, matchedRange: null, nightlyBase: Number(rule.pricePerNight || 0) };
    const hitRange = ranges.find((range) => dateStr >= range.startDate && dateStr <= range.endDate);
    if (hitRange) return { matchedRule: rule, matchedRange: hitRange, nightlyBase: Number(rule.pricePerNight || 0) };
  }
  return { matchedRule: null, matchedRange: null, nightlyBase: 100 };
}

// A per-range override wins over the season default; both default to 1
// (specs/pricing-min-nights-per-range.md rule 2).
function effectiveMinNightsOf(rule, range) {
  return Number(range?.minNights) >= 1
    ? Number(range.minNights)
    : Math.max(1, Number(rule.minNights || 1));
}

// The minimum a single night imposes on any stay that touches it, or null when no rule covers the
// date (the public calendar does not offer an unpriced night — specs/booking-drawer-friction.md rule 10).
function effectiveMinNightsForDate(rules, dateStr) {
  const { matchedRule, matchedRange } = matchNightRule(rules, dateStr);
  return matchedRule ? effectiveMinNightsOf(matchedRule, matchedRange) : null;
}

function calculateBaseStayPrice(rules, startDate, endDate) {
  const nights = diffIsoDatesInDays(startDate, endDate);
  if (nights <= 0) {
    return {
      nights: 0,
      totalPrice: 0,
      nightlyBreakdown: [],
      requiredMinNights: 1,
      minNightsRules: [],
      minNightsBreached: false,
      requiredMaxNights: null,
      maxNightsRules: [],
      maxNightsBreached: false,
      unpricedNights: [],
    };
  }

  let totalPrice = 0;
  const nightlyBreakdown = [];
  // specs/tariff-recipes/spec.md §3 rule 59 — the nights no season covers. They keep the historical
  // 100 € fallback price, but the quote names them so no flow can sell one without knowing.
  const unpricedNights = [];
  // Minimum-nights is resolved PER NIGHT: a night takes its covering range's own `minNights` when set,
  // otherwise the season-level `minNights` (specs/pricing-min-nights-per-range.md). We keep the max over
  // the nights the stay actually touches, plus a per-label view so the message can name the season(s).
  const perNightMinNights = [];
  const minNightsByLabel = new Map();
  const perNightMaxNights = [];
  const maxNightsByLabel = new Map();
  let currentDateStr = startDate;

  for (let nightIndex = 0; nightIndex < nights; nightIndex += 1) {
    const dateStr = currentDateStr;
    const { matchedRule, matchedRange, nightlyBase } = matchNightRule(rules, dateStr);
    if (!matchedRule) unpricedNights.push(dateStr);

    if (matchedRule) {
      const label = String(matchedRule.label || 'Standard');
      const effectiveMin = effectiveMinNightsOf(matchedRule, matchedRange);
      perNightMinNights.push(effectiveMin);
      minNightsByLabel.set(label, Math.max(minNightsByLabel.get(label) || 1, effectiveMin));
      // Maximum stay (specs/tariff-recipes/spec.md §3.4 rule 20bis), the mirror of the minimum:
      // per-range override ⇒ season default ⇒ unlimited. NULL/0 = no ceiling, which is what every
      // existing property carries.
      const rangeMax = Math.floor(Number(matchedRange?.maxNights));
      const seasonMax = Math.floor(Number(matchedRule.maxNights));
      const effectiveMax = Number.isFinite(rangeMax) && rangeMax >= 1
        ? rangeMax
        : (Number.isFinite(seasonMax) && seasonMax >= 1 ? seasonMax : null);
      if (effectiveMax !== null) {
        perNightMaxNights.push(effectiveMax);
        maxNightsByLabel.set(label, Math.min(maxNightsByLabel.get(label) || Infinity, effectiveMax));
      }
    }

    if ((matchedRule?.pricingMode || 'fixed') === 'progressive') {
      const stayNightNumber = nightIndex + 1;
      const nightPrice = stayNightNumber === 1
        ? nightlyBase
        : getProgressiveExtraNightPrice(matchedRule, stayNightNumber, nightlyBase);
      totalPrice += nightPrice;
      nightlyBreakdown.push({
        date: dateStr,
        nightNumber: stayNightNumber,
        pricingMode: 'progressive',
        seasonLabel: matchedRule?.label || 'Standard',
        price: roundMoney(nightPrice),
      });
    } else {
      totalPrice += nightlyBase;
      nightlyBreakdown.push({
        date: dateStr,
        nightNumber: nightIndex + 1,
        pricingMode: 'fixed',
        seasonLabel: matchedRule?.label || 'Standard',
        price: roundMoney(nightlyBase),
      });
    }

    currentDateStr = addDaysToIsoDate(currentDateStr, 1);
  }

  const requiredMinNights = Math.max(1, ...perNightMinNights);
  // The most restrictive ceiling across the nights the stay touches wins (mirror of the minimum,
  // which takes the max). No season carrying a ceiling → null = unlimited.
  const requiredMaxNights = perNightMaxNights.length ? Math.min(...perNightMaxNights) : null;
  return {
    nights,
    totalPrice: roundMoney(totalPrice),
    nightlyBreakdown,
    requiredMinNights,
    minNightsRules: Array.from(minNightsByLabel.entries()).map(([label, minNights]) => ({
      label,
      minNights: Number(minNights || 1),
    })),
    minNightsBreached: nights < requiredMinNights,
    requiredMaxNights,
    maxNightsRules: Array.from(maxNightsByLabel.entries()).map(([label, maxNights]) => ({
      label,
      maxNights: Number(maxNights),
    })),
    maxNightsBreached: requiredMaxNights !== null && nights > requiredMaxNights,
    unpricedNights,
  };
}

/**
 * specs/tariff-recipes/spec.md §3 rule 59 — whether a quote prices a night no season covers. The
 * public quote and booking paths must refuse such a stay (the 100 € fallback is nobody's price); the
 * fiche warns and lets the operator decide.
 */
function hasUnpricedNights(quote) {
  return Array.isArray(quote?.unpricedNights) && quote.unpricedNights.length > 0;
}

module.exports = {
  parseJsonArray,
  parseIsoDateParts,
  isoToUtcDate,
  utcDateToIso,
  addDaysToIsoDate,
  diffIsoDatesInDays,
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  calculateStayPrice,
  getWeekPriceEquivalent,
  getTotalFromWeeklyModel,
  buildDefaultProgressiveTiers,
  normalizeProgressiveTiers,
  buildProgressivePreview,
  getNightBasePriceForDate,
  getRuleNightBaseForDate,
  mergeNightlyBreakdownWithLocked,
  getProgressiveExtraNightPrice,
  matchNightRule,
  effectiveMinNightsOf,
  effectiveMinNightsForDate,
  calculateBaseStayPrice,
  hasUnpricedNights,
};
