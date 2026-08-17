/**
 * Welcome pack — specs/welcome-pack-auto-options.md.
 *
 * The pack an own-channel booking arrives with is not a product: it is the set of options whose
 * first N units the rate already covers (`property_option_prices.freeUnits`, written by the tariff
 * recipe — specs/tariff-recipes/spec.md §3.9). This module turns that set into the lines a brand-new
 * reservation form may apply AS IS, and it applies the one rule that makes the whole feature safe to
 * run unattended: a line is emitted only when the free units cover the WHOLE order, so the pack can
 * never pre-sell a billable unit (rule 7).
 *
 * Pure — no DB access. The rows come from `propertiesModel.listWelcomePackOptions`.
 */

const { getTypeMultiplier } = require('./pricing');
const { isDirectChannel } = require('./platformNameFormat');
const { enumerateStayDates, nightsBetween, cardSlots, seedTime } = require('./cardOccurrences');

const EMPTY_PACK = { eligible: false, lines: [] };

// The card's serving time: its first configured slot, else the option's breakfast hour. '' = untimed,
// which is present on every day.
function servingTime(option) {
  const first = cardSlots(option).find((t) => String(t || '').trim() !== '');
  return String(first || '').trim();
}

// Same presence rule as the reservation form's occurrence grid (`seedTime` excludes what the guest
// can't attend and retimes the breakfast of a departure morning): on the arrival day a slot before
// check-in is out, on the departure day a slot after check-out is out — EXCEPT breakfast, still
// served the departure morning. Middle days are always in.
function isServedOn(option, date, time, startDate, endDate, checkInTime, checkOutTime) {
  return seedTime(option, date, time, startDate, endDate, checkInTime, checkOutTime) != null;
}

// Rule 8 — the first morning: the earliest stay day the option is actually served on. Breakfast at
// 09:00 with a 15:00 check-in ⇒ the day after arrival.
function firstServedDay(option, { startDate, endDate, checkInTime, checkOutTime }) {
  const time = servingTime(option);
  const days = enumerateStayDates(startDate, endDate);
  const date = days.find((d) => isServedOn(option, d, time, startDate, endDate, checkInTime, checkOutTime));
  return date ? { date, time } : null;
}

/**
 * Build the lines a new reservation form may apply for this property.
 *
 * @param {object[]} packOptions rows from `propertiesModel.listWelcomePackOptions`
 * @param {string}   platform    the reservation's platform (own channel ⇒ eligible)
 * @param {object}   context     { startDate, endDate, checkInTime, checkOutTime, adults, children, teens }
 * @returns {{ eligible: boolean, lines: object[] }}
 */
function buildWelcomePackLines({ packOptions = [], platform, ...context } = {}) {
  // Rule 3 — own channel only (`direct` + `Lodgify`), the same gate the pricing engine uses to
  // actually zero the units. Emitting lines off-channel would pre-sell them at full price.
  if (!isDirectChannel(platform)) return EMPTY_PACK;

  const { startDate, endDate, checkInTime, checkOutTime } = context;
  // Rule 9 — the pricing engine's definition of `persons` (babies excluded).
  const persons = (Number(context.adults || 1) || 1)
    + (Number(context.children || 0) || 0)
    + (Number(context.teens || 0) || 0);
  const nights = nightsBetween(startDate, endDate);

  const lines = [];
  for (const option of packOptions) {
    // A fraction of a unit cannot be served: floor before deciding what the rate covers.
    const freeUnits = Math.floor(Number(option.freeUnits || 0));
    if (freeUnits <= 0) continue;
    const optionId = Number(option.optionId);
    const priceType = option.priceType || 'per_stay';
    const base = { optionId, title: option.title, freeUnits, unitPrice: Number(option.unitPrice || 0) };

    if (Number(option.showsPlanningCard || 0) === 1) {
      // Card option: one checked occurrence bills `persons` units when the option is per-person.
      // We only ever grant the first morning (rule 8), so the pack applies iff that single
      // occurrence fits inside the free units (rule 7).
      const factor = String(priceType).includes('per_person') ? persons : 1;
      if (factor > freeUnits) continue;
      const occurrence = firstServedDay(option, { startDate, endDate, checkInTime, checkOutTime });
      if (!occurrence) continue;
      lines.push({ ...base, mode: 'occurrence', occurrence });
      continue;
    }

    // Plain option: the billed units are quantity × the type multiplier, so the pack grants the
    // largest whole quantity the free units still cover — 0 ⇒ no line at all.
    const multiplier = getTypeMultiplier(priceType, persons, nights);
    if (!(multiplier > 0)) continue;
    const quantity = Math.floor(freeUnits / multiplier);
    if (quantity <= 0) continue;
    lines.push({ ...base, mode: 'quantity', quantity });
  }

  return { eligible: lines.length > 0, lines };
}

module.exports = { buildWelcomePackLines, __test: { enumerateStayDates, firstServedDay, servingTime } };
