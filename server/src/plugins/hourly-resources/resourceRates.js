/**
 * The checks of the price grids of an hourly resource, run by the core's resource save through `ctx.resourceValidator`
 * (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 1, 2, 28; amends specs/resources/hourly-extra-hour-rates.md rule 5).
 *
 * Every price is required and explicit — no field falls back to another: the guests' grid always, the outside grid (week and weekend) when the resource is sold
 * outside a stay. A guests' price is a number from 0 to 10 000 with at most two decimals, a price of the outside grid a number above 0 (to stop selling outside, switch « Vendable hors séjour » off); a guests' value the resource already holds, sent back unchanged, is not judged again. The judgement is on the stored resource under the payload.
 * Pure: no DB, no clock. `[{ field, message }]`, empty when acceptable.
 */

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const isOn = (value) => value === 1 || value === true || value === '1';

const GUEST = [
  ['price', 'logés', 'journée, 1re heure'],
  ['hourlyNextDayRate', 'logés', 'journée, heures suivantes'],
  ['hourlyEveningRate', 'logés', 'soirée, 1re heure', 'evening'],
  ['hourlyNextEveningRate', 'logés', 'soirée, heures suivantes', 'evening'],
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

const refusedAmount = (raw, stored, { positive = false } = {}) => {
  const value = amountOf(raw);
  if (!Number.isFinite(value)) return true;
  if (positive && !(value > 0)) return true;
  if (stored !== undefined && stored !== null && Number(stored) === value) return false;
  return value < 0 || value > 10000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6;
};

// What the save will hold is the stored resource under the payload: a partial save is judged on the whole, never on the keys it happens to carry.
function validateHourlyRates(body, stored = null) {
  const payload = { ...(stored || {}), ...(body || {}) };
  if (payload.priceType !== 'per_hour' || !isOn(payload.showsPlanningCard)) return [];
  const evening = Boolean(payload.hourlyEveningStart);
  const sold = isOn(payload.sellableExternally);
  const details = [];
  const check = (field, audience, where, band, positive) => {
    if (band === 'evening' && !evening) return;
    const raw = payload[field];
    if (isBlank(raw) || refusedAmount(raw, stored && stored[field], { positive })) {
      details.push({ field, message: `Le tarif ${audience} (${where}) doit être un montant positif.` });
    }
  };
  // Rule 5 — a resource sold by the hour on the planning has one grid: a price per lodging is no longer a thing (its free minutes are).
  const NO_LODGING_PRICE = 'Une ressource à l’heure n’a pas de prix par logement : sa grille de tarifs s’applique.';
  Object.entries((body && body.propertyPricing) || {}).forEach(([pid, line]) => {
    if (line && !isBlank(line.price)) details.push({ field: `propertyPricing.${pid}`, message: NO_LODGING_PRICE });
  });
  // The older shape of the same thing (`propertyPrices: { <propertyId>: price }`) is refused alike.
  Object.entries((body && body.propertyPrices) || {}).forEach(([pid, price]) => {
    if (!isBlank(price)) details.push({ field: `propertyPrices.${pid}`, message: NO_LODGING_PRICE });
  });
  GUEST.forEach(([field, audience, where, band]) => check(field, audience, where, band, false));
  // K2 — every field of the outside grid is a price above 0 when the resource is sold outside; to stop selling outside, switch « Vendable hors séjour » off.
  if (sold) OUTSIDE.forEach(([field, where, band]) => check(field, 'extérieurs', where, band, true));
  return details;
}

module.exports = { validateHourlyRates, GUEST_RATE_FIELDS: GUEST.map(([field]) => field), OUTSIDE_RATE_FIELDS: OUTSIDE.map(([field]) => field) };
