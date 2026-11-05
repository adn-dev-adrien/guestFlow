/**
 * `guest_orders` — what the home and the shop need of a stay's orders (specs/guest-app.md rules 11, 25), and the
 * hourly slots the unpaid card orders hold (rule 35).
 */

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

    /**
     * Rule 35 — the sessions of `resourceId` between `from` and `to` that an order awaiting payment still holds
     * at `now` (`heldUntil` not passed): `[{ date, start, end, reservationId }]`, the `ctx.resourceHolds` source.
     */
    heldSessions({ resourceId, from, to, now }) {
      return db.prepare("SELECT reservationId, linesJson FROM guest_orders WHERE status = 'awaiting_payment' AND heldUntil > ?")
        .all(now.toISOString())
        .flatMap((row) => {
          let lines;
          try { lines = JSON.parse(row.linesJson); } catch { return []; }
          return (Array.isArray(lines) ? lines : [])
            .filter((line) => line && line.kind === 'resource' && Number(line.id) === Number(resourceId) && Array.isArray(line.sessions))
            .flatMap((line) => line.sessions)
            .filter((s) => s && typeof s.date === 'string' && s.date >= from && s.date <= to)
            .map((s) => ({ date: s.date, start: s.start, end: s.end, reservationId: Number(row.reservationId) }));
        });
    },
  };
}

module.exports = createOrdersModel;
