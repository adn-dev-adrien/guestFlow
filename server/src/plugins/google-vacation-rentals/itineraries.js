/**
 * What is priced for a property (specs/google-vacation-rentals-feed.md rules 4 and 8). Pure: dates are
 * ISO `YYYY-MM-DD` strings, nothing reads the database.
 *
 * An itinerary is (arrival, nights, guests). Arrivals run from today to the end of the horizon, stays
 * from one night to `maxLos` and never past the horizon; the minimum stay and the other refusals are
 * the quote engine's to decide (calendar.js), never guessed here.
 */

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(delta || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** [today, today + horizonDays) — the arrival dates, and the nights a stay may cover. */
function horizon(today, horizonDays) {
  return { from: today, to: addDays(today, horizonDays) };
}

function arrivalDates(today, horizonDays) {
  const out = [];
  for (let i = 0; i < horizonDays; i += 1) out.push(addDays(today, i));
  return out;
}

/** 1…maxLos, cut so that the last night stays inside the horizon. */
function lengthsFor(arrival, { maxLos, horizonEnd }) {
  const room = daysBetween(arrival, horizonEnd);
  const out = [];
  for (let n = 1; n <= Math.min(maxLos, room); n += 1) out.push(n);
  return out;
}

// The tourist-tax modes whose amount moves with the number of guests: per adult and night, and the
// percentage of the price per occupant (the « non classé » rate).
const HEADCOUNT_TAX_MODES = new Set(['per_day_per_person', 'percentage_accommodation']);

function taxDependsOnHeadcount(property) {
  const mode = String(property.touristTaxMode || 'per_day_per_person');
  if (!HEADCOUNT_TAX_MODES.has(mode)) return false;
  if (mode === 'per_day_per_person') return Number(property.touristTaxPerDayPerPerson || 0) > 0;
  return Number(property.touristTaxPercentage || 0) > 0 || Number(property.touristTaxDepartmentPercentage || 0) > 0;
}

/**
 * The party sizes at which the total can change (rule 4): every size up to `cap` when the tourist tax
 * counts the guests; otherwise the included guests (one price for any smaller party), then each extra
 * guest up to `cap`. `cap` is the public guest cap — a larger party is never priced (edge cases).
 */
function partySizes(property, cap) {
  const max = Math.max(1, Math.floor(Number(cap) || 1));
  const included = Math.max(1, Math.min(max, Math.floor(Number(property.basePriceIncludedGuests) || 1)));
  const from = taxDependsOnHeadcount(property) ? 1 : included;
  const out = [];
  for (let g = from; g <= max; g += 1) out.push(g);
  return out;
}

/** The whole space, arrival-major: [{ checkin, nights, guests }]. */
function enumerate({ today, horizonDays, maxLos, sizes }) {
  const horizonEnd = addDays(today, horizonDays);
  const out = [];
  arrivalDates(today, horizonDays).forEach((checkin) => {
    lengthsFor(checkin, { maxLos, horizonEnd }).forEach((nights) => {
      sizes.forEach((guests) => out.push({ checkin, nights, guests }));
    });
  });
  return out;
}

const itineraryKey = ({ checkin, nights, guests }) => `${checkin}|${nights}|${guests}`;

module.exports = {
  addDays, daysBetween, horizon, arrivalDates, lengthsFor, partySizes, taxDependsOnHeadcount, enumerate, itineraryKey,
};
