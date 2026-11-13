/**
 * `guest_orders` (specs/guest-app.md §5) — a stay's orders and their lifecycle (rules 33-38, 43-45), what the home
 * and the shop read of them (rules 11, 25). An unpaid card order is a technical record that matches the incoming payment: it reserves nothing and
 * the staff never sees it (rule 35).
 *
 * Statuses: `awaiting_payment` (card, its link living until `heldUntil`) → `paid` | `expired` | `abandoned` |
 * `paid_conflict`; a late payment moves `expired` / `abandoned` on to `paid` or `paid_conflict`; `confirmed` (note or
 * 0 €) and `paid` → `delivered`; an order of a cancelled stay, or one emptied at the arrival SAS, is `cancelled`
 * (rules 72, 87). Every move is conditional on the status it leaves, so a webhook, the order page's
 * read and the expiry pass can race without a double move.
 */

const READY_MS = 60 * 60 * 1000;

// Rule 35 — an order awaiting its card payment stands for nothing: only the orders on the fiche count.
const STANDING = Object.freeze(['confirmed', 'paid', 'delivered']);
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
      reservationId, sessionId, payment, status, lines, total, deliverAt = null, heldUntil = null, fulfilment = 'delivery', pickupPlace = null,
      clientKey = null, collectAt = 'departure', now,
    }) {
      const at = now.toISOString();
      // Rule 41bis — the mode and the place are the order's own: a later change of the setting rewrites no order.
      const info = db.prepare(`
        INSERT INTO guest_orders (reservationId, sessionId, payment, status, linesJson, total, deliverAt, heldUntil, fulfilment, pickupPlace, createdAt, confirmedAt, clientKey, collectAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(Number(reservationId), sessionId == null ? null : Number(sessionId), payment, status, JSON.stringify(lines), Number(total),
        deliverAt, heldUntil, fulfilment === 'pickup' ? 'pickup' : 'delivery', fulfilment === 'pickup' ? pickupPlace : null, at, status === 'confirmed' ? at : null,
        clientKey || null, collectAt === 'arrival' ? 'arrival' : 'departure');
      return findById(info.lastInsertRowid);
    },

    /** Rule 66 — the core says where the order it just wrote is collected. */
    setCollectAt(id, collectAt) {
      db.prepare('UPDATE guest_orders SET collectAt = ? WHERE id = ?').run(collectAt === 'arrival' ? 'arrival' : 'departure', Number(id));
    },

    /**
     * Rules 71, 87 — the stay's orders taken before the arrival, which the arrival SAS names: on the note (unpaid, to collect)
     * or paid by card (read-only), standing and not cancelled; oldest first.
     */
    atArrivalFor(reservationId) {
      return db.prepare("SELECT * FROM guest_orders WHERE reservationId = ? AND collectAt = 'arrival' AND status IN ('confirmed', 'paid', 'delivered') ORDER BY id")
        .all(Number(reservationId)).map(toOrder);
    },

    /**
     * Rule 72 — a stay cancelled, superseded or deleted cancels its orders: every one not already `expired`, `abandoned` or
     * `cancelled`. → the orders it moved, as they were (their payment, lines and status before).
     */
    cancelForStay(reservationId, { now, reason = 'stay' }) {
      const rows = db.prepare("SELECT * FROM guest_orders WHERE reservationId = ? AND status IN ('awaiting_payment', 'confirmed', 'paid', 'delivered', 'paid_conflict')")
        .all(Number(reservationId)).map(toOrder);
      const moved = rows.filter((order) => move(order.id, [order.status], 'cancelled', {
        cancelledAt: now.toISOString(), cancelReason: reason, heldUntil: null, closedAt: now.toISOString(),
      }));
      return moved;
    },

    /**
     * Rule 87 — an unpaid order changed at the arrival SAS: its snapshot and total rewritten, its amendment journaled; an
     * order left with no line is `cancelled` (`cancelReason = 'sas'`). Only an order still on the note and standing moves.
     */
    amend(id, { lines, total, entry, now }) {
      const order = findById(id);
      if (!order || !['note', 'none'].includes(order.payment) || !['confirmed', 'delivered'].includes(order.status)) return null;
      const journal = (() => { try { const list = JSON.parse(order.amendmentsJson || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } })();
      journal.push(entry);
      const emptied = !lines.length;
      db.prepare(`UPDATE guest_orders SET linesJson = ?, total = ?, amendmentsJson = ?,
                         status = CASE WHEN ? THEN 'cancelled' ELSE status END,
                         cancelledAt = CASE WHEN ? THEN ? ELSE cancelledAt END,
                         cancelReason = CASE WHEN ? THEN 'sas' ELSE cancelReason END
                   WHERE id = ?`)
        .run(JSON.stringify(lines), Number(total), JSON.stringify(journal), emptied ? 1 : 0, emptied ? 1 : 0, now.toISOString(), emptied ? 1 : 0, Number(id));
      return findById(id);
    },

    /** §4.3 — the order a session already created under this `Idempotency-Key`, or null. */
    findByClientKey(sessionId, clientKey) {
      if (sessionId == null || !clientKey) return null;
      return toOrder(db.prepare('SELECT * FROM guest_orders WHERE sessionId = ? AND clientKey = ?').get(Number(sessionId), String(clientKey)));
    },

    /**
     * Rule 35 — what an order was quoted beyond what its commit added to the fiche, because a card order awaiting its
     * payment held the free units or minutes (rule 25): that card order's commit will add it, and may use it.
     */
    setDeferred(id, cents) {
      db.prepare('UPDATE guest_orders SET deferredCents = ? WHERE id = ?').run(Math.max(0, Math.round(Number(cents) || 0)), Number(id));
    },

    /**
     * Rule 35 — the deferred amounts a paid card order may take: the stay's orders on the fiche, committed while it
     * awaited its payment. `take(cents)` uses them oldest first. → { available, take }.
     */
    deferredFor(order) {
      const rows = db.prepare(`
        SELECT id, deferredCents FROM guest_orders
         WHERE reservationId = ? AND id <> ? AND deferredCents > 0 AND status IN ('confirmed', 'paid', 'delivered') AND confirmedAt >= ?
         ORDER BY id
      `).all(Number(order.reservationId), Number(order.id), String(order.createdAt));
      const available = rows.reduce((sum, r) => sum + Number(r.deferredCents), 0);
      const take = (cents) => {
        let left = cents;
        rows.forEach((r) => {
          if (left <= 0) return;
          const used = Math.min(left, Number(r.deferredCents));
          db.prepare('UPDATE guest_orders SET deferredCents = deferredCents - ? WHERE id = ?').run(used, r.id);
          left -= used;
        });
      };
      return { available, take };
    },

    setPaymentLink(id, linkId, url = null) {
      db.prepare('UPDATE guest_orders SET paymentLinkId = ?, paymentUrl = ? WHERE id = ?').run(Number(linkId), url || null, Number(id));
      return findById(id);
    },

    /** Rule 38 — the stay's orders, every session's, newest first. */
    listForStay(reservationId) {
      return db.prepare('SELECT * FROM guest_orders WHERE reservationId = ? ORDER BY id DESC').all(Number(reservationId)).map(toOrder);
    },

    /**
     * Rule 45 — the orders list of GuestFlow, by delivery time (an order without one at its creation): every order
     * with `all`, else the ones to prepare. `from` (ISO instant) keeps the list to what is still relevant; `today`
     * (Paris date) keeps « À préparer » to the stays not ended yet: an order of a stay gone is no longer prepared.
     */
    listForStaff({ all = false, from = null, today = null } = {}) {
      const where = [];
      const params = [];
      // Rule 35 — an order never paid is no order for the staff: unpaid, expired, abandoned, or cancelled before any payment.
      where.push("o.status NOT IN ('awaiting_payment', 'expired', 'abandoned')");
      where.push("NOT (o.status = 'cancelled' AND o.payment = 'card' AND o.paidAt IS NULL)");
      if (!all) {
        where.push(`o.status IN (${TO_PREPARE.map(() => '?').join(', ')})`);
        params.push(...TO_PREPARE);
        // Rule 72 — an order of a cancelled, superseded or deleted stay is no longer prepared.
        where.push("r.kind = 'reservation'");
        if (today) {
          where.push('r.endDate >= ?');
          params.push(today);
        }
      }
      if (from) {
        where.push('COALESCE(o.deliverAt, o.createdAt) >= ?');
        params.push(from);
      }
      return db.prepare(`
        SELECT o.* FROM guest_orders o LEFT JOIN reservations r ON r.id = o.reservationId
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY COALESCE(o.deliverAt, o.createdAt), o.id LIMIT 500
      `).all(...params).map(toOrder);
    },

    /** Rule 43 — the orders that stand, delivered between two instants (the planning's days). */
    deliveriesBetween(fromIso, toIso) {
      // Rule 72 — a cancelled stay's orders leave the planning.
      return db.prepare(`
        SELECT o.* FROM guest_orders o JOIN reservations r ON r.id = o.reservationId
         WHERE o.deliverAt >= ? AND o.deliverAt < ? AND o.status IN ('confirmed', 'paid', 'delivered') AND r.kind = 'reservation'
         ORDER BY o.deliverAt, o.id
      `).all(fromIso, toIso).map(toOrder);
    },

    /** Rule 35 — an abandoned order's lines went back to the cart: its payment is a conflict, never a commit. */
    markPaid(id, { now, paidAt, deliverAt, deliverMoved }) {
      return move(id, ['awaiting_payment', 'expired'], 'paid', {
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
    /** Rule 35 — the guest gave up the card payment: its lines go back in the cart. */
    markAbandoned(id, now) {
      return move(id, ['awaiting_payment'], 'abandoned', { heldUntil: null, closedAt: now.toISOString() });
    },
    /** Rule 36 — unpaid 30 minutes on: expired. → the orders it moved. */
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

    /** Rule 25 — the lines of every order that stands (an expired, abandoned or conflicting one sold nothing). */
    orderedLines(reservationId) {
      return linesOf(reservationId, STANDING);
    },
  };
}

module.exports = createOrdersModel;
