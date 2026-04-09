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

function getWeekPriceEquivalent(baseNightPrice) {
  return Number(baseNightPrice || 0) * 4;
}

function getTotalFromWeeklyModel(baseNightPrice, nights) {
  const base = Number(baseNightPrice || 0);
  const weekPrice = getWeekPriceEquivalent(base);
  if (nights <= 0) return 0;
  if (nights === 1) return base;
  if (nights === 2) return base * 2;
  if (nights === 3) return weekPrice * 0.6;
  if (nights === 4) return weekPrice * 0.7;
  if (nights === 5) return weekPrice * 0.8;
  if (nights === 6) return weekPrice * 0.9;
  if (nights === 7) return weekPrice;
  return weekPrice * (1 + (nights - 7) * 0.171626984);
}

function buildDefaultProgressiveTiers(baseNightPrice, maxNights = 14) {
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

function normalizeProgressiveTiers(baseNightPrice, progressiveTiers, maxNights = 14) {
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

function buildProgressivePreview(baseNightPrice, progressiveTiers, maxNights = 14) {
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
  const concernedNightPrice = isEarly
    ? Number(nightlyBreakdown?.[0]?.price || 0)
    : Number(nightlyBreakdown?.[Math.max(0, (nightlyBreakdown?.length || 1) - 1)]?.price || 0);

  const isFullNight = isEarly ? requestedHour <= thresholdHour : requestedHour >= thresholdHour;
  const extraHours = isEarly
    ? Math.max(0, defaultHour - requestedHour)
    : Math.max(0, requestedHour - defaultHour);

  let totalPrice = Number(option.price || 0);
  if (String(option.autoPricingMode || 'fixed') === 'proportional') {
    totalPrice = isFullNight
      ? concernedNightPrice
      : (concernedNightPrice / 12) * extraHours;
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
  const resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
  return resources
    .map((resource) => ({
      ...resource,
      propertyIds: parseJsonArray(resource.propertyIds).map((id) => Number(id)),
    }))
    .filter((resource) => resource.propertyIds.length === 0 || resource.propertyIds.includes(Number(propertyId)));
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
  selectedResources,
  depositPaid,
  balancePaid,
  depositAmount,
  balanceAmount,
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
    };
  }

  const persons = (Number(adults || 1) || 1) + (Number(children || 0) || 0) + (Number(teens || 0) || 0);
  const optionsById = new Map(getApplicableOptions(db, propertyId).map((option) => [Number(option.id), option]));
  const resourcesById = new Map(getApplicableResources(db, propertyId).map((resource) => [Number(resource.id), resource]));
  const optionUnitOverrides = lockedOptionUnits || {};
  const resourceUnitOverrides = lockedResourceUnits || {};
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
      const merged = mergeLineWithLockedSnapshot({
        lockedLine,
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
        totalPrice: merged.totalPrice,
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
    }))
    .filter(Boolean)
    .map((line) => {
      const lockedLine = lockedOptionsById.get(Number(line.optionId));
      const merged = mergeLineWithLockedSnapshot({
        lockedLine,
        targetBilledUnits: 1,
        currentUnitPrice: line.unitPrice,
      });
      return {
        ...line,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        totalPrice: merged.totalPrice,
      };
    })
    .filter((line) => !selectedOptionIds.has(Number(line.optionId)));

  const finalOptionLines = [...optionLines, ...autoOptionLines];

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
      const targetBilledUnits = roundMoney(quantity * getTypeMultiplier(priceType, persons, nights));
      const lockedLine = lockedResourcesById.get(resourceId);
      const merged = mergeLineWithLockedSnapshot({
        lockedLine,
        targetBilledUnits,
        currentUnitPrice: unitPrice,
      });
      return {
        resourceId,
        name: resource.name,
        quantity,
        unitPrice: merged.unitPrice,
        billedUnits: merged.billedUnits,
        priceType,
        totalPrice: merged.totalPrice,
      };
    })
    .filter(Boolean);

  const optionsTotal = roundMoney(finalOptionLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const resourcesTotal = roundMoney(resourceLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
  const subtotal = roundMoney(Number(totalPrice || 0) + optionsTotal + resourcesTotal);
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const customFinalPrice = customPrice === '' || customPrice === null || customPrice === undefined
    ? null
    : Number(customPrice);
  const finalPrice = roundMoney(
    Number.isFinite(customFinalPrice)
      ? customFinalPrice
      : subtotal * (1 - normalizedDiscountPercent / 100)
  );
  const discountAmount = roundMoney(Math.max(0, subtotal - finalPrice));

  const autoDepositAmount = roundMoney(finalPrice * (Number(property.depositPercent || 0) / 100));
  const autoBalanceAmount = roundMoney(finalPrice - autoDepositAmount);
  let resolvedDepositAmount = autoDepositAmount;
  let resolvedBalanceAmount = autoBalanceAmount;

  if (depositPaid && balancePaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    resolvedBalanceAmount = roundMoney(balanceAmount);
  } else if (depositPaid) {
    resolvedDepositAmount = roundMoney(depositAmount);
    resolvedBalanceAmount = roundMoney(Math.max(0, finalPrice - resolvedDepositAmount));
  }

  const depositDueDate = addDaysToIsoDate(startDate, -Number(property.depositDaysBefore || 0));
  const balanceDueDate = addDaysToIsoDate(startDate, -Number(property.balanceDaysBefore || 0));

  const touristTaxRate = Number(property.touristTaxPerDayPerPerson || 0);
  const touristTaxTotal = roundMoney(touristTaxRate * nights * persons);

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
    touristTaxRate,
    touristTaxTotal,
    totalStayPrice: roundMoney(finalPrice + touristTaxTotal),
    defaultCheckIn: property.defaultCheckIn || '15:00',
    defaultCheckOut: property.defaultCheckOut || '10:00',
    optionLines: finalOptionLines,
    resourceLines,
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