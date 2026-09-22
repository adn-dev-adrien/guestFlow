/**
 * Portions of a per-person planning-card option sold on the PUBLIC site
 * (specs/site-meal-portions.md).
 *
 * On the site the visitor cannot schedule slots, so the quantity they type IS what gets billed:
 * one unit = one breakfast, one cover. This module owns the two things that meaning needs — how
 * many servings a stay can physically hold, and the French words that name them — so the engine,
 * the public projections and the controllers all answer the same number with the same label.
 *
 * Pure: every function takes what it needs and reads no database.
 */

const BREAKFAST_TYPE = 'breakfast';
const NOON = 12;

const WORDINGS = Object.freeze({
  breakfast: {
    unit: 'petit déjeuner',
    unitPlural: 'petits déjeuners',
    priceUnitLabel: 'par petit déjeuner',
    quantityLabel: 'Nombre de petits déjeuners',
    servingUnit: 'matin',
    servingUnitPlural: 'matins',
  },
  meal: {
    unit: 'couvert',
    unitPlural: 'couverts',
    priceUnitLabel: 'par couvert',
    quantityLabel: 'Nombre de couverts',
    servingUnit: 'repas',
    servingUnitPlural: 'repas',
  },
});

function isBreakfast(option) {
  return String(option?.autoOptionType || '') === BREAKFAST_TYPE;
}

/**
 * A per-person planning-card option: the ones whose quantity means portions on the site. The
 * cancellation insurance is excluded even when it carries a card — it is priced from the stay
 * (specs/cancellation-insurance.md §3.1 rule 5bis).
 */
function isPerPersonCardOption(option) {
  if (!option) return false;
  if (Number(option.showsPlanningCard || 0) !== 1) return false;
  if (Number(option.isCancellationInsurance || 0) === 1) return false;
  return String(option.priceType || '').startsWith('per_person');
}

function hourOf(time, fallback) {
  const value = String(time || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number(fallback);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number(fallback);
  return hours + minutes / 60;
}

/**
 * How many servings of this option the stay can hold, per person (spec rule 3):
 *   - breakfast → one per morning, so `nights`;
 *   - any other per-person card option (a meal) → two a day, plus the arrival lunch when the guests
 *     land before noon, plus the departure lunch when they leave after noon.
 *
 * The visitor's own times win; absent, the property's default check-in / check-out decide. Both
 * comparisons are strict: arriving or leaving AT 12:00 adds nothing.
 *
 * @returns {{servings: number, extras: {arrival: boolean, departure: boolean}}}
 */
function servingsFor({ option, nights, checkInTime, checkOutTime, property } = {}) {
  const stayNights = Math.max(0, Math.floor(Number(nights) || 0));
  if (isBreakfast(option)) {
    return { servings: stayNights, extras: { arrival: false, departure: false } };
  }
  const arrival = hourOf(checkInTime || property?.defaultCheckIn, 15) < NOON;
  const departure = hourOf(checkOutTime || property?.defaultCheckOut, 10) > NOON;
  const servings = stayNights > 0
    ? 2 * stayNights + (arrival ? 1 : 0) + (departure ? 1 : 0)
    : 0;
  return { servings, extras: { arrival, departure } };
}

/**
 * The cap on the portions of one option for one stay: every person can be served at every serving.
 *
 * @returns {{cap: number, servings: number, persons: number, extras: object}}
 */
function portionCap({ option, persons, nights, checkInTime, checkOutTime, property } = {}) {
  const party = Math.max(0, Math.floor(Number(persons) || 0));
  const { servings, extras } = servingsFor({ option, nights, checkInTime, checkOutTime, property });
  return { cap: party * servings, servings, persons: party, extras };
}

/**
 * Hold a requested quantity to the cap. `clampedFrom` is what the visitor asked for, and only when
 * it was actually lowered — the live quote reports it so the drawer can follow its own number down
 * instead of showing a price that matches nothing on screen.
 */
function clampPortions(quantity, cap) {
  const wanted = Math.max(0, Math.floor(Number(quantity) || 0));
  const ceiling = Math.max(0, Math.floor(Number(cap) || 0));
  if (wanted <= ceiling) return { quantity: wanted, clampedFrom: null };
  return { quantity: ceiling, clampedFrom: wanted };
}

function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/**
 * The French words for one option — the single place that names a portion, so the catalogue label,
 * the drawer's hint and the refusal all say the same thing.
 */
function portionWording(option) {
  const words = isBreakfast(option) ? WORDINGS.breakfast : WORDINGS.meal;
  const servingsText = (servings) => plural(servings, words.servingUnit, words.servingUnitPlural);
  return {
    ...words,
    /** « Jusqu'à 32 — 4 personnes × 8 repas (2 par jour, déjeuner d'arrivée inclus) » */
    hint({ cap, persons, servings, extras }) {
      const base = `Jusqu'à ${cap} — ${plural(persons, 'personne', 'personnes')} × ${servingsText(servings)}`;
      if (isBreakfast(option)) return base;
      const added = [];
      if (extras?.arrival) added.push("déjeuner d'arrivée");
      if (extras?.departure) added.push('déjeuner de départ');
      return `${base} (2 par jour${added.length ? `, ${added.join(' et ')} inclus` : ''})`;
    },
    /** « 6 petits déjeuners au maximum pour 2 personnes et 3 nuits. » */
    refusal({ cap, persons, servings, nights }) {
      const basis = isBreakfast(option)
        ? plural(Math.max(0, Math.floor(Number(nights) || 0)), 'nuit', 'nuits')
        : servingsText(servings);
      return `${plural(cap, words.unit, words.unitPlural)} au maximum pour ${plural(persons, 'personne', 'personnes')} et ${basis}.`;
    },
  };
}

module.exports = {
  isBreakfast,
  isPerPersonCardOption,
  servingsFor,
  portionCap,
  clampPortions,
  portionWording,
};
