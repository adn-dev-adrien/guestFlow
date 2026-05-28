function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

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
    .map((range) => ({
      startDate: range?.startDate || '',
      endDate: range?.endDate || '',
    }))
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

  return defaults.map((defaultTier) => {
    const provided = providedByNight.get(Number(defaultTier.nightNumber)) || {};
    const providedPrice = Number(provided.extraNightPrice);
    const providedPct = Number(provided.extraNightDiscountPct);

    let extraNightPrice = defaultTier.extraNightPrice;
    if (Number.isFinite(providedPrice)) {
      extraNightPrice = Math.max(0, providedPrice);
    } else if (Number.isFinite(providedPct)) {
      extraNightPrice = Math.max(0, base * (1 - providedPct / 100));
    }

    const extraNightDiscountPct = base > 0
      ? Math.max(0, 100 - (extraNightPrice / base) * 100)
      : 0;

    return {
      nightNumber: Number(defaultTier.nightNumber),
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

function getTypeMultiplier(priceType, persons, nights) {
  if (priceType === 'per_person') return persons;
  if (priceType === 'per_night') return nights;
  if (priceType === 'per_person_per_night') return persons * nights;
  return 1;
}

function normalizeOptionProgressiveTiers(rawTiers) {
  const parsed = parseJsonArray(rawTiers);
  const byParticipant = new Map();

  parsed.forEach((entry) => {
    const participantNumber = Math.max(1, Math.floor(Number(entry?.participantNumber || 0)));
    const unitPrice = Math.max(0, Number(entry?.unitPrice || 0));
    if (!Number.isFinite(participantNumber) || !Number.isFinite(unitPrice)) return;
    byParticipant.set(participantNumber, {
      participantNumber,
      unitPrice: roundMoney(unitPrice),
    });
  });

  return Array.from(byParticipant.values())
    .sort((a, b) => a.participantNumber - b.participantNumber);
}

function getProgressiveUnitPriceForParticipant(tiers, participantNumber, fallbackUnitPrice = 0) {
  const target = Math.max(1, Math.floor(Number(participantNumber || 0)));
  const normalizedFallback = Math.max(0, Number(fallbackUnitPrice || 0));
  const normalizedTiers = Array.isArray(tiers) ? tiers : [];

  let resolved = normalizedFallback;
  for (const tier of normalizedTiers) {
    if (Number(tier.participantNumber) > target) break;
    resolved = Math.max(0, Number(tier.unitPrice || 0));
  }

  return roundMoney(resolved);
}

function calculateProgressiveParticipantOptionTotal(quantity, tiers, fallbackUnitPrice = 0) {
  const billedUnits = Math.max(0, Math.floor(Number(quantity || 0)));
  if (billedUnits <= 0) {
    return {
      billedUnits: 0,
      totalPrice: 0,
      averageUnitPrice: 0,
      lastUnitPrice: roundMoney(Math.max(0, Number(fallbackUnitPrice || 0))),
    };
  }

  let total = 0;
  let lastUnitPrice = roundMoney(Math.max(0, Number(fallbackUnitPrice || 0)));
  for (let index = 1; index <= billedUnits; index += 1) {
    lastUnitPrice = getProgressiveUnitPriceForParticipant(tiers, index, fallbackUnitPrice);
    total += lastUnitPrice;
  }

  const totalPrice = roundMoney(total);
  return {
    billedUnits,
    totalPrice,
    averageUnitPrice: billedUnits > 0 ? roundMoney(totalPrice / billedUnits) : 0,
    lastUnitPrice,
  };
}

function computeTouristTaxBreakdown({
  touristTaxMode,
  touristTaxPerDayPerPerson,
  touristTaxPercentage,
  touristTaxDepartmentPercentage,
  touristTaxFixedAmount,
  nights,
  adults,
  occupants,
  accommodationAmountTtc,
  accommodationVatRate,
}) {
  const mode = String(touristTaxMode || 'per_day_per_person');
  const nightsCount = Math.max(0, Number(nights || 0));
  const adultsCount = Math.max(0, Number(adults || 0));
  const occupantsCount = Math.max(0, Number(occupants || 0));

  const perDayRate = Math.max(0, Number(touristTaxPerDayPerPerson || 0));
  const communePercentage = Math.max(0, Number(touristTaxPercentage || 0));
  const departmentPercentage = Math.max(0, Number(touristTaxDepartmentPercentage || 0));
  const fixedAmount = Math.max(0, Number(touristTaxFixedAmount || 0));

  const accommodationReferenceTtc = Math.max(0, Number(accommodationAmountTtc || 0));
  const vatRate = Math.max(0, Number(accommodationVatRate || 0));
  const vatDivisor = 1 + (vatRate / 100);

  const averageNightPriceTtc = nightsCount > 0
    ? roundMoney(accommodationReferenceTtc / nightsCount)
    : 0;
  const averageNightPriceHt = vatDivisor > 0
    ? roundMoney(averageNightPriceTtc / vatDivisor)
    : averageNightPriceTtc;
  const perOccupantNightPriceHt = occupantsCount > 0
    ? roundMoney(averageNightPriceHt / occupantsCount)
    : 0;

  let touristTaxRate = 0;
  let touristTaxUnitAmount = 0;
  let municipalUnitAmount = 0;
  let departmentUnitAmount = 0;
  let touristTaxTotal = 0;
  let touristTaxLabel = '';

  if (mode === 'per_day_per_person') {
    touristTaxRate = perDayRate;
    touristTaxUnitAmount = perDayRate;
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nightsCount * adultsCount);
    touristTaxLabel = `${touristTaxUnitAmount.toFixed(2)}EUR x ${adultsCount} adulte${adultsCount > 1 ? 's' : ''} x ${nightsCount} nuit${nightsCount > 1 ? 's' : ''}`;
  } else if (mode === 'percentage_accommodation' || mode === 'percentage_and_fixed') {
    touristTaxRate = communePercentage;
    municipalUnitAmount = roundMoney(perOccupantNightPriceHt * (communePercentage / 100));
    departmentUnitAmount = roundMoney(municipalUnitAmount * (departmentPercentage / 100));
    touristTaxUnitAmount = roundMoney(municipalUnitAmount + departmentUnitAmount);
    if (mode === 'percentage_and_fixed') {
      touristTaxUnitAmount = roundMoney(touristTaxUnitAmount + fixedAmount);
    }
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nightsCount * adultsCount);
    const fixedLabel = mode === 'percentage_and_fixed' && fixedAmount > 0
      ? ` + ${fixedAmount.toFixed(2)}EUR`
      : '';
    touristTaxLabel = `(${averageNightPriceHt.toFixed(2)}EUR HT/nuit ÷ ${occupantsCount || 0} occupant${occupantsCount > 1 ? 's' : ''}) x ${communePercentage.toFixed(2)}% + ${departmentPercentage.toFixed(2)}% dep${fixedLabel} = ${touristTaxUnitAmount.toFixed(2)}EUR/adulte/nuit`;
  }

  return {
    touristTaxMode: mode,
    touristTaxRate,
    touristTaxUnitAmount,
    touristTaxPercentage: communePercentage,
    touristTaxDepartmentPercentage: departmentPercentage,
    touristTaxFixedAmount: fixedAmount,
    touristTaxPricePerNight: averageNightPriceTtc,
    touristTaxPricePerNightHt: averageNightPriceHt,
    touristTaxPerOccupantNightPriceHt: perOccupantNightPriceHt,
    touristTaxMunicipalUnitAmount: municipalUnitAmount,
    touristTaxDepartmentUnitAmount: departmentUnitAmount,
    touristTaxAdultsCount: adultsCount,
    touristTaxOccupantsCount: occupantsCount,
    touristTaxNights: nightsCount,
    touristTaxLabel,
    touristTaxTotal,
  };
}

function timeToDecimalHour(timeStr, fallback = 0) {
  const value = String(timeStr || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number(fallback || 0);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number(fallback || 0);
  return hours + minutes / 60;
}

function computeAutoTimedOptionContext({
  option,
  checkInTime,
  checkOutTime,
  defaultCheckIn,
  defaultCheckOut,
  nightlyBreakdown,
  lateCheckoutNextNightPrice,
}) {
  if (!option || !option.autoOptionType || Number(option.autoEnabled || 0) !== 1) return null;

  const isEarly = option.autoOptionType === 'early_check_in';
  const isLate = option.autoOptionType === 'late_check_out';
  if (!isEarly && !isLate) return null;

  const defaultHour = isEarly
    ? timeToDecimalHour(defaultCheckIn, 15)
    : timeToDecimalHour(defaultCheckOut, 10);
  const requestedHour = isEarly
    ? timeToDecimalHour(checkInTime || defaultCheckIn, defaultHour)
    : timeToDecimalHour(checkOutTime || defaultCheckOut, defaultHour);

  const needsOption = isEarly ? requestedHour < defaultHour : requestedHour > defaultHour;
  if (!needsOption) return null;

  const thresholdDefault = isEarly ? '10:00' : '17:00';
  const thresholdHour = timeToDecimalHour(option.autoFullNightThreshold || thresholdDefault, isEarly ? 10 : 17);
  const firstNightPrice = Number(nightlyBreakdown?.[0]?.price || 0);
  const lastStayNightPrice = Number(nightlyBreakdown?.[Math.max(0, (nightlyBreakdown?.length || 1) - 1)]?.price || 0);
  // Source de calcul: une nuit de référence (jamais le total séjour)
  // - arrivée anticipée: nuit d'arrivée
  // - départ tardif: nuit suivant la date de départ (fallback: dernière nuit du séjour)
  const concernedNightPrice = isEarly
    ? firstNightPrice
    : Number(lateCheckoutNextNightPrice || lastStayNightPrice || 0);

  const isFullNight = isEarly ? requestedHour <= thresholdHour : requestedHour >= thresholdHour;
  const extraHours = isEarly
    ? Math.max(0, defaultHour - requestedHour)
    : Math.max(0, requestedHour - defaultHour);

  let totalPrice = Number(option.price || 0);
  if (String(option.autoPricingMode || 'fixed') === 'proportional') {
    const proportionalWindowHours = isEarly
      ? Math.max(0, defaultHour - thresholdHour)
      : Math.max(0, thresholdHour - defaultHour);
    const proportionalRatio = proportionalWindowHours > 0
      ? Math.max(0, Math.min(1, extraHours / proportionalWindowHours))
      : 0;
    totalPrice = isFullNight
      ? concernedNightPrice
      : concernedNightPrice * proportionalRatio;
  }

  return {
    optionId: Number(option.id),
    title: option.title,
    quantity: 1,
    unitPrice: roundMoney(totalPrice),
    billedUnits: 1,
    priceType: 'per_stay',
    totalPrice: roundMoney(totalPrice),
    autoOptionType: option.autoOptionType,
    autoPricingMode: option.autoPricingMode || 'fixed',
    autoExtraHours: roundMoney(extraHours),
    autoFullNightApplied: Boolean(isFullNight),
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

function getLateCheckoutNextNightReferencePrice({ rules, endDate, stayNights }) {
  const { matchedRule, nightlyBase } = getRuleNightBaseForDate(rules, endDate);
  if ((matchedRule?.pricingMode || 'fixed') !== 'progressive') {
    return roundMoney(nightlyBase);
  }

  const extraNightNumber = Math.max(1, Number(stayNights || 0) + 1);
  const extraNightPrice = extraNightNumber === 1
    ? nightlyBase
    : getProgressiveExtraNightPrice(matchedRule, extraNightNumber, nightlyBase);

  return roundMoney(extraNightPrice);
}

function normalizeBilledUnits(value) {
  const units = Number(value);
  if (!Number.isFinite(units)) return 0;
  return Math.max(0, units);
}

function mergeNightlyBreakdownWithLocked(lockedNightlyBreakdown, freshNightlyBreakdown) {
  const lockedByDate = new Map(
    (Array.isArray(lockedNightlyBreakdown) ? lockedNightlyBreakdown : [])
      .filter((line) => line?.date)
      .map((line) => [String(line.date), line])
  );

  let total = 0;
  const merged = (Array.isArray(freshNightlyBreakdown) ? freshNightlyBreakdown : [])
    .map((line, index) => {
      const locked = lockedByDate.get(String(line.date));
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
  };
}

function mergeLineWithLockedSnapshot({
  lockedLine,
  targetBilledUnits,
  currentUnitPrice,
}) {
  debugResourceLine('merge.locked_snapshot.input', {
    lockedLine,
    targetBilledUnits,
    currentUnitPrice,
  });

  const resolvedTargetUnits = normalizeBilledUnits(targetBilledUnits);
  const normalizedCurrentUnitPrice = roundMoney(currentUnitPrice);

  debugResourceLine('merge.locked_snapshot.normalized', {
    resolvedTargetUnits,
    normalizedCurrentUnitPrice,
  });

  if (!lockedLine) {
    const result = {
      billedUnits: resolvedTargetUnits,
      totalPrice: roundMoney(resolvedTargetUnits * normalizedCurrentUnitPrice),
      unitPrice: normalizedCurrentUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.no_locked_line', { result });
    return result;
  }

  const lockedTotal = roundMoney(lockedLine.totalPrice);
  const lockedUnits = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined
      ? lockedLine.billedUnits
      : lockedLine.quantity
  );
  const lockedUnitPrice = lockedUnits > 0
    ? roundMoney(lockedTotal / lockedUnits)
    : roundMoney(lockedLine.unitPrice || normalizedCurrentUnitPrice);

  debugResourceLine('merge.locked_snapshot.locked_values', {
    lockedTotal,
    lockedUnits,
    lockedUnitPrice,
  });

  if (resolvedTargetUnits === lockedUnits) {
    const result = {
      billedUnits: lockedUnits,
      totalPrice: lockedTotal,
      unitPrice: lockedUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.same_units', { result });
    return result;
  }

  if (resolvedTargetUnits > lockedUnits) {
    const deltaUnits = resolvedTargetUnits - lockedUnits;
    const mergedTotal = roundMoney(lockedTotal + deltaUnits * normalizedCurrentUnitPrice);
    const result = {
      billedUnits: resolvedTargetUnits,
      totalPrice: mergedTotal,
      unitPrice: resolvedTargetUnits > 0 ? roundMoney(mergedTotal / resolvedTargetUnits) : normalizedCurrentUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.increase_units', {
      deltaUnits,
      mergedTotal,
      result,
    });
    return result;
  }

  const removedUnits = lockedUnits - resolvedTargetUnits;
  const reducedTotal = roundMoney(Math.max(0, lockedTotal - removedUnits * lockedUnitPrice));
  const result = {
    billedUnits: resolvedTargetUnits,
    totalPrice: reducedTotal,
    unitPrice: resolvedTargetUnits > 0 ? roundMoney(reducedTotal / resolvedTargetUnits) : lockedUnitPrice,
  };
  debugResourceLine('merge.locked_snapshot.decrease_units', {
    removedUnits,
    reducedTotal,
    result,
  });
  return result;
}

/**
 * A locked line that was "offered" is stored with totalPrice = 0, which would erase its real price
 * (the merge derives unit price from total/units). To keep offering lossless, reconstruct the real
 * total from the stored unit price before merging. A genuinely free line (unit price 0) is left as-is.
 */
function reconstructLockedRealTotal(lockedLine) {
  if (!lockedLine) return lockedLine;
  const total = roundMoney(lockedLine.totalPrice);
  if (total > 0) return lockedLine;
  const units = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined ? lockedLine.billedUnits : lockedLine.quantity
  );
  const unit = roundMoney(lockedLine.unitPrice || 0);
  if (units > 0 && unit > 0) {
    return { ...lockedLine, totalPrice: roundMoney(units * unit) };
  }
  return lockedLine;
}

/**
 * Applies the `offered` flag to a computed (real) line total. The real price is always preserved as
 * `originalTotalPrice`; offering only zeroes the billed `totalPrice`. This is the single place where
 * offering affects money, so toggling offered on/off is always lossless.
 */
function applyOfferedToLine(realTotal, offered) {
  const real = roundMoney(realTotal);
  return {
    originalTotalPrice: real,
    totalPrice: offered ? 0 : real,
    offered: Boolean(offered),
  };
}

function getApplicableOptions(db, propertyId) {
  const options = db.prepare('SELECT * FROM options ORDER BY title').all();
  const propStmt = db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId');
  return options
    .map((option) => ({
      ...option,
      propertyIds: propStmt.all(option.id).map((row) => Number(row.propertyId)),
    }))
    .filter((option) => option.propertyIds.length === 0 || option.propertyIds.includes(Number(propertyId)));
}

function getApplicableResources(db, propertyId) {
  let resources;
  try {
    resources = db.prepare(`
      SELECT r.*, prp.price as propertyPrice, prp.freeMinutes as propertyFreeMinutes
      FROM resources r
      LEFT JOIN property_resource_prices prp ON prp.resourceId = r.id AND prp.propertyId = ?
      ORDER BY r.name
    `).all(Number(propertyId));
  } catch (error) {
    if (!String(error?.message || '').toLowerCase().includes('no such table: property_resource_prices')) {
      throw error;
    }
    resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
  }
  // Applicability from the resource_properties pivot (a resource with no rows = global / all logements).
  let scopedByResource = null; // Map<resourceId, Set<propertyId>>
  try {
    scopedByResource = new Map();
    for (const row of db.prepare('SELECT resourceId, propertyId FROM resource_properties').all()) {
      if (!scopedByResource.has(row.resourceId)) scopedByResource.set(row.resourceId, new Set());
      scopedByResource.get(row.resourceId).add(Number(row.propertyId));
    }
  } catch {
    scopedByResource = null; // pivot absent (minimal test schema) → treat all as global
  }

  return resources
    .map((resource) => ({
      ...resource,
      price: resource.propertyPrice != null ? Number(resource.propertyPrice) : Number(resource.price || 0),
      freeMinutes: resource.propertyFreeMinutes != null
        ? Math.max(0, Number(resource.propertyFreeMinutes || 0))
        : 0,
    }))
    .filter((resource) => {
      if (!scopedByResource) return true;
      const scoped = scopedByResource.get(resource.id);
      return !scoped || scoped.size === 0 || scoped.has(Number(propertyId));
    });
}

function applyPerHourFreeMinutes(baseUnits, freeMinutes) {
  const normalizedUnits = normalizeBilledUnits(baseUnits);
  const normalizedFreeMinutes = Math.max(0, Number(freeMinutes || 0));
  const freeUnits = roundMoney(normalizedFreeMinutes / 60);
  return roundMoney(Math.max(0, normalizedUnits - freeUnits));
}

function getProgressiveExtraNightPrice(rule, nightNumber, fallbackBasePrice) {
  const normalizedTiers = normalizeProgressiveTiers(Number(rule?.pricePerNight || fallbackBasePrice || 0), rule?.progressiveTiers);
  const tier = normalizedTiers.find((entry) => Number(entry.nightNumber) === Number(nightNumber));
  return tier ? Number(tier.extraNightPrice || 0) : Number(fallbackBasePrice || 0);
}

const DEBUG_RESOURCE_LINES = process.env.DEBUG_RESOURCE_LINES === '1';

function debugResourceLine(stage, payload) {
  if (!DEBUG_RESOURCE_LINES) return;
  try {
    console.log(`[pricing.resourceLines] ${stage}`, payload);
  } catch {
    // Keep pricing computation resilient even if debug logging fails.
  }
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
    };
  }

  let totalPrice = 0;
  const nightlyBreakdown = [];
  const minNightsByRule = new Map();
  let currentDateStr = startDate;

  for (let nightIndex = 0; nightIndex < nights; nightIndex += 1) {
    const dateStr = currentDateStr;
    let matchedRule = null;
    let nightlyBase = 100;

    for (const rule of rules) {
      const ranges = parseRuleDateRanges(rule);
      if (!ranges.length) {
        matchedRule = rule;
        nightlyBase = Number(rule.pricePerNight || 0);
        minNightsByRule.set(String(rule.label || 'Standard'), Number(rule.minNights || 1));
        break;
      }
      if (ranges.some((range) => dateStr >= range.startDate && dateStr <= range.endDate)) {
        matchedRule = rule;
        nightlyBase = Number(rule.pricePerNight || 0);
        minNightsByRule.set(String(rule.label || 'Standard'), Number(rule.minNights || 1));
        break;
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

  return {
    nights,
    totalPrice: roundMoney(totalPrice),
    nightlyBreakdown,
    requiredMinNights: Math.max(1, ...Array.from(minNightsByRule.values()).map((v) => Number(v || 1))),
    minNightsRules: Array.from(minNightsByRule.entries()).map(([label, minNights]) => ({
      label,
      minNights: Number(minNights || 1),
    })),
    minNightsBreached: nights < Math.max(1, ...Array.from(minNightsByRule.values()).map((v) => Number(v || 1))),
  };
}

function calculateReservationQuote({
  db,
  propertyId,
  startDate,
  endDate,
  checkInTime,
  checkOutTime,
  adults,
  children,
  teens,
  babies,
  discountPercent,
  customPrice,
  selectedOptions,
  customOptions,
  selectedResources,
  depositPaid,
  balancePaid,
  depositAmount,
  balanceAmount,
  offeredOptionIds,
  extraGuestSurchargeOffered,
  lockedOptionUnits,
  lockedResourceUnits,
  lockedNightlyBreakdown,
  lockedOptionLines,
  lockedResourceLines,
  platform,
}) {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) {
    return { error: 'Logement non trouvé', status: 404 };
  }

  const rules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(propertyId);
  const calculatedBase = calculateBaseStayPrice(rules, startDate, endDate);
  const {
    nights,
    nightlyBreakdown: freshNightlyBreakdown,
    requiredMinNights,
    minNightsRules,
    minNightsBreached,
  } = calculatedBase;
  if (nights <= 0) {
    return {
      property,
      nights: 0,
      nightlyBreakdown: [],
      requiredMinNights: 1,
      minNightsRules: [],
      minNightsBreached: false,
      persons: 0,
      totalPrice: 0,
      optionsTotal: 0,
      resourcesTotal: 0,
      subtotal: 0,
      discountAmount: 0,
      finalPrice: 0,
      engineFinalPrice: 0,
      priceOverridden: false,
      depositAmount: 0,
      balanceAmount: 0,
      depositDueDate: null,
      balanceDueDate: null,
      touristTaxRate: Number(property.touristTaxPerDayPerPerson || 0),
      touristTaxTotal: 0,
      totalStayPrice: 0,
      defaultCheckIn: property.defaultCheckIn || '15:00',
      defaultCheckOut: property.defaultCheckOut || '10:00',
      optionLines: [],
      resourceLines: [],
      vatPercentageAccommodation: Number(property.vatPercentageAccommodation || 20),
      vatPercentageOptions: Number(property.vatPercentageOptions || 20),
      vatPercentageResources: Number(property.vatPercentageResources || 20),
      accommodationNetPrice: 0,
      accommodationVatAmount: 0,
      optionsNetPrice: 0,
      optionsVatAmount: 0,
      resourcesNetPrice: 0,
      resourcesVatAmount: 0,
      totalNetPrice: 0,
      totalVatAmount: 0,
    };
  }

  const persons = (Number(adults || 1) || 1) + (Number(children || 0) || 0) + (Number(teens || 0) || 0);
  const optionsById = new Map(getApplicableOptions(db, propertyId).map((option) => [Number(option.id), option]));
  const resourcesById = new Map(getApplicableResources(db, propertyId).map((resource) => [Number(resource.id), resource]));
  const optionUnitOverrides = lockedOptionUnits || {};
  const resourceUnitOverrides = lockedResourceUnits || {};
  const offeredOptionIdSet = new Set((Array.isArray(offeredOptionIds) ? offeredOptionIds : []).map((id) => Number(id)));
  const lockedOptionsById = new Map(
    (Array.isArray(lockedOptionLines) ? lockedOptionLines : [])
      .map((line) => [Number(line.optionId), line])
  );
  const lockedResourcesById = new Map(
    (Array.isArray(lockedResourceLines) ? lockedResourceLines : [])
      .map((line) => [Number(line.resourceId), line])
  );

  const mergedNightly = mergeNightlyBreakdownWithLocked(lockedNightlyBreakdown, freshNightlyBreakdown);
  const nightlyBreakdown = mergedNightly.nightlyBreakdown;
  const baseAccommodationPrice = mergedNightly.totalPrice;

  const includedGuests = Math.max(0, Number(property.basePriceIncludedGuests || 0));
  const extraGuestUnitPrice = Math.max(0, Number(property.extraGuestPrice || 0));
  const isExtraGuestSurchargeOffered = Boolean(extraGuestSurchargeOffered);
  const extraGuestCount = Math.max(0, persons - includedGuests);
  const extraGuestSurchargeOriginal = roundMoney(extraGuestCount * extraGuestUnitPrice);
  const extraGuestSurcharge = isExtraGuestSurchargeOffered ? 0 : extraGuestSurchargeOriginal;
  const totalPrice = roundMoney(baseAccommodationPrice);

  const optionLines = (Array.isArray(selectedOptions) ? selectedOptions : [])
    .map((selected) => {
      const quantity = Math.max(0, Number(selected?.quantity || 0));
      if (quantity <= 0) return null;
      const optionId = Number(selected.optionId);
      const option = optionsById.get(optionId);
      if (!option) return null;
      const priceType = option.priceType || 'per_stay';

      if (priceType === 'per_participant_progressive') {
        const fallbackUnitPrice = Number(option.price || 0);
        const progressiveTiers = normalizeOptionProgressiveTiers(option.optionProgressiveTiers);
        const computed = calculateProgressiveParticipantOptionTotal(
          quantity,
          progressiveTiers,
          fallbackUnitPrice
        );
        const lockedLine = reconstructLockedRealTotal(lockedOptionsById.get(optionId));
        const lockedUnits = normalizeBilledUnits(
          lockedLine?.billedUnits !== undefined
            ? lockedLine.billedUnits
            : lockedLine?.quantity
        );
        const keepLockedSnapshot = Boolean(
          lockedLine
            && Number(lockedLine.totalPrice || 0) > 0
            && lockedUnits === computed.billedUnits
        );
        const realTotal = keepLockedSnapshot ? roundMoney(lockedLine.totalPrice) : computed.totalPrice;
        const effectiveAverageUnit = computed.billedUnits > 0
          ? roundMoney(realTotal / computed.billedUnits)
          : 0;

        return {
          optionId,
          title: option.title,
          quantity,
          unitPrice: effectiveAverageUnit,
          billedUnits: computed.billedUnits,
          priceType,
          optionProgressiveTiers: progressiveTiers,
          progressiveLastUnitPrice: computed.lastUnitPrice,
          ...applyOfferedToLine(realTotal, offeredOptionIdSet.has(optionId)),
        };
      }

      const unitBase = Number.isFinite(Number(optionUnitOverrides[optionId]))
        ? Number(optionUnitOverrides[optionId])
        : Number(option.price || 0);
      const targetBilledUnits = roundMoney(quantity * getTypeMultiplier(priceType, persons, nights));
      const merged = mergeLineWithLockedSnapshot({
        lockedLine: reconstructLockedRealTotal(lockedOptionsById.get(optionId)),
        targetBilledUnits,
        currentUnitPrice: unitBase,
      });
      return {
        optionId,
        title: option.title,
        quantity,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        priceType,
        ...applyOfferedToLine(merged.totalPrice, offeredOptionIdSet.has(optionId)),
      };
    })
    .filter(Boolean);

  const customOptionLines = (Array.isArray(customOptions) ? customOptions : [])
    .map((line, index) => {
      const description = String(line?.description || '').trim();
      const amount = roundMoney(Math.max(0, Number(line?.amount || 0)));
      const offered = Boolean(line?.offered);
      if (!description || amount <= 0) return null;
      return {
        isCustom: true,
        customKey: line?.customKey || `custom_${index + 1}`,
        title: description,
        offered,
        quantity: 1,
        unitPrice: amount,
        billedUnits: 1,
        priceType: 'per_stay',
        originalTotalPrice: amount,
        totalPrice: offered ? 0 : amount,
      };
    })
    .filter(Boolean);

  const selectedOptionIds = new Set(optionLines.map((line) => Number(line.optionId)));
  const autoOptionLines = Array.from(optionsById.values())
    .filter((option) => Number(option.autoEnabled || 0) === 1)
    .map((option) => computeAutoTimedOptionContext({
      option,
      checkInTime,
      checkOutTime,
      defaultCheckIn: property.defaultCheckIn || '15:00',
      defaultCheckOut: property.defaultCheckOut || '10:00',
      nightlyBreakdown,
      lateCheckoutNextNightPrice: getLateCheckoutNextNightReferencePrice({
        rules,
        endDate,
        stayNights: nights,
      }),
    }))
    .filter(Boolean)
    .map((line) => {
      const optionId = Number(line.optionId);
      const merged = mergeLineWithLockedSnapshot({
        lockedLine: reconstructLockedRealTotal(lockedOptionsById.get(optionId)),
        targetBilledUnits: 1,
        currentUnitPrice: line.unitPrice,
      });
      return {
        ...line,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        ...applyOfferedToLine(merged.totalPrice, offeredOptionIdSet.has(optionId)),
      };
    })
    .filter((line) => !selectedOptionIds.has(Number(line.optionId)));

  // Render the summary in the same order as the main option list (catalog order = by title);
  // custom options keep their input order at the end.
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr');
  const finalOptionLines = [
    ...[...optionLines, ...autoOptionLines].sort(byTitle),
    ...customOptionLines,
  ];

  const resourceLines = (Array.isArray(selectedResources) ? selectedResources : [])
    .map((selected) => {
      debugResourceLine('input.selected', { selected });

      const quantity = Math.max(0, Number(selected?.quantity || 0));
      debugResourceLine('parsed.quantity', { quantity });
      if (quantity <= 0) {
        debugResourceLine('skip.non_positive_quantity', { quantity, selected });
        return null;
      }

      const resourceId = Number(selected.resourceId);
      debugResourceLine('parsed.resourceId', { resourceId });
      const resource = resourcesById.get(resourceId);
      if (!resource) {
        debugResourceLine('skip.resource_not_found', {
          resourceId,
          selected,
          knownResourceIds: Array.from(resourcesById.keys()),
        });
        return null;
      }

      debugResourceLine('pricing.base', {
        resourceId,
        resource
      });
      
      const isComplexResource = Number(resource.isComplex || 0) === 1
        || resource.isComplex === true
        || String(resource.isComplex || '').toLowerCase() === 'true';
      const usesHourlyQuantity = resource.priceType === 'per_hour'
        || isComplexResource
        || Number(resource.freeMinutes || 0) > 0;

      debugResourceLine('pricing.type_flags', {
        resourceId,
        isComplexResource,
        usesHourlyQuantity,
        freeMinutes: Number(resource.freeMinutes || 0),
      });

      const baseBilledUnits = usesHourlyQuantity
        ? roundMoney(quantity)
        : roundMoney(quantity * getTypeMultiplier(resource.priceType, persons, nights));
      const targetBilledUnits = usesHourlyQuantity
        ? applyPerHourFreeMinutes(baseBilledUnits, resource.freeMinutes)
        : baseBilledUnits;

      debugResourceLine('pricing.units', {
        resourceId,
        persons,
        nights,
        quantity,
        baseBilledUnits,
        targetBilledUnits,
      });

      const lockedLine = lockedResourcesById.get(resourceId);
      const hasExplicitOffered = selected?.offered !== undefined && selected?.offered !== null;
      const offered = hasExplicitOffered ? Boolean(selected?.offered) : Boolean(lockedLine?.offered);

      const merged = mergeLineWithLockedSnapshot({
        lockedLine: reconstructLockedRealTotal(lockedLine),
        targetBilledUnits,
        currentUnitPrice: resource.price,
      });

      const resultLine = {
        resourceId,
        name: resource.name,
        quantity,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        ...applyOfferedToLine(merged.totalPrice, offered),
      };

      debugResourceLine('pricing.output_line', {
        resourceId,
        resultLine,
      });

      return resultLine;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));

  debugResourceLine('pricing.output_lines', { resourceLines });

  const optionsTotal = roundMoney(finalOptionLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const resourcesTotal = roundMoney(resourceLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const accommodationBaseTotal = roundMoney(Number(totalPrice || 0));
  const subtotal = roundMoney(accommodationBaseTotal + extraGuestSurcharge + optionsTotal + resourcesTotal);
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const customFinalPrice = customPrice === '' || customPrice === null || customPrice === undefined
    ? null
    : Number(customPrice);
  const accommodationAdjustedPrice = roundMoney(
    Number.isFinite(customFinalPrice)
      ? customFinalPrice
      : accommodationBaseTotal * (1 - normalizedDiscountPercent / 100)
  );
  const finalPrice = roundMoney(accommodationAdjustedPrice + extraGuestSurcharge + optionsTotal + resourcesTotal);
  const discountAmount = roundMoney(Math.max(0, subtotal - finalPrice));
  const accommodationDiscountAmount = roundMoney(Math.max(0, accommodationBaseTotal - accommodationAdjustedPrice));
  const accommodationDeltaAmount = roundMoney(Math.abs(accommodationBaseTotal - accommodationAdjustedPrice));
  const baseAccommodationAdjustedPrice = roundMoney(
    Number.isFinite(customFinalPrice)
      ? customFinalPrice
      : baseAccommodationPrice * (1 - normalizedDiscountPercent / 100)
  );
  const accommodationDeltaType = accommodationAdjustedPrice < accommodationBaseTotal
    ? 'reduction'
    : accommodationAdjustedPrice > accommodationBaseTotal
      ? 'increase'
      : 'none';

  // Engine price = what the pricing engine computes ignoring any manual override, so the client can
  // show the engine value alongside an overridden price. `finalPrice` stays the effective amount.
  const priceOverridden = Number.isFinite(customFinalPrice);
  const engineAccommodationPrice = roundMoney(accommodationBaseTotal * (1 - normalizedDiscountPercent / 100));
  const engineFinalPrice = roundMoney(engineAccommodationPrice + extraGuestSurcharge + optionsTotal + resourcesTotal);

  // VAT calculations (all prices are TTC - VAT already included)
  const vatPercentageAccommodation = Number(property.vatPercentageAccommodation || 20);
  const vatPercentageOptions = Number(property.vatPercentageOptions || 20);
  const vatPercentageResources = Number(property.vatPercentageResources || 20);
  
  // For TTC prices: VAT amount = TTC × (vatRate / (100 + vatRate))
  const accommodationVatAmount = roundMoney(accommodationAdjustedPrice * (vatPercentageAccommodation / (100 + vatPercentageAccommodation)));
  const accommodationNetPrice = roundMoney(accommodationAdjustedPrice - accommodationVatAmount);
  
  const optionsVatAmount = roundMoney(optionsTotal * (vatPercentageOptions / (100 + vatPercentageOptions)));
  const optionsNetPrice = roundMoney(optionsTotal - optionsVatAmount);
  
  const resourcesVatAmount = roundMoney(resourcesTotal * (vatPercentageResources / (100 + vatPercentageResources)));
  const resourcesNetPrice = roundMoney(resourcesTotal - resourcesVatAmount);
  
  const totalVatAmount = roundMoney(accommodationVatAmount + optionsVatAmount + resourcesVatAmount);
  const totalNetPrice = roundMoney(accommodationNetPrice + optionsNetPrice + resourcesNetPrice);

  const depositDueDate = addDaysToIsoDate(startDate, -Number(property.depositDaysBefore || 0));
  const balanceDueDate = addDaysToIsoDate(startDate, -Number(property.balanceDaysBefore || 0));

  const touristTaxBreakdown = computeTouristTaxBreakdown({
    touristTaxMode: property.touristTaxMode,
    touristTaxPerDayPerPerson: property.touristTaxPerDayPerPerson,
    touristTaxPercentage: property.touristTaxPercentage,
    touristTaxDepartmentPercentage: property.touristTaxDepartmentPercentage,
    touristTaxFixedAmount: property.touristTaxFixedAmount,
    nights,
    adults: Number(adults || 0),
    occupants: Number(adults || 0) + Number(children || 0) + Number(teens || 0) + Number(babies || 0),
    accommodationAmountTtc: baseAccommodationAdjustedPrice,
    accommodationVatRate: vatPercentageAccommodation,
  });
  // Tourist tax is offered (set to 0) when collected by non-direct platforms.
  const normalizedPlatform = String(platform || 'direct').toLowerCase();
  const isTouristTaxOfferedByPlatform = normalizedPlatform !== 'direct';
  let touristTaxTotal = touristTaxBreakdown.touristTaxTotal;
  if (isTouristTaxOfferedByPlatform) {
    touristTaxTotal = 0;
  }

  // Payment schedule is based on the full stay amount, including tourist tax.
  const totalStayPrice = roundMoney(finalPrice + touristTaxTotal);
  const autoDepositAmount = roundMoney(totalStayPrice * (Number(property.depositPercent || 0) / 100));
  const autoBalanceAmount = roundMoney(totalStayPrice - autoDepositAmount);
  let resolvedDepositAmount = autoDepositAmount;
  let resolvedBalanceAmount = autoBalanceAmount;

  if (depositPaid && balancePaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    resolvedBalanceAmount = roundMoney(balanceAmount);
  } else if (depositPaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    resolvedBalanceAmount = roundMoney(Math.max(0, totalStayPrice - resolvedDepositAmount));
  }

  return {
    property,
    nights,
    nightlyBreakdown,
    requiredMinNights,
    minNightsRules,
    minNightsBreached,
    persons,
    totalPrice: roundMoney(totalPrice),
    baseAccommodationPrice: roundMoney(baseAccommodationPrice),
    includedGuests,
    extraGuestUnitPrice,
    extraGuestCount,
    extraGuestSurchargeOffered: isExtraGuestSurchargeOffered,
    extraGuestSurchargeOriginal,
    extraGuestSurcharge,
    optionsTotal,
    resourcesTotal,
    subtotal,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalPrice,
    engineFinalPrice,
    priceOverridden,
    depositAmount: resolvedDepositAmount,
    balanceAmount: resolvedBalanceAmount,
    depositDueDate,
    balanceDueDate,
    baseAccommodationAdjustedPrice,
    ...touristTaxBreakdown,
    touristTaxOriginalTotal: Number(touristTaxBreakdown.touristTaxTotal || 0),
    touristTaxTotal,
    touristTaxOfferedByPlatform: isTouristTaxOfferedByPlatform,
    totalStayPrice,
    defaultCheckIn: property.defaultCheckIn || '15:00',
    defaultCheckOut: property.defaultCheckOut || '10:00',
    optionLines: finalOptionLines,
    resourceLines,
    // VAT breakdown (all prices are TTC)
    vatPercentageAccommodation,
    vatPercentageOptions,
    vatPercentageResources,
    accommodationAdjustedPrice,
    accommodationDiscountAmount,
    accommodationDeltaAmount,
    accommodationDeltaType,
    accommodationNetPrice,
    accommodationVatAmount,
    optionsNetPrice,
    optionsVatAmount,
    resourcesNetPrice,
    resourcesVatAmount,
    totalNetPrice,
    totalVatAmount,
  };
}

module.exports = {
  roundMoney,
  parseJsonArray,
  normalizeOptionProgressiveTiers,
  calculateProgressiveParticipantOptionTotal,
  computeTouristTaxBreakdown,
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  buildDefaultProgressiveTiers,
  normalizeProgressiveTiers,
  buildProgressivePreview,
  calculateReservationQuote,
};

module.exports.__test = {
  timeToDecimalHour,
  computeAutoTimedOptionContext,
  normalizeOptionProgressiveTiers,
  calculateProgressiveParticipantOptionTotal,
  computeTouristTaxBreakdown,
  calculateReservationQuote,
};