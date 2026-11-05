/** `guest_orders` — what the home and the shop need of a stay's orders (specs/guest-app.md rules 11, 25). */

const READY_MS = 60 * 60 * 1000;

const STANDING = Object.freeze(['awaiting_payment', 'confirmed', 'paid', 'delivered']);

function createOrdersModel(db) {
  function linesOf(reservationId, statuses) {
    return db.prepare(`SELECT linesJson FROM guest_orders WHERE reservationId = ? AND status IN (${statuses.map(() => '?').join(', ')})`)
      .all(Number(reservationId), ...statuses)
      .flatMap((row) => {
        try {
          const lines = JSON.parse(row.linesJson);
          return Array.isArray(lines) ? lines : [];
        } catch {
          return [];
        }
      });
  }

  return {
    /** Rule 11 — « Votre commande est prête »: an order marked delivered in the last hour. */
    deliveredRecently(reservationId, now) {
      const since = new Date(now.getTime() - READY_MS).toISOString();
      return Boolean(db.prepare(`
        SELECT 1 FROM guest_orders WHERE reservationId = ? AND status = 'delivered' AND deliveredAt >= ? AND deliveredAt <= ? LIMIT 1
      `).get(Number(reservationId), since, now.toISOString()));
    },

    /**
     * Rule 25 — the lines of the orders not on the fiche yet: an order awaiting payment will consume the
     * free units once paid. A confirmed, paid or delivered order is on the fiche already (rule 34), an
     * expired one or a conflict never reaches it.
     */
    pendingLines(reservationId) {
      return linesOf(reservationId, ['awaiting_payment']);
    },

    /** Rule 25 — the lines of every order that stands (an expired one or a conflict sold nothing). */
    orderedLines(reservationId) {
      return linesOf(reservationId, STANDING);
    },
  };
}

module.exports = createOrdersModel;
