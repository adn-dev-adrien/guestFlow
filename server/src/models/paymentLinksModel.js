/**
 * Payment links model — sole DB access for `payment_links`
 * (specs/online-payments-qonto.md §5).
 *
 * One row per Qonto payment link issued for a reservation/devis (deposit / balance / full /
 * complement). The polling pass reads `status='open'` rows, checks Qonto, and flips them to `paid`.
 * Amounts are stored in **cents** (integer, exact — never float euros).
 *
 * API:
 *   create({ reservationId, type, amountCents, currency?, qontoPaymentLinkId?, url?, status?, expiresAt? }) → row
 *   listOpen()                              → all status='open' rows (the polling worklist)
 *   listForReservation(reservationId)       → every link for a reservation, newest first
 *   findOpenForReservation(reservationId, type) → the current open link of that type, or undefined
 *   markPaid(id, { qontoPaymentId, paidAt }) → flips open→paid (idempotent: a non-open row is untouched)
 *   updateStatus(id, status)                → 'open'|'paid'|'expired'|'cancelled'
 *   findById(id)
 */

const VALID_TYPES = new Set(['deposit', 'balance', 'full', 'complement']);
const VALID_STATUSES = new Set(['open', 'paid', 'expired', 'cancelled']);

function buildModel(database) {
  const SELECT_COLS = `id, reservationId, type, qontoPaymentLinkId, url, amountCents, currency,
    status, qontoPaymentId, createdAt, paidAt, expiresAt`;

  const insertStmt = database.prepare(`
    INSERT INTO payment_links
      (reservationId, type, qontoPaymentLinkId, url, amountCents, currency, status, expiresAt)
    VALUES
      (@reservationId, @type, @qontoPaymentLinkId, @url, @amountCents, @currency, @status, @expiresAt)
  `);

  function findById(id) {
    return database.prepare(`SELECT ${SELECT_COLS} FROM payment_links WHERE id = ?`).get(Number(id));
  }

  function create(payload) {
    const type = String(payload.type || '');
    if (!VALID_TYPES.has(type)) throw new Error(`Invalid payment link type: ${type}`);
    const status = payload.status ? String(payload.status) : 'open';
    if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment link status: ${status}`);
    const info = insertStmt.run({
      reservationId: Number(payload.reservationId),
      type,
      qontoPaymentLinkId: payload.qontoPaymentLinkId == null ? null : String(payload.qontoPaymentLinkId),
      url: String(payload.url || ''),
      amountCents: Math.round(Number(payload.amountCents || 0)),
      currency: String(payload.currency || 'EUR'),
      status,
      expiresAt: payload.expiresAt == null ? null : String(payload.expiresAt),
    });
    return findById(info.lastInsertRowid);
  }

  function listOpen() {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE status = 'open' ORDER BY id`
    ).all();
  }

  function listForReservation(reservationId) {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? ORDER BY id DESC`
    ).all(Number(reservationId));
  }

  function findOpenForReservation(reservationId, type) {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? AND type = ? AND status = 'open' ORDER BY id DESC LIMIT 1`
    ).get(Number(reservationId), String(type));
  }

  // Resolve a link by its Qonto id (the webhook receives the remote id, not our row id).
  function findByQontoPaymentLinkId(qontoId) {
    if (!qontoId) return undefined;
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE qontoPaymentLinkId = ? ORDER BY id DESC LIMIT 1`
    ).get(String(qontoId));
  }

  // Idempotent: only an `open` row transitions to `paid`. A late/duplicate call on an already-paid
  // (or cancelled/expired) row changes nothing and reports it didn't flip — so the polling pass
  // never double-processes a payment.
  function markPaid(id, { qontoPaymentId, paidAt } = {}) {
    const info = database.prepare(`
      UPDATE payment_links
         SET status = 'paid',
             qontoPaymentId = COALESCE(?, qontoPaymentId),
             paidAt = COALESCE(?, datetime('now'))
       WHERE id = ? AND status = 'open'
    `).run(qontoPaymentId == null ? null : String(qontoPaymentId), paidAt == null ? null : String(paidAt), Number(id));
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  function updateStatus(id, status) {
    const s = String(status);
    if (!VALID_STATUSES.has(s)) throw new Error(`Invalid payment link status: ${s}`);
    database.prepare("UPDATE payment_links SET status = ? WHERE id = ?").run(s, Number(id));
    return findById(id);
  }

  return {
    create,
    findById,
    listOpen,
    listForReservation,
    findOpenForReservation,
    findByQontoPaymentLinkId,
    markPaid,
    updateStatus,
  };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
