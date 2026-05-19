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
  const resolvedTargetUnits = normalizeBilledUnits(targetBilledUnits);
  const normalizedCurrentUnitPrice = roundMoney(currentUnitPrice);

  if (!lockedLine) {
    return {
      billedUnits: resolvedTargetUnits,
      totalPrice: roundMoney(resolvedTargetUnits * normalizedCurrentUnitPrice),
      unitPrice: normalizedCurrentUnitPrice,
    };
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

  if (resolvedTargetUnits === lockedUnits) {
    return {
      billedUnits: lockedUnits,
      totalPrice: lockedTotal,
      unitPrice: lockedUnitPrice,
    };
  }

  if (resolvedTargetUnits > lockedUnits) {
    const deltaUnits = resolvedTargetUnits - lockedUnits;
    const mergedTotal = roundMoney(lockedTotal + deltaUnits * normalizedCurrentUnitPrice);
    return {
      billedUnits: resolvedTargetUnits,
      totalPrice: mergedTotal,
      unitPrice: resolvedTargetUnits > 0 ? roundMoney(mergedTotal / resolvedTargetUnits) : normalizedCurrentUnitPrice,
    };
  }

  const removedUnits = lockedUnits - resolvedTargetUnits;
  const reducedTotal = roundMoney(Math.max(0, lockedTotal - removedUnits * lockedUnitPrice));
  return {
    billedUnits: resolvedTargetUnits,
    totalPrice: reducedTotal,
    unitPrice: resolvedTargetUnits > 0 ? roundMoney(reducedTotal / resolvedTargetUnits) : lockedUnitPrice,
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
  return resources
    .map((resource) => ({
      ...resource,
      price: resource.propertyPrice != null ? Number(resource.propertyPrice) : Number(resource.price || 0),
      freeMinutes: resource.propertyFreeMinutes != null
        ? Math.max(0, Number(resource.propertyFreeMinutes || 0))
        : 0,
      propertyIds: parseJsonArray(resource.propertyIds).map((id) => Number(id)),
    }))
    .filter((resource) => resource.propertyIds.length === 0 || resource.propertyIds.includes(Number(propertyId)));
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
  lockedOptionUnits,
  lockedResourceUnits,
  lockedNightlyBreakdown,
  lockedOptionLines,
  lockedResourceLines,
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
  const totalPrice = mergedNightly.totalPrice;

  const optionLines = (Array.isArray(selectedOptions) ? selectedOptions : [])
    .map((selected) => {
      const quantity = Math.max(0, Number(selected?.quantity || 0));
      if (quantity <= 0) return null;
      const optionId = Number(selected.optionId);
      const option = optionsById.get(optionId);
      if (!option) return null;
      const unitBase = Number.isFinite(Number(optionUnitOverrides[optionId]))
        ? Number(optionUnitOverrides[optionId])
        : Number(option.price || 0);
      const priceType = option.priceType || 'per_stay';
      const targetBilledUnits = roundMoney(quantity * getTypeMultiplier(priceType, persons, nights));
      const lockedLine = lockedOptionsById.get(optionId);
      const shouldRepriceLockedFreeLine = Boolean(
        !offeredOptionIdSet.has(optionId)
          && lockedLine
          && Number(lockedLine.totalPrice || 0) === 0
          && Number(unitBase || 0) > 0
      );
      const merged = mergeLineWithLockedSnapshot({
        lockedLine: shouldRepriceLockedFreeLine ? null : lockedLine,
        targetBilledUnits,
        currentUnitPrice: unitBase,
      });
      const originalTotalPrice = offeredOptionIdSet.has(optionId) && Number(merged.totalPrice || 0) === 0
        ? roundMoney(targetBilledUnits * Number(unitBase || 0))
        : merged.totalPrice;
      return {
        optionId,
        title: option.title,
        quantity,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        priceType,
        originalTotalPrice,
        offered: offeredOptionIdSet.has(optionId),
        totalPrice: offeredOptionIdSet.has(optionId) ? 0 : merged.totalPrice,
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
      const lockedLine = lockedOptionsById.get(optionId);
      const shouldRepriceLockedFreeLine = Boolean(
        !offeredOptionIdSet.has(optionId)
          && lockedLine
          && Number(lockedLine.totalPrice || 0) === 0
          && Number(line.unitPrice || 0) > 0
      );
      const merged = mergeLineWithLockedSnapshot({
        lockedLine: shouldRepriceLockedFreeLine ? null : lockedLine,
        targetBilledUnits: 1,
        currentUnitPrice: line.unitPrice,
      });
      const originalTotalPrice = offeredOptionIdSet.has(optionId) && Number(merged.totalPrice || 0) === 0
        ? roundMoney(Number(line.unitPrice || 0))
        : merged.totalPrice;
      return {
        ...line,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        originalTotalPrice,
        offered: offeredOptionIdSet.has(optionId),
        totalPrice: offeredOptionIdSet.has(Number(line.optionId)) ? 0 : merged.totalPrice,
      };
    })
    .filter((line) => !selectedOptionIds.has(Number(line.optionId)));

  const finalOptionLines = [...optionLines, ...autoOptionLines, ...customOptionLines];

  const resourceLines = (Array.isArray(selectedResources) ? selectedResources : [])
    .map((selected) => {
      const quantity = Math.max(0, Number(selected?.quantity || 0));
      if (quantity <= 0) return null;
      const resourceId = Number(selected.resourceId);
      const resource = resourcesById.get(resourceId);
      if (!resource) return null;
      const lockedUnit = Number(resourceUnitOverrides[resourceId]);
      const unitPrice = Number.isFinite(lockedUnit)
        ? lockedUnit
        : Number(selected?.unitPrice !== undefined ? selected.unitPrice : resource.price || 0);
      const priceType = resource.priceType || 'per_stay';
      const usesHourlyQuantity = priceType === 'per_hour' || Number(resource.isComplex || 0) === 1;
      const baseBilledUnits = roundMoney(quantity * getTypeMultiplier(priceType, persons, nights));
      const targetBilledUnits = usesHourlyQuantity
        ? applyPerHourFreeMinutes(baseBilledUnits, resource.freeMinutes)
        : baseBilledUnits;
      const lockedLine = lockedResourcesById.get(resourceId);
      const merged = mergeLineWithLockedSnapshot({
        lockedLine,
        targetBilledUnits,
        currentUnitPrice: unitPrice,
      });
      const offered = Boolean(selected?.offered || lockedLine?.offered);
      const calculatedTotal = roundMoney(merged.totalPrice);
      const originalTotalPrice = offered
        ? roundMoney(calculatedTotal > 0 ? calculatedTotal : merged.billedUnits * merged.unitPrice)
        : calculatedTotal;
      return {
        resourceId,
        name: resource.name,
        quantity,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        priceType,
        originalTotalPrice,
        offered,
        totalPrice: offered ? 0 : calculatedTotal,
      };
    })
    .filter(Boolean);

  const optionsTotal = roundMoney(finalOptionLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const resourcesTotal = roundMoney(resourceLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const accommodationBaseTotal = roundMoney(Number(totalPrice || 0));
  const subtotal = roundMoney(accommodationBaseTotal + optionsTotal + resourcesTotal);
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const customFinalPrice = customPrice === '' || customPrice === null || customPrice === undefined
    ? null
    : Number(customPrice);
  const accommodationAdjustedPrice = roundMoney(
    Number.isFinite(customFinalPrice)
      ? customFinalPrice
      : accommodationBaseTotal * (1 - normalizedDiscountPercent / 100)
  );
  const finalPrice = roundMoney(
    Number.isFinite(customFinalPrice)
      ? customFinalPrice + optionsTotal + resourcesTotal
      : accommodationAdjustedPrice + optionsTotal + resourcesTotal
  );
  const discountAmount = roundMoney(Math.max(0, subtotal - finalPrice));
  const accommodationDiscountAmount = roundMoney(Math.max(0, accommodationBaseTotal - accommodationAdjustedPrice));
  const accommodationDeltaAmount = roundMoney(Math.abs(accommodationBaseTotal - accommodationAdjustedPrice));
  const accommodationDeltaType = accommodationAdjustedPrice < accommodationBaseTotal
    ? 'reduction'
    : accommodationAdjustedPrice > accommodationBaseTotal
      ? 'increase'
      : 'none';

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

  // Calculate tourist tax based on mode
  const touristTaxMode = property.touristTaxMode || 'per_day_per_person';
  const adultsCount = Number(adults || 1);
  let touristTaxTotal = 0;
  let touristTaxRate = 0; // Helper value for response
  let touristTaxUnitAmount = 0;
  let touristTaxPercentage = 0;
  let touristTaxFixedAmount = 0;
  let touristTaxPricePerNight = 0;
  let touristTaxLabel = '';
  
  if (touristTaxMode === 'per_day_per_person') {
    // Mode 1: Flat amount per day per adult
    touristTaxRate = Number(property.touristTaxPerDayPerPerson || 0);
    touristTaxUnitAmount = touristTaxRate;
    touristTaxTotal = roundMoney(touristTaxRate * nights * adultsCount);
    touristTaxLabel = `${touristTaxUnitAmount.toFixed(2)}EUR x ${adultsCount} adulte${adultsCount > 1 ? 's' : ''} x ${nights} nuit${nights > 1 ? 's' : ''}`;
  } else if (touristTaxMode === 'percentage_accommodation') {
    // Mode 2: Percentage of accommodation per day per adult
    // Calculate price per night, apply percentage, multiply by nights and adults
    touristTaxPercentage = Number(property.touristTaxPercentage || 0);
    touristTaxRate = touristTaxPercentage; // Store percentage for reference
    touristTaxPricePerNight = roundMoney(accommodationAdjustedPrice / nights);
    touristTaxUnitAmount = roundMoney(touristTaxPricePerNight * (touristTaxPercentage / 100));
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nights * adultsCount);
    touristTaxLabel = `(${touristTaxPricePerNight.toFixed(2)}EUR x ${touristTaxPercentage.toFixed(2)}%) x ${adultsCount} adulte${adultsCount > 1 ? 's' : ''} x ${nights} nuit${nights > 1 ? 's' : ''}`;
  } else if (touristTaxMode === 'percentage_and_fixed') {
    // Mode 3: Percentage of accommodation per night per adult plus fixed amount per night per adult
    touristTaxPercentage = Number(property.touristTaxPercentage || 0);
    touristTaxFixedAmount = Number(property.touristTaxFixedAmount || 0);
    touristTaxRate = touristTaxPercentage; // Store percentage for reference
    touristTaxPricePerNight = roundMoney(accommodationAdjustedPrice / nights);
    touristTaxUnitAmount = roundMoney(
      touristTaxPricePerNight * (touristTaxPercentage / 100) + touristTaxFixedAmount
    );
    touristTaxTotal = roundMoney(touristTaxUnitAmount * nights * adultsCount);
    touristTaxLabel = `((${touristTaxPricePerNight.toFixed(2)}EUR x ${touristTaxPercentage.toFixed(2)}%) + ${touristTaxFixedAmount.toFixed(2)}EUR) x ${adultsCount} adulte${adultsCount > 1 ? 's' : ''} x ${nights} nuit${nights > 1 ? 's' : ''}`;
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
    optionsTotal,
    resourcesTotal,
    subtotal,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalPrice,
    depositAmount: resolvedDepositAmount,
    balanceAmount: resolvedBalanceAmount,
    depositDueDate,
    balanceDueDate,
    touristTaxMode,
    touristTaxRate,
    touristTaxUnitAmount,
    touristTaxPercentage,
    touristTaxFixedAmount,
    touristTaxPricePerNight,
    touristTaxAdultsCount: adultsCount,
    touristTaxNights: nights,
    touristTaxLabel,
    touristTaxTotal,
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
  calculateReservationQuote,
};