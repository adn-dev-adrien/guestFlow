/**
 * What the hourly plugin adds to a resource's card on Options & ressources
 * (specs/options-resources-ux.md rule 19): the evening, following-hours and external rates, the free first hour and a
 * footer that sums the schedule up. A resource not sold by the hour gets nothing. Pure.
 */

const { rateGridOf } = require('./bookingPricing');

const eurosText = (amount) => {
  const cents = Math.round(Number(amount || 0) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const rest = cents % 100;
  return `${whole}${rest ? `,${String(rest).padStart(2, '0')}` : ''} €`;
};

/** « 1 h », « 1 h 30 », « 45 min ». */
function durationLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total} min`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)} h ${String(rest).padStart(2, '0')}` : `${total / 60} h`;
}

const hourly = (amount) => `${eurosText(amount)} / h`;

function eveningLine(resource) {
  const guest = rateGridOf(resource, { external: false });
  if (!resource.hourlyEveningStart || !(guest.eveningRate > 0)) return null;
  return { label: 'Soir', value: `${hourly(guest.eveningRate)} après ${resource.hourlyEveningStart}` };
}

// specs/hourly-extra-hour-rates.md rule 6 — « puis X € / h » where the following hours cost something else than the first one. `null` stored = same as the first hour.
const differs = (next, first) => next !== null && Number.isFinite(next) && Math.round(next * 100) !== Math.round(Number(first) * 100);
const thenText = (next, first) => (differs(next, first) ? ` puis ${hourly(next)}` : '');

function nextHoursLine(resource) {
  const guest = rateGridOf(resource, { external: false });
  const evening = resource.hourlyEveningStart && guest.eveningRate > 0;
  const parts = [];
  if (differs(guest.dayNextRate, guest.dayRate)) parts.push(`${evening ? 'jour ' : ''}${hourly(guest.dayNextRate)}`);
  if (evening && differs(guest.eveningNextRate, guest.eveningRate)) parts.push(`soir ${hourly(guest.eveningNextRate)}`);
  return parts.length ? { label: 'Heures suivantes', value: parts.join(' · ') } : null;
}

// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 9, 30 — the outside grid as the one reader of the rate columns gives it: no fallback to the guests' rates, a week and a weekend set.
function externalPeriodText(resource, period) {
  const grid = rateGridOf(resource, { external: true, period });
  const day = grid.dayRate > 0 ? `${hourly(grid.dayRate)}${thenText(grid.dayNextRate, grid.dayRate)}` : '';
  const evening = grid.eveningRate > 0 ? `soir ${hourly(grid.eveningRate)}${thenText(grid.eveningNextRate, grid.eveningRate)}` : '';
  return [day, evening].filter(Boolean).join(' · ');
}

function externalLine(resource) {
  const week = externalPeriodText(resource, 'week');
  const weekend = externalPeriodText(resource, 'weekend');
  if (!week && !weekend) return null;
  const value = weekend && weekend !== week ? [week && `semaine ${week}`, `week-end ${weekend}`].filter(Boolean).join(' · ') : week;
  return { label: 'Extérieurs', value };
}

function freeHourLine(resource, properties) {
  const pricing = resource.propertyPricing || {};
  const scope = (resource.propertyIds || []).map(Number);
  const selling = scope.length === 0 ? properties : properties.filter((p) => scope.includes(Number(p.id)));
  const free = selling.filter((p) => Number((pricing[String(p.id)] || {}).freeMinutes) > 0);
  if (free.length === 0) return null;
  const minutes = [...new Set(free.map((p) => Number(pricing[String(p.id)].freeMinutes)))];
  const what = minutes.length === 1 && minutes[0] === 60 ? '1re heure' : `${durationLabel(Math.min(...minutes))} offertes`;
  const where = free.length === selling.length ? 'tous les logements' : free.map((p) => p.name).join(', ');
  return { label: 'Offert', value: `${what} · ${where}` };
}

function footer(resource) {
  const parts = ['À l’heure'];
  if (resource.isComplex) parts.push(`${resource.openTime}–${resource.closeTime}`);
  parts.push(`${durationLabel(resource.minimumUsageMinutes || 60)} minimum`);
  if (Number(resource.turnoverMinutes) > 0) parts.push(`remise en état ${durationLabel(resource.turnoverMinutes)}`);
  if (Number(resource.showsPlanningCard) === 1) parts.push('carte au planning');
  return parts.join(' · ');
}

function buildCatalogueLines(resource, { properties = [] } = {}) {
  if (!resource || resource.priceType !== 'per_hour') return null;
  return {
    lines: [eveningLine(resource), nextHoursLine(resource), externalLine(resource), freeHourLine(resource, properties)].filter(Boolean),
    footer: footer(resource),
  };
}

module.exports = { buildCatalogueLines };
