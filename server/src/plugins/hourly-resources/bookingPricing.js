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
  priceSessions, bookingDeductions, toMinutes, periodOf,
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

const BAND_WORDS = Object.freeze({ day: 'la journée', evening: 'la soirée' });

/** The sentence that says an outside band has no price: « Bain nordique » n’a pas de tarif extérieur pour la soirée le week-end. */
const notSoldSentence = (resource, band, period) => `« ${resource.name} » n’a pas de tarif extérieur pour ${BAND_WORDS[band]}${period === 'weekend' ? ' le week-end' : ''}.`;

/**
 * The first slice of [fromMin, toMin) that falls in an outside band with no first-hour price (a first hour that is 0 or empty is not sold: no fallback to another band, period
 * or the guests' rate), or null when every slice is sold. `date` gives each slice its own period; without it `period` applies to all. → `{ band, period }` | null.
 */
function unsoldSliceOf(resource, {
  date = null, period = 'week', fromMin, toMin,
}) {
  const eveningStart = resource.hourlyEveningStart ? toMinutes(resource.hourlyEveningStart) : null;
  const step = Math.max(1, Number(resource.slotDuration) || 30);
  const grids = { week: rateGridOf(resource, { external: true, period: 'week' }), weekend: rateGridOf(resource, { external: true, period: 'weekend' }) };
  for (let t = fromMin; t < toMin; t += step) {
    const at = date ? periodOf(date, t, eveningStart === null ? null : resource.hourlyEveningStart) : period;
    const band = eveningStart !== null && t >= eveningStart ? 'evening' : 'day';
    const rate = band === 'evening' ? grids[at].eveningRate : grids[at].dayRate;
    if (!(rate > 0)) return { band, period: at };
  }
  return null;
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
 * @param {boolean} [p.lodging] the booking carries a lodging (with or without a reservation): it is priced on the week grid, as before the weekend grid existed (K3)
 * @param {boolean} [p.judgeBands] false for a booking already stored (an invoice copies its figures): an outside band with no price is refused only when a booking is made or moved
 * @param {boolean} [p.freeHourAtDayRate] false for a booking stored before the one hourly grid: its free hour keeps the band it fell in
 */
function priceBookingLines({
  resource, startTime, endTime, override = null, external, offeredMinutes = 0, vat = null, freeHourAtDayRate = true, date = null, lodging = false, judgeBands = true,
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
    // An outside band with no price is refused, never priced 0 € nor at another rate (the caller turns `refusal` into the answer of the save or the preview).
    const unsold = external && judgeBands ? unsoldSliceOf(resource, {
      date, period: 'week', fromMin: start, toMin: end,
    }) : null;
    if (unsold) return { ...base, refusal: notSoldSentence(resource, unsold.band, unsold.period) };
    // A placed outside session (no lodging) made or moved now is priced on any start and duration the planning allows, off the slot grid included: no flat guests' rate stands in. A booking already stored keeps its stored figure.
    const outsideSession = external && !lodging && judgeBands;
    const cfg = {
      ...rateConfigOf(resource, { external, guestDayRate, period: date ? null : 'week' }),
      eveningStart: resource.hourlyEveningStart,
      slotMinutes: resource.slotDuration,
      ...(outsideSession ? { anyStart: true } : {}),
    };
    const sessionDate = date || '2000-01-01';
    // The free minutes are not a rank (specs/resources/hourly-extra-hour-rates.md rule 3): the gross counts the ranks from the first paid minute.
    const priced = priceSessions([{ date: sessionDate, start: startTime, end: endTime }], cfg, freeApplied);
    if (priced.validSessions.length) {
      const { freeValue, offeredValue } = bookingDeductions({
        start, freeApplied, offeredApplied, freeAtDayRate: freeHourAtDayRate, date: sessionDate,
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
    if (outsideSession) return finish({ pricing: 'banded', rateGrid: 'external' });
    // off-grid range of a guest or a lodging → the flat computation below.
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
  priceBookingLines, offeredRefusal, vatOf, rateGridOf, rateConfigOf, bandLineOf, duration, unsoldSliceOf, notSoldSentence, OFFER_STEP_MINUTES,
};
