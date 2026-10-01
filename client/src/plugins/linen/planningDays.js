// The laundry's contribution to the planning (specs/plugins-phase-2-hosts.md rule 5): for a window
// of dates, every laundry card to draw, keyed by date, with what the card and its dialogs need.
import { api } from '../sdk';

const sum = (side) => (side
  ? Number(side.singleBeds || 0) + Number(side.doubleBeds || 0) + Number(side.babyBeds || 0)
    + Number(side.largeTowels || 0) + Number(side.mediumTowels || 0) + Number(side.smallTowels || 0)
  : 0);

// A laundry day is drawn when it carries linen on either side, when it is an extra trip
// (specs/laundry-extra-trip.md §3.5 rule 19), or when a stay declares linen without a quantity yet
// (specs/laundry-counts-explicit-option-only.md §3.2). A skipped trip is always drawn, so the
// operator can revert it (specs/skip-laundry-trip.md §3.3 rule 11).
const isShown = (day) => day.kind === 'extra'
  || sum(day.dropOff) + sum(day.pickUp) > 0
  || (day.dropOff?.incomplete?.length || 0) > 0;

/** `{ [date]: { data, inventoryAfter, isSkipped, manualAddition, extraTrip } }` for [from, to]. */
export async function loadLaundryDays({ from, to }) {
  const [summary, inventory, skips, additions, extras] = await Promise.all([
    api.getLaundryPlanningSummary({ from, to }),
    api.getLinenInventory(),
    api.listLaundrySkips(),
    api.getLaundryManualAdditions(),
    api.getLaundryExtraTrips(),
  ]);
  const skipped = new Set(skips?.skips || []);
  const byDate = Object.fromEntries((summary?.laundryDays || []).map((day) => [day.date, day]));
  const tripByDate = Object.fromEntries((extras?.trips || []).map((trip) => [trip.date, trip]));
  const dates = new Set([
    ...Object.values(byDate).filter(isShown).map((day) => day.date),
    ...[...skipped].filter((date) => date >= from && date <= to),
  ]);
  const out = {};
  dates.forEach((date) => {
    out[date] = {
      data: byDate[date] || { dropOff: {}, pickUp: {} },
      inventoryAfter: inventory?.byLaundryDay?.[date],
      isSkipped: skipped.has(date),
      manualAddition: additions?.additions?.[date],
      extraTrip: tripByDate[date] || null,
    };
  });
  return out;
}

export default loadLaundryDays;
