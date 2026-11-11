/**
 * The price of a resource booking, line by line (specs/resource-booking-pricing-and-invoicing.md rules 3-10).
 *
 * Pure: the caller resolves the resource, the property's price override and the VAT in force; this module returns the
 * whole breakdown the preview shows, the commit stores and the invoice copies. No DB, no clock.
 *
 * Order of the deductions (rule 7): the property's free minutes first, from the start of the slot, then the offered
 * minutes right after them, each priced on the band it falls in — the same slot walk as `priceSessions`.
 */

const sdk = require('../sdk');
const { priceSessions, priceRange, toMinutes } = require('./hourlyPricing');

const { netFirst } = sdk.coreModule('vat');

const OFFER_STEP_MINUTES = 15;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const euros = (value) => `${round2(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

const BAND_LABELS = { day: 'Jour', evening: 'Soir' };

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
  const { amount, net } = netFirst(total, rate);
  return { rate, amount, net };
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
 */
function priceBookingLines({ resource, startTime, endTime, override = null, external, offeredMinutes = 0, vat = null }) {
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
    const lines = priced.bands.map((b) => ({
      key: `band:${b.band}:${b.from}`,
      label: `${BAND_LABELS[b.band] || b.band} · ${b.from}–${b.to}`,
      detail: `${duration(b.minutes)} × ${euros(b.rate)}`,
      amount: b.amount,
    }));
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

  // Hourly-scheduled resource: time-banded grid (specs/resource-hourly-scheduling.md §3.5).
  if (Number(resource.showsPlanningCard || 0) === 1) {
    const guestEveningRate = Number(resource.hourlyEveningRate) || 0;
    const dayRate = external && Number(resource.hourlyExternalDayRate) > 0 ? Number(resource.hourlyExternalDayRate) : guestDayRate;
    const eveningRate = external
      ? (Number(resource.hourlyExternalEveningRate) > 0 ? Number(resource.hourlyExternalEveningRate) : (guestEveningRate > 0 ? guestEveningRate : dayRate))
      : guestEveningRate;
    const cfg = { dayRate, eveningRate, eveningStart: resource.hourlyEveningStart, slotMinutes: resource.slotDuration };
    const priced = priceSessions([{ date: '2000-01-01', start: startTime, end: endTime }], cfg, 0);
    if (priced.validSessions.length) {
      const freeValue = freeApplied > 0 ? priceRange(hhmm(start), hhmm(start + freeApplied), cfg) : 0;
      const offeredFrom = start + freeApplied;
      const offeredValue = offeredApplied > 0 ? priceRange(hhmm(offeredFrom), hhmm(offeredFrom + offeredApplied), cfg) : 0;
      return finish({
        pricing: 'banded',
        rateGrid: external ? 'external' : 'guest',
        freeMinutesApplied: freeApplied,
        offeredMinutesApplied: offeredApplied,
        billedMinutes: durationMinutes - freeApplied - offeredApplied,
        grossTotal: priced.grossPrice,
        bands: priced.bands,
        freeValue: round2(freeValue),
        offeredValue: round2(offeredValue),
      });
    }
    // off-grid range → the flat computation below.
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

module.exports = { priceBookingLines, offeredRefusal, vatOf, OFFER_STEP_MINUTES };
