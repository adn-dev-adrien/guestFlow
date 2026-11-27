/**
 * The price of a resource booking, line by line (specs/resources/resource-booking-pricing-and-invoicing.md rules 3-10).
 *
 * Pure: the caller resolves the resource, the property's price override and the VAT in force; this module returns the
 * whole breakdown the preview shows, the commit stores and the invoice copies. No DB, no clock.
 *
 * Order of the deductions (rule 7): the property's free minutes first, from the start of the slot, then the offered
 * minutes right after them, each priced on the band it falls in — the same slot walk as `priceSessions`.
 */

const sdk = require('../sdk');
const {
  priceSessions, bookingDeductions, toMinutes, pricedSlices,
} = require('./hourlyPricing');

const { splitTtc } = sdk.coreModule('vat');

const OFFER_STEP_MINUTES = 15;

const { roundMoneyOrZero: round2 } = sdk.coreModule('money');
const eurosText = (value) => `${round2(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

const BAND_LABELS = { day: 'Jour', evening: 'Soir' };

/**
 * One band of a priced session as the lines of a price breakdown print it: « Jour · 18:00–19:00 », « 1 h × 50,00 € ».
 * `clock: false` is a session with no time yet (a gift voucher's dateless quote): its label names the band only, never the
 * placeholder hours it was priced on (specs/gift-vouchers/gift-voucher-campaigns.md rule 17).
 */
const bandLineOf = (b, { clock = true } = {}) => ({
  key: `band:${b.band}:${b.from}`,
  label: clock ? `${BAND_LABELS[b.band] || b.band} · ${b.from}–${b.to}` : (BAND_LABELS[b.band] || b.band),
  detail: `${duration(b.minutes)} × ${eurosText(b.rate)}`,
  amount: b.amount,
});

/** Rule 9 — `null` when the value is acceptable, else the French refusal. */
function offeredRefusal(offeredMinutes, { durationMinutes, freeMinutesApplied, perHour }) {
  const n = offeredMinutes;
  if (n === undefined || n === null || n === '' || n === 0 || n === '0') return null;
  const value = typeof n === 'number' || (typeof n === 'string' && /^\d+$/.test(n)) ? Number(n) : NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value % OFFER_STEP_MINUTES !== 0) return 'Temps offert invalide : par tranche de 15 min.';
  if (!perHour) return 'Temps offert : seulement pour une ressource à l’heure.';
  if (value > durationMinutes - freeMinutesApplied) return 'Le temps offert dépasse la durée réservée.';
  return null;
}

function vatOf(total, vat) {
  if (!vat || vat.rate === null || vat.rate === undefined) return null;
  const rate = Number(vat.rate);
  const { vat: amount, net } = splitTtc(total, rate);
  return { rate, amount, net };
}

// A following-hours rate: a stored number (0 is free), `null` when it was left empty (same as the first hour — the engine's fallback).
const nextRateField = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/**
 * The four rates a banded resource is sold at for one audience and one period (specs/resources/hourly-extra-hour-rates.md rules 1, 4;
 * specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 6): the day and evening first-hour rates, and the rates of the following hours of each
 * band. The external set is for a customer with no stay and has a `week` and a `weekend` grid; the guest set is one price every day. An external first-hour rate
 * left at 0 is not sold (no fallback to the guests' rate); a `null` following-hours rate is a row stored before the grids were required, read as the first hour.
 */
function rateGridOf(resource, { external, period = 'week', guestDayRate = Number(resource.price ?? 0) }) {
  if (external) {
    const fields = period === 'weekend'
      ? ['hourlyExternalWeekendDayRate', 'hourlyExternalWeekendEveningRate', 'hourlyExternalWeekendNextDayRate', 'hourlyExternalWeekendNextEveningRate']
      : ['hourlyExternalDayRate', 'hourlyExternalEveningRate', 'hourlyExternalNextDayRate', 'hourlyExternalNextEveningRate'];
    return {
      dayRate: Number(resource[fields[0]]) || 0,
      eveningRate: Number(resource[fields[1]]) || 0,
      dayNextRate: nextRateField(resource[fields[2]]),
      eveningNextRate: nextRateField(resource[fields[3]]),
    };
  }
  return {
    dayRate: guestDayRate,
    eveningRate: Number(resource.hourlyEveningRate) || 0,
    dayNextRate: nextRateField(resource.hourlyNextDayRate),
    eveningNextRate: nextRateField(resource.hourlyNextEveningRate),
  };
}

/**
 * The rates of a booking that is not an outside session of the one engine path — what origin/master priced every booking with (K9, D6): the guests' set for a stay, and for a
 * lodging with no stay, or an outside booking priced before the engine path, the outside set where its band has a first-hour price and the guests' live rate where it has none
 * (the evening falls back to the guests' evening, then to the day rate). This is the only fallback to the guests' rate left, and only for these bookings: a placed outside
 * session is never priced from it (rules 2, 29).
 */
function legacyGridOf(resource, { external, guestDayRate = Number(resource.price ?? 0) }) {
  const guestEveningRate = Number(resource.hourlyEveningRate) || 0;
  const dayRate = external && Number(resource.hourlyExternalDayRate) > 0 ? Number(resource.hourlyExternalDayRate) : guestDayRate;
  const eveningRate = external
    ? (Number(resource.hourlyExternalEveningRate) > 0 ? Number(resource.hourlyExternalEveningRate) : (guestEveningRate > 0 ? guestEveningRate : dayRate))
    : guestEveningRate;
  return {
    dayRate,
    eveningRate,
    dayNextRate: nextRateField(external ? resource.hourlyExternalNextDayRate : resource.hourlyNextDayRate),
    eveningNextRate: nextRateField(external ? resource.hourlyExternalNextEveningRate : resource.hourlyNextEveningRate),
  };
}

const BAND_WORDS = Object.freeze({ day: 'la journée', evening: 'la soirée' });
const PERIOD_WORDS = Object.freeze({ week: ' en semaine', weekend: ' le week-end' });

/** The sentence that says an outside band has no price, naming the period it is about: « Bain nordique » n’a pas de tarif extérieur pour la soirée le week-end. (no period → none named). */
const notSoldSentence = (resource, band, period) => `« ${resource.name} » n’a pas de tarif extérieur pour ${BAND_WORDS[band]}${PERIOD_WORDS[period] || ''}.`;

/**
 * The first slice of [fromMin, toMin) that falls in an outside band with no first-hour price (a first hour that is 0 or empty is not sold: no fallback to another band, period
 * or the guests' rate), or null when every slice is sold. The slices are exactly the ones the pricer prices (`pricedSlices`): a session off the slot grid is judged where it is cut,
 * not on a grid walked from its start. `date` gives each slice its own period; without it `period` applies to all. `anyStart: false` judges a session of the engine's grid.
 * → `{ band, period }` | null.
 */
function unsoldSliceOf(resource, {
  date = null, period = 'week', fromMin, toMin, anyStart = true,
}) {
  const cfg = {
    ...rateConfigOf(resource, { external: true, period: date ? null : period }),
    eveningStart: resource.hourlyEveningStart,
    slotMinutes: resource.slotDuration,
    anyStart,
  };
  const grids = { week: rateGridOf(resource, { external: true, period: 'week' }), weekend: rateGridOf(resource, { external: true, period: 'weekend' }) };
  const unsold = pricedSlices(fromMin, toMin, cfg, date).find((slice) => !((slice.band === 'evening' ? grids[slice.period].eveningRate : grids[slice.period].dayRate) > 0));
  return unsold ? { band: unsold.band, period: unsold.period } : null;
}

/**
 * What `priceSessions` is configured with for a resource: the guests' grid, or the outside customer's week grid with its weekend grid attached (the engine picks
 * each slice's period from its date). A quote with no date passes `period` and never reads a calendar (rule 8).
 */
function rateConfigOf(resource, { external, period = null, guestDayRate }) {
  if (!external) return rateGridOf(resource, { external: false, guestDayRate });
  return {
    ...rateGridOf(resource, { external: true, period: 'week' }),
    weekend: rateGridOf(resource, { external: true, period: 'weekend' }),
    ...(period ? { period } : {}),
  };
}

/**
 * @param {object} p
 * @param {object} p.resource        the resource row (priceType, price, slotDuration, showsPlanningCard, hourly rates)
 * @param {string} p.startTime       'HH:MM'
 * @param {string} p.endTime         'HH:MM'
 * @param {{ price?: number, freeMinutes?: number }|null} p.override  the property's price row, when a property is set
 * @param {boolean} p.external       no lodging reservation → the external rate pair (rule 6)
 * @param {number} [p.offeredMinutes] already validated by `offeredRefusal`
 * @param {{ rate: number|null }|null} [p.vat] the rate that applies, `rate: null` when the instance has no VAT
 * @param {string|null} [p.date]    the booking's day: an outside booking is priced on its real date (week or weekend); none → the week grid
 * @param {boolean} [p.lodging] the booking carries a lodging (with or without a reservation): it is priced as origin/master priced it, on the week grid (K3, K9)
 * @param {boolean} [p.engineRated] the fact stored on the booking (`resource_bookings.engineRated`): an outside session with no lodging that was made or moved on the engine path is priced by it, whatever
 *   reads it; a row of before keeps the figure of its time. A draft, a new or a moved booking is engine rated.
 * @param {boolean} [p.judgeBands] false for a booking already stored (an invoice copies its figures): an outside band with no price is refused only when a booking is made or moved
 * @param {boolean} [p.freeHourAtDayRate] false for a booking stored before the one hourly grid: its free hour keeps the band it fell in
 */
function priceBookingLines({
  resource, startTime, endTime, override = null, external, offeredMinutes = 0, vat = null, freeHourAtDayRate = true, date = null, lodging = false, engineRated = true, judgeBands = true,
}) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const durationMinutes = Math.max(0, end - start);
  const guestDayRate = Number(override?.price ?? resource.price ?? 0);
  const freeMinutes = Math.max(0, Number(override?.freeMinutes || 0));
  const offered = Math.max(0, Number(offeredMinutes) || 0);
  const base = {
    total: 0, pricing: 'free', rateGrid: null, durationMinutes,
    freeMinutesApplied: 0, billedMinutes: 0, grossTotal: 0, bands: [], freeValue: 0,
    offeredMinutesApplied: 0, offeredValue: 0, lines: [], vat: vatOf(0, vat),
  };
  if (resource.priceType === 'free') return base;

  const finish = (priced) => {
    const total = Math.max(0, round2(priced.grossTotal - priced.freeValue - priced.offeredValue));
    const lines = priced.bands.map((band) => bandLineOf(band));
    if (priced.freeMinutesApplied > 0) {
      lines.push({ key: 'free', label: 'Offert par le logement', detail: duration(priced.freeMinutesApplied), amount: -priced.freeValue });
    }
    if (priced.offeredMinutesApplied > 0) {
      lines.push({ key: 'offered', label: 'Temps offert', detail: duration(priced.offeredMinutesApplied), amount: -priced.offeredValue });
    }
    return { ...base, ...priced, total, lines, vat: vatOf(total, vat) };
  };

  if (resource.priceType !== 'per_hour') {
    const total = round2(guestDayRate);
    return { ...base, total, pricing: 'fixed', grossTotal: total, lines: [{ key: 'fixed', label: 'Prix', detail: '', amount: total }], vat: vatOf(total, vat) };
  }

  const freeApplied = Math.min(durationMinutes, freeMinutes);
  const offeredApplied = Math.min(offered, Math.max(0, durationMinutes - freeApplied));

  // Hourly-scheduled resource: time-banded grid (specs/resources/resource-hourly-scheduling.md §3.5).
  if (Number(resource.showsPlanningCard || 0) === 1) {
    // A placed outside session (no lodging) made or moved now is priced by the engine core on its real date and period, any start and duration the planning allows, off the slot grid
    // included; an outside band with no price is refused, never priced 0 € nor at another rate (the caller turns `refusal` into the answer of the save or the preview). Every other
    // booking — a stay's, a lodging's with no stay, an outside one stored before the engine path — is priced as it always was.
    const engine = external && !lodging && engineRated;
    const unsold = engine && judgeBands ? unsoldSliceOf(resource, {
      date, period: 'week', fromMin: start, toMin: end,
    }) : null;
    if (unsold) return { ...base, refusal: notSoldSentence(resource, unsold.band, unsold.period) };
    const cfg = {
      ...(engine ? rateConfigOf(resource, { external, guestDayRate, period: date ? null : 'week' }) : legacyGridOf(resource, { external, guestDayRate })),
      eveningStart: resource.hourlyEveningStart,
      slotMinutes: resource.slotDuration,
      ...(engine ? { anyStart: true } : {}),
    };
    const sessionDate = engine && date ? date : '2000-01-01';
    // The free minutes are not a rank (specs/resources/hourly-extra-hour-rates.md rule 3): the gross counts the ranks from the first paid minute.
    const priced = priceSessions([{ date: sessionDate, start: startTime, end: endTime }], cfg, freeApplied);
    if (priced.validSessions.length) {
      const { freeValue, offeredValue } = bookingDeductions({
        start, end, freeApplied, offeredApplied, freeAtDayRate: freeHourAtDayRate, date: sessionDate,
      }, cfg);
      return finish({
        pricing: 'banded',
        rateGrid: external ? 'external' : 'guest',
        freeMinutesApplied: freeApplied,
        offeredMinutesApplied: offeredApplied,
        billedMinutes: durationMinutes - freeApplied - offeredApplied,
        grossTotal: priced.grossPrice,
        bands: priced.bands,
        freeValue,
        offeredValue,
      });
    }
    // an end that does not follow its start (a stored row, rule 23) or an off-grid range of a booking priced on the grid → the flat computation below.
  }

  const grossTotal = round2((guestDayRate * durationMinutes) / 60);
  return finish({
    pricing: 'flat-hourly',
    freeMinutesApplied: freeApplied,
    offeredMinutesApplied: offeredApplied,
    billedMinutes: durationMinutes - freeApplied - offeredApplied,
    grossTotal,
    bands: durationMinutes > 0
      ? [{ band: 'day', from: startTime, to: endTime, minutes: durationMinutes, rate: round2(guestDayRate), amount: grossTotal }]
      : [],
    freeValue: round2((guestDayRate * freeApplied) / 60),
    offeredValue: round2((guestDayRate * offeredApplied) / 60),
  });
}

module.exports = {
  priceBookingLines, offeredRefusal, vatOf, rateGridOf, legacyGridOf, rateConfigOf, bandLineOf, duration, unsoldSliceOf, notSoldSentence, OFFER_STEP_MINUTES,
};
