// The « Commande client » cards of the planning (specs/guest-app.md rule 43): for a window of dates, one timed card
// per order on the day of its delivery time, ready to render (`GET /api/guest-app/planning/order-cards`).
import guestAppApi from './guestAppApi';

/** `{ [date]: [{ key, time, item }] }` for [from, to]. */
export async function loadOrderDays({ from, to }) {
  const body = await guestAppApi.getOrderCards(from, to);
  const out = {};
  ((body && body.days) || []).forEach((day) => {
    out[day.date] = (day.cards || []).map((card) => ({ key: `order-${card.orderId}`, time: card.time, item: card }));
  });
  return out;
}

export { countOrderTasks } from './planningOrderTasks';
