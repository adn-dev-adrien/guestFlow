/**
 * Changeover-day validation (specs/tariff-recipes/spec.md §3.4 rules 21-24).
 *
 * A season (pricing rule) may restrict the ARRIVAL weekday, the DEPARTURE weekday, or both
 * (`changeoverArrival` / `changeoverDeparture`, JS weekday convention 0 = dimanche … 6 = samedi,
 * NULL = unrestricted — the default for every existing property). A date range inside the season's
 * `dateRanges` JSON can override either, exactly like `minNights`.
 *
 * Resolution (rule 22): the arrival rule comes from the rule covering the FIRST night, the departure
 * rule from the rule covering the LAST night — never the union over the stay, which would make a
 * season-spanning booking impossible for no reason. The departure weekday applies to the CHECKOUT
 * date (the morning after the last night).
 *
 * Deliberately self-contained (no import from pricing.js — it imports us): the date-range matching
 * is the same "first rule whose range covers the date; a rule with no ranges is a catch-all" contract
 * as the pricing engine's.
 */

const FRENCH_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function parseRanges(rule) {
  let ranges = rule?.dateRanges;
  if (typeof ranges === 'string') {
    try { ranges = JSON.parse(ranges); } catch { ranges = []; }
  }
  return (Array.isArray(ranges) ? ranges : []).filter((r) => r && r.startDate && r.endDate);
}

function normalizeDay(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 6 ? n : null;
}

function weekdayOfIso(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

function addDaysIso(isoDate, delta) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(delta || 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// The (rule, coveringRange) pair for a date — first match wins, a rule without ranges is a catch-all.
function matchRuleForDate(rules, dateStr) {
  for (const rule of rules || []) {
    const ranges = parseRanges(rule);
    if (!ranges.length) return { rule, range: null };
    const hit = ranges.find((r) => dateStr >= r.startDate && dateStr <= r.endDate);
    if (hit) return { rule, range: hit };
  }
  return { rule: null, range: null };
}

// Effective constraint for one side on one date: range override ⇒ season default ⇒ null.
function effectiveDay(rules, dateStr, key) {
  const { rule, range } = matchRuleForDate(rules, dateStr);
  if (!rule) return null;
  const fromRange = normalizeDay(range?.[key]);
  if (fromRange !== null) return fromRange;
  return normalizeDay(rule[key]);
}

/**
 * The required arrival/departure weekdays for a stay (null = unrestricted on that side).
 * Arrival is resolved on the first night, departure on the last night (rule 22).
 */
function resolveChangeover(rules, startDate, endDate) {
  const lastNight = addDaysIso(endDate, -1);
  if (!startDate || !lastNight || lastNight < startDate) {
    return { requiredArrivalWeekday: null, requiredDepartureWeekday: null };
  }
  return {
    requiredArrivalWeekday: effectiveDay(rules, startDate, 'changeoverArrival'),
    requiredDepartureWeekday: effectiveDay(rules, lastNight, 'changeoverDeparture'),
  };
}

/**
 * Breach check for a stay. `breached` is false whenever both sides are unrestricted or respected.
 */
function checkChangeover(rules, startDate, endDate) {
  const { requiredArrivalWeekday, requiredDepartureWeekday } = resolveChangeover(rules, startDate, endDate);
  const arrivalBreached = requiredArrivalWeekday !== null && weekdayOfIso(startDate) !== requiredArrivalWeekday;
  const departureBreached = requiredDepartureWeekday !== null && weekdayOfIso(endDate) !== requiredDepartureWeekday;
  return {
    breached: arrivalBreached || departureBreached,
    arrivalBreached,
    departureBreached,
    requiredArrivalWeekday,
    requiredDepartureWeekday,
    requiredArrivalDayLabel: requiredArrivalWeekday !== null ? FRENCH_DAYS[requiredArrivalWeekday] : null,
    requiredDepartureDayLabel: requiredDepartureWeekday !== null ? FRENCH_DAYS[requiredDepartureWeekday] : null,
  };
}

module.exports = { resolveChangeover, checkChangeover, FRENCH_DAYS };
