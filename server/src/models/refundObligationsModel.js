/**
 * Refund obligations model — sole DB access for `refund_obligations` (specs/pricing-components.md §3 rule 75).
 *
 * The register of money that must leave and has not yet: a basket the plugin could not honour, a link paid twice, a payment
 * received on a withdrawn link, a paid line the operator lowered, money received for a stay that was never booked. It holds money
 * that LEFT (or must leave) only — never a sale. Factory `buildModel(db)` + a default bound to the production database.
 *
 *   open(input)               → the new row (status `open`); `amountCents` > 0
 *   openThenSettle(input, by) → the same, closed at once: money the provider already refunded (`settledBy` 'provider')
 *   listFor(reservationId, { status }) / findById(id)
 *   openFor(reservationId)    → the open rows, oldest first
 *   openAmountFor(reservationId, origin) → Σ cents of the open rows of one origin
 *   close(id, { status, by, now }) → the closed row, or null when it is not open
 */
const ORIGINS = ['basket', 'duplicatePayment', 'withdrawnLink', 'lineLowered', 'orderConflict', 'neverBooked'];
const CLOSED = ['settled', 'cancelled'];

function buildModel(database) {
  const ready = () => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refund_obligations'").get());
  const findById = (id) => database.prepare('SELECT * FROM refund_obligations WHERE id = ?').get(Number(id));

  function open({ reservationId, origin, paymentLinkId = null, lineRef = null, amountCents, reason = null }) {
    if (!ready()) return null;
    if (!ORIGINS.includes(origin)) throw new Error(`refund obligation: unknown origin « ${origin} »`);
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('refund obligation: the amount must be a positive number of cents');
    const info = database.prepare(`INSERT INTO refund_obligations (reservationId, origin, paymentLinkId, lineRef, amountCents, reason)
      VALUES (?, ?, ?, ?, ?, ?)`).run(Number(reservationId), origin, paymentLinkId == null ? null : Number(paymentLinkId), lineRef, amountCents, reason);
    return findById(info.lastInsertRowid);
  }

  function close(id, { status = 'settled', by = 'operator', now = null } = {}) {
    if (!CLOSED.includes(status)) throw new Error(`refund obligation: unknown closing status « ${status} »`);
    const info = database.prepare(`UPDATE refund_obligations SET status = ?, settledAt = COALESCE(?, datetime('now')), settledBy = ?
      WHERE id = ? AND status = 'open'`).run(status, now, by, Number(id));
    return info.changes > 0 ? findById(id) : null;
  }

  // The open `lineLowered` rows are the trop-perçu the operator confirmed when a paid line was lowered (rule 23). `wantedCents` is
  // what that excess is now: more opens the difference, less cancels the newest rows and shrinks the next (it is no longer owed).
  function trimLowered(reservationId, wantedCents) {
    if (!ready()) return;
    const rows = database.prepare("SELECT * FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open' ORDER BY id").all(Number(reservationId));
    let held = rows.reduce((sum, row) => sum + row.amountCents, 0);
    if (wantedCents > held) {
      open({ reservationId, origin: 'lineLowered', amountCents: wantedCents - held, reason: 'ligne payée baissée' });
      return;
    }
    for (const row of [...rows].reverse()) {
      if (held <= wantedCents) break;
      const excess = held - wantedCents;
      if (row.amountCents <= excess) {
        close(row.id, { status: 'cancelled', by: 'system' });
        held -= row.amountCents;
      } else {
        database.prepare('UPDATE refund_obligations SET amountCents = ? WHERE id = ?').run(row.amountCents - excess, row.id);
        held = wantedCents;
      }
    }
  }

  // A refund opened on the trop-perçu gives the money back: the `lineLowered` rows it covers are settled, oldest first.
  function settleLoweredBy(reservationId, refundId, cents) {
    if (!ready()) return;
    let left = cents;
    for (const row of database.prepare("SELECT * FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open' ORDER BY id").all(Number(reservationId))) {
      if (left <= 0) break;
      if (row.amountCents <= left) {
        close(row.id, { status: 'settled', by: `refund:${refundId}` });
        left -= row.amountCents;
      } else {
        database.prepare('UPDATE refund_obligations SET amountCents = ? WHERE id = ?').run(row.amountCents - left, row.id);
        left = 0;
      }
    }
  }

  return {
    ready,
    open,
    close,
    trimLowered,
    settleLoweredBy,
    findById,
    openThenSettle(input, by = 'provider') {
      const row = open(input);
      return row ? close(row.id, { status: 'settled', by }) : null;
    },
    listFor: (reservationId, { status = null } = {}) => (ready()
      ? database.prepare(`SELECT * FROM refund_obligations WHERE reservationId = ? ${status ? 'AND status = ?' : ''} ORDER BY id`).all(...[Number(reservationId), ...(status ? [status] : [])])
      : []),
    openFor: (reservationId) => (ready()
      ? database.prepare("SELECT * FROM refund_obligations WHERE reservationId = ? AND status = 'open' ORDER BY id").all(Number(reservationId)) : []),
    openAmountFor: (reservationId, origin) => (ready()
      ? Number(database.prepare("SELECT COALESCE(SUM(amountCents), 0) AS n FROM refund_obligations WHERE reservationId = ? AND origin = ? AND status = 'open'").get(Number(reservationId), origin).n) : 0),
    forLink: (linkId, origin) => (ready()
      ? database.prepare('SELECT * FROM refund_obligations WHERE paymentLinkId = ? AND origin = ? ORDER BY id DESC').get(Number(linkId), origin) : null),
  };
}

const defaultModel = buildModel(require('../database'));
defaultModel.buildModel = buildModel;
defaultModel.ORIGINS = ORIGINS;

module.exports = defaultModel;
