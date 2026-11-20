/**
 * TIMED OPTIONS — the engine-derived early check-in and late check-out options (specs/pricing-components.md §3 rules 2,
 * 43; specs/timed-options-proportional-pricing.md). Priced from the ACTUAL check-in/out hour against a reference night
 * of the tariff: a full night past the threshold, else the share of the window the guest stays beyond the default hour.
 *
 * Contract:
 *   timeToDecimalHour(time, fallback)               « 15:30 » → 15.5
 *   computeAutoTimedOptionContext({ option, checkInTime, checkOutTime, defaultCheckIn, defaultCheckOut, nightlyBreakdown,
 *                                   lateCheckoutNextNightPrice }) → the option line, or null when no option is due
 *   getLateCheckoutNextNightReferencePrice({ rules, endDate, stayNights }) → the night price a late check-out is read against
 *
 * Reads NIGHTS only. Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('./money');
const { readableTime } = require('./stayClock');
const { getRuleNightBaseForDate, getProgressiveExtraNightPrice } = require('./nights');

// `H:MM` and `HH:MM:SS` read like the stay clock's resolver (rule 44): `09:00:00` is 9, not the fallback.
function timeToDecimalHour(timeStr, fallback = 0) {
  const time = readableTime(timeStr);
  if (!time) return Number(fallback || 0);
  const [hours, minutes] = time.split(':').map(Number);
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
    titleEn: option.titleEn || null,
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

module.exports = { timeToDecimalHour, computeAutoTimedOptionContext, getLateCheckoutNextNightReferencePrice };
