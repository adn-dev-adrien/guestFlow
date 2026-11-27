/**
 * The checks of the price grids of an hourly resource, run by the core's resource save through `ctx.resourceValidator`
 * (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 1, 2, 28; amends specs/resources/hourly-extra-hour-rates.md rule 5).
 *
 * Every price is required and explicit — no field falls back to another: the guests' grid always, the outside grid (week and weekend) when the resource is sold
 * outside a stay. A price is a number from 0 to 10 000 with at most two decimals; a value the resource already holds, sent back unchanged, is not judged again.
 * Pure: no DB, no clock. `[{ field, message }]`, empty when acceptable.
 */

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const isOn = (value) => value === 1 || value === true || value === '1';

const GUEST = [
  ['price', 'hébergés', 'journée, 1re heure'],
  ['hourlyNextDayRate', 'hébergés', 'journée, heures suivantes'],
  ['hourlyEveningRate', 'hébergés', 'soirée, 1re heure', 'evening'],
  ['hourlyNextEveningRate', 'hébergés', 'soirée, heures suivantes', 'evening'],
];
const OUTSIDE = [
  ['hourlyExternalDayRate', 'semaine, journée, 1re heure'],
  ['hourlyExternalNextDayRate', 'semaine, journée, heures suivantes'],
  ['hourlyExternalEveningRate', 'semaine, soirée, 1re heure', 'evening'],
  ['hourlyExternalNextEveningRate', 'semaine, soirée, heures suivantes', 'evening'],
  ['hourlyExternalWeekendDayRate', 'week-end, journée, 1re heure'],
  ['hourlyExternalWeekendNextDayRate', 'week-end, journée, heures suivantes'],
  ['hourlyExternalWeekendEveningRate', 'week-end, soirée, 1re heure', 'evening'],
  ['hourlyExternalWeekendNextEveningRate', 'week-end, soirée, heures suivantes', 'evening'],
];

// The server's reading of a typed amount: a number, or a text of digits with a comma or a dot.
function amountOf(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+([.,]\d+)?$/.test(raw.trim())) return Number(raw.trim().replace(',', '.'));
  return NaN;
}

const refusedAmount = (raw, stored) => {
  const value = amountOf(raw);
  if (!Number.isFinite(value)) return true;
  if (stored !== undefined && stored !== null && Number(stored) === value) return false;
  return value < 0 || value > 10000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6;
};

function validateHourlyRates(body, stored = null) {
  const payload = body || {};
  if (payload.priceType !== 'per_hour' || !isOn(payload.showsPlanningCard)) return [];
  const evening = Boolean(payload.hourlyEveningStart);
  const sold = isOn(payload.sellableExternally);
  const details = [];
  const check = (field, audience, where, band) => {
    if (band === 'evening' && !evening) return;
    const raw = payload[field];
    if (isBlank(raw) ? !(stored && !isBlank(stored[field]) && raw === undefined) : refusedAmount(raw, stored && stored[field])) {
      details.push({ field, message: `Le tarif ${audience} (${where}) doit être un montant positif.` });
    }
  };
  GUEST.forEach(([field, audience, where, band]) => check(field, audience, where, band));
  if (sold) OUTSIDE.forEach(([field, where, band]) => check(field, 'extérieurs', where, band));
  return details;
}

module.exports = { validateHourlyRates, GUEST_RATE_FIELDS: GUEST.map(([field]) => field), OUTSIDE_RATE_FIELDS: OUTSIDE.map(([field]) => field) };
