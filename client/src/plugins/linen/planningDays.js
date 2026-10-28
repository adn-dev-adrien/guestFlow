// The laundry's contribution to the planning (specs/plugins-phase-2-hosts.md rule 5): for a window
// of dates, every laundry card to draw, keyed by date. The server decides which dates carry a card and
// shapes each one (specs/linen-laundry-days.md rule 13): nothing is summed, filtered or merged here.
import { api } from '../sdk';

/** `{ [date]: card }` for [from, to]; a card is `GET /api/planning/laundry/days`'s, untouched. */
export async function loadLaundryDays({ from, to }) {
  const { days } = await api.getLaundryPlanningDays({ from, to });
  return days || {};
}

export default loadLaundryDays;
