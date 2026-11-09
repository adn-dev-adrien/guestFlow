/**
 * `guest_orders` (specs/guest-app.md §5) — a stay's orders and their lifecycle (rules 33-38, 43-45), what the home
 * and the shop read of them (rules 11, 25), and the hourly slots the unpaid card orders hold (rule 35).
 *
 * Statuses: `awaiting_payment` (card, holding its slots until `heldUntil`) → `paid` | `expired` | `abandoned` |
 * `paid_conflict`; a late payment moves `expired` / `abandoned` on to `paid` or `paid_conflict`; `confirmed` (note or
 * 0 €) and `paid` → `delivered`. Every move is conditional on the status it leaves, so a webhook, the order page's
 * read and the expiry pass can race without a double move.
 */

const READY_MS = 60 * 60 * 1000;

const STANDING = Object.freeze(['awaiting_payment', 'confirmed', 'paid', 'delivered']);
// Rule 38 — what the staff prepares: an order on the fiche, not yet delivered.
const TO_PREPARE = Object.freeze(['confirmed', 'paid']);

function parseLines(text) {
  try {
    const lines = JSON.parse(text);
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

const toOrder = (row) => (row ? { ...row, lines: parseLines(row.linesJson) } : null);

function createOrdersModel(db) {
  function linesOf(reservationId, statuses) {
    return db.prepare(`SELECT linesJson FROM guest_orders WHERE reservationId = ? AND status IN (${statuses.map(() => '?').join(', ')})`)
      .all(Number(reservationId), ...statuses)
      .flatMap((row) => parseLines(row.linesJson));
  }

  const findById = (id) => toOrder(db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(Number(id)));

  /** Moves an order from one of `from` to `status`, with the columns given; → the order, or null when it had moved on. */
  function move(id, from, status, columns = {}) {
    const sets = Object.keys(columns).map((c) => `${c} = @${c}`);
    const info = db.prepare(`
      UPDATE guest_orders SET status = @status${sets.length ? `, ${sets.join(', ')}` : ''}
       WHERE id = @id AND status IN (${from.map((_, i) => `@from${i}`).join(', ')})
    `).run({ id: Number(id), status, ...columns, ...Object.fromEntries(from.map((f, i) => [`from${i}`, f])) });
    return Number(info.changes) > 0 ? findById(id) : null;
  }

  return {
    findById,

    /** Rule 33 — a new order: `lines` is the priced snapshot (sessions, mornings and amounts included). */
    create({
      reservationId, sessionId, payment, status, lines, total, deliverAt = null, heldUntil = null, fulfilment = 'delivery', pickupPlace = null, now,
    }) {
      const at = now.toISOString();
      // Rule 41bis — the mode and the place are the order's own: a later change of the setting rewrites no order.
      const info = db.prepare(`
        INSERT INTO guest_orders (reservationId, sessionId, payment, status, linesJson, total, deliverAt, heldUntil, fulfilment, pickupPlace, createdAt, confirmedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(Number(reservationId), sessionId == null ? null : Number(sessionId), payment, status, JSON.stringify(lines), Number(total),
        deliverAt, heldUntil, fulfilment === 'pickup' ? 'pickup' : 'delivery', fulfilment === 'pickup' ? pickupPlace : null, at, status === 'confirmed' ? at : null);
      return findById(info.lastInsertRowid);
    },

    setPaymentLink(id, linkId) {
      db.prepare('UPDATE guest_orders SET paymentLinkId = ? WHERE id = ?').run(Number(linkId), Number(id));
      return findById(id);
    },

    /** Rule 38 — the stay's orders, every session's, newest first. */
    listForStay(reservationId) {
      return db.prepare('SELECT * FROM guest_orders WHERE reservationId = ? ORDER BY id DESC').all(Number(reservationId)).map(toOrder);
    },

    /**
     * Rule 45 — the orders list of GuestFlow, by delivery time (an order without one at its creation): every order
     * with `all`, else the ones to prepare. `from` (ISO instant) keeps the list to what is still relevant.
     */
    listForStaff({ all = false, from = null } = {}) {
      const where = [];
      const params = [];
      if (!all) {
        where.push(`status IN (${TO_PREPARE.map(() => '?').join(', ')})`);
        params.push(...TO_PREPARE);
      }
      if (from) {
        where.push('COALESCE(deliverAt, createdAt) >= ?');
        params.push(from);
      }
      return db.prepare(`
        SELECT * FROM guest_orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY COALESCE(deliverAt, createdAt), id LIMIT 500
      `).all(...params).map(toOrder);
    },

    /** Rule 43 — the orders that stand, delivered between two instants (the planning's days). */
    deliveriesBetween(fromIso, toIso) {
      return db.prepare(`
        SELECT * FROM guest_orders WHERE deliverAt >= ? AND deliverAt < ? AND status IN ('confirmed', 'paid', 'delivered')
         ORDER BY deliverAt, id
      `).all(fromIso, toIso).map(toOrder);
    },

    markPaid(id, { now, paidAt, deliverAt, deliverMoved }) {
      return move(id, ['awaiting_payment', 'expired', 'abandoned'], 'paid', {
        paidAt: paidAt || now.toISOString(), confirmedAt: now.toISOString(), heldUntil: null, deliverAt, deliverMoved: deliverMoved ? 1 : 0,
      });
    },
    /** Rule 36 — paid, but its slots were taken: nothing reached the fiche, the money is to refund. */
    markPaidConflict(id, { now, paidAt }) {
      return move(id, ['awaiting_payment', 'expired', 'abandoned'], 'paid_conflict', { paidAt: paidAt || now.toISOString(), heldUntil: null, closedAt: now.toISOString() });
    },
    /** Rule 36 — no link could be minted: the order never held a payable slot. */
    markFailed(id, now) {
      return move(id, ['awaiting_payment'], 'expired', { heldUntil: null, closedAt: now.toISOString() });
    },
    /** Rule 35 — the guest gave up the card payment: the holds go at once. */
    markAbandoned(id, now) {
      return move(id, ['awaiting_payment'], 'abandoned', { heldUntil: null, closedAt: now.toISOString() });
    },
    /** Rule 36 — unpaid 30 minutes on: expired, holds released. → the orders it moved. */
    expireDue(now) {
      const due = db.prepare("SELECT id FROM guest_orders WHERE status = 'awaiting_payment' AND heldUntil IS NOT NULL AND heldUntil <= ?")
        .all(now.toISOString());
      return due.map(({ id }) => move(id, ['awaiting_payment'], 'expired', { heldUntil: null, closedAt: now.toISOString() })).filter(Boolean);
    },
    /** Rule 45 — « Marquer livrée ». */
    markDelivered(id, { now, userId }) {
      return move(id, TO_PREPARE, 'delivered', { deliveredAt: now.toISOString(), deliveredBy: userId == null ? null : Number(userId) });
    },

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
     * expired, abandoned or conflicting one never reaches it.
     */
    pendingLines(reservationId) {
      return linesOf(reservationId, ['awaiting_payment']);
    },

    /** Rule 25 — the lines of every order that stands (an expired, abandoned or conflicting one sold nothing). */
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
        .flatMap((row) => parseLines(row.linesJson)
          .filter((line) => line && line.kind === 'resource' && Number(line.id) === Number(resourceId) && Array.isArray(line.sessions))
          .flatMap((line) => line.sessions)
          .filter((s) => s && typeof s.date === 'string' && s.date >= from && s.date <= to)
          .map((s) => ({ date: s.date, start: s.start, end: s.end, reservationId: Number(row.reservationId) })));
    },
  };
}

module.exports = createOrdersModel;
