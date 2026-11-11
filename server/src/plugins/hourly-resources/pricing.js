/**
 * The `per_hour` price-line contributor (specs/plugins-phase-3c-hourly-resources.md rule 11).
 *
 * A resource that shows on the planning is sold by the hour and placed on real slots:
 *   - unsold, with sessions placed: priced from the time-banded grid (day and evening rates, minus the
 *     free minutes, applied once);
 *   - unsold without a valid session, or sold: priced as a plain quantity of hours by the engine —
 *     through the locked snapshot once sold, so placing the hours never re-prices it
 *     (specs/hourly-resource-quantity-and-sas-scheduling.md rules 30–31).
 * A `per_hour` resource that does not show on the planning is left to the engine (`null`).
 */

const { priceSessions, toMinutes } = require('./hourlyPricing');

const schedulable = (resource) => Number(resource.showsPlanningCard || 0) === 1;
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const hours = (value) => `${String(round2(value)).replace('.', ',')} h`;

// What the summary says under the line: nothing once every hour sold sits on a slot.
function detailOf(placed, sold) {
  if (sold <= 0 || placed >= sold) return undefined;
  if (placed <= 0) return 'À planifier';
  return `${hours(placed)} / ${hours(sold)} planifiées`;
}

function createHourlyContributor() {
  return {
    id: 'hourly-resources',
    priceTypes: ['per_hour'],
    priceLine({ resource, selected, sold }) {
      if (!schedulable(resource)) return null;
      const sessions = Array.isArray(selected && selected.sessions) ? selected.sessions : [];
      const declared = Math.max(0, Number(selected && selected.quantity) || 0);
      const priced = sessions.length > 0
        ? priceSessions(sessions, {
          dayRate: resource.price,
          eveningRate: resource.hourlyEveningRate,
          eveningStart: resource.hourlyEveningStart,
          slotMinutes: resource.slotDuration,
          openTime: resource.openTime,
          closeTime: resource.closeTime,
          minMinutes: resource.minimumUsageMinutes,
        }, resource.freeMinutes)
        : null;

      if (priced && priced.validSessions.length > 0) {
        const placed = priced.totalHours;
        const quantity = sold ? round2(Math.max(declared, placed)) : placed;
        const extra = { sessions: priced.validSessions, scheduledHours: placed, detail: detailOf(placed, quantity) };
        // Sold: the engine bills the sold hours through the lock; the sessions only say when.
        if (sold) return { quantity, extra };
        return {
          quantity,
          unitPrice: priced.unitPrice,
          billedUnits: priced.billedHours,
          totalPrice: priced.totalPrice,
          extra,
        };
      }

      // No usable session (none yet, or a resource reconfigured under a saved booking): the hours are
      // still what was sold — derived from the sessions when no quantity came with them.
      const quantity = declared > 0
        ? declared
        : round2(sessions.reduce((sum, s) => sum + Math.max(0, toMinutes(s && s.end) - toMinutes(s && s.start)), 0) / 60);
      return { quantity, extra: { scheduledHours: 0, detail: detailOf(0, quantity) } };
    },
  };
}

module.exports = { createHourlyContributor, detailOf };
