/** `guest_orders` — what the home needs of a stay's orders (specs/guest-app.md rule 11). */

const READY_MS = 60 * 60 * 1000;

function createOrdersModel(db) {
  return {
    /** Rule 11 — « Votre commande est prête »: an order marked delivered in the last hour. */
    deliveredRecently(reservationId, now) {
      const since = new Date(now.getTime() - READY_MS).toISOString();
      return Boolean(db.prepare(`
        SELECT 1 FROM guest_orders WHERE reservationId = ? AND status = 'delivered' AND deliveredAt >= ? AND deliveredAt <= ? LIMIT 1
      `).get(Number(reservationId), since, now.toISOString()));
    },
  };
}

module.exports = createOrdersModel;
