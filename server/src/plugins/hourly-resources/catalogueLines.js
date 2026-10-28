/**
 * What the hourly plugin adds to a resource's card on Options & ressources
 * (specs/options-resources-ux.md rule 19): the evening and external rates, the free first hour and a
 * footer that sums the schedule up. A resource not sold by the hour gets nothing. Pure.
 */

const euros = (amount) => {
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

const hourly = (amount) => `${euros(amount)} / h`;

function eveningLine(resource) {
  if (!resource.hourlyEveningStart || !(Number(resource.hourlyEveningRate) > 0)) return null;
  return { label: 'Soir', value: `${hourly(resource.hourlyEveningRate)} après ${resource.hourlyEveningStart}` };
}

function externalLine(resource) {
  const day = Number(resource.hourlyExternalDayRate) > 0 ? hourly(resource.hourlyExternalDayRate) : '';
  const evening = Number(resource.hourlyExternalEveningRate) > 0 ? `soir ${hourly(resource.hourlyExternalEveningRate)}` : '';
  const value = [day, evening].filter(Boolean).join(' · ');
  return value ? { label: 'Extérieurs', value } : null;
}

function freeHourLine(resource, properties) {
  const pricing = resource.propertyPricing || {};
  const free = properties.filter((p) => Number((pricing[String(p.id)] || {}).freeMinutes) > 0);
  if (free.length === 0) return null;
  const minutes = [...new Set(free.map((p) => Number(pricing[String(p.id)].freeMinutes)))];
  const what = minutes.length === 1 && minutes[0] === 60 ? '1re heure' : `${durationLabel(Math.min(...minutes))} offertes`;
  const where = free.length === properties.length ? 'tous les logements' : free.map((p) => p.name).join(', ');
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
    lines: [eveningLine(resource), externalLine(resource), freeHourLine(resource, properties)].filter(Boolean),
    footer: footer(resource),
  };
}

module.exports = { buildCatalogueLines };
