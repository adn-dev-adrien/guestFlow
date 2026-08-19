/**
 * Refunds model — sole DB access for `reservation_refunds` + `reservation_refund_lines`
 * (specs/reservation-refunds.md §5).
 *
 * A refund never touches the reservation row: it is an independent, dated « avoir » that downstream
 * readers subtract (financeModel) or mirror as a reversed journal entry (accountingModel). Header and
 * lines are always written in one transaction so a refund can never exist half-persisted.
 *
 * Factory `createModel(db)` (+ a default bound to the production DB), mirroring the other models
 * — named `createModel` because `create` is the insert method here.
 */

const db = require('../database');
const { isOffBooks, isRetainedDeposit } = require('../utils/refunds');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function createRefundsModel(database) {
  // Statements are prepared LAZILY (memoized on first use): several accounting/finance unit tests
  // build a minimal schema without the refund tables, and merely constructing the model there must
  // not throw — only actually asking it for refunds may.
  const cache = new Map();
  const prep = (sql) => {
    if (!cache.has(sql)) cache.set(sql, database.prepare(sql));
    return cache.get(sql);
  };
  const selectHeaders = () => prep(`
    SELECT id, reservationId, refundDate, method, totalTtc, reason, createdAt
    FROM reservation_refunds
    WHERE reservationId = ?
    ORDER BY refundDate DESC, id DESC
  `);
  const selectLines = () => prep(`
    SELECT id, refundId, lineKey, label, bucket, quantity, unitPrice, amountTtc, vatRate
    FROM reservation_refund_lines
    WHERE refundId = ?
    ORDER BY id
  `);
  const insertHeader = () => prep(`
    INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc, reason)
    VALUES (@reservationId, @refundDate, @method, @totalTtc, @reason)
  `);
  const insertLine = () => prep(`
    INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, quantity, unitPrice, amountTtc, vatRate)
    VALUES (@refundId, @lineKey, @label, @bucket, @quantity, @unitPrice, @amountTtc, @vatRate)
  `);

  let createTx = null;
  function insertRefund(reservationId, refund) {
    const info = insertHeader().run({
      reservationId,
      refundDate: refund.refundDate,
      method: refund.method,
      totalTtc: round2(refund.totalTtc),
      reason: refund.reason || '',
    });
    const refundId = Number(info.lastInsertRowid);
    for (const line of refund.lines) {
      insertLine().run({
        refundId,
        lineKey: line.lineKey || null,
        label: line.label,
        bucket: line.bucket,
        quantity: line.quantity == null ? null : Number(line.quantity),
        unitPrice: line.unitPrice == null ? null : round2(line.unitPrice),
        amountTtc: round2(line.amountTtc),
        vatRate: Number(line.vatRate || 0),
      });
    }
    return refundId;
  }

  const model = {
    // Full register of one reservation, newest refund first, lines attached.
    listByReservation(reservationId) {
      return selectHeaders().all(reservationId).map((header) => ({
        ...header,
        lines: selectLines().all(header.id),
      }));
    },

    getById(refundId) {
      const header = prep(`
        SELECT id, reservationId, refundDate, method, totalTtc, reason, createdAt
        FROM reservation_refunds WHERE id = ?
      `).get(refundId);
      if (!header) return null;
      return { ...header, lines: selectLines().all(header.id) };
    },

    // Header + lines in one transaction. `refund` is the normalized shape returned by
    // `utils/refunds.validateRefundPayload` — this layer trusts it and only persists. The
    // transaction, like the statements above, is built on first use.
    create(reservationId, refund) {
      if (!createTx) createTx = database.transaction(insertRefund);
      return createTx(reservationId, refund);
    },

    // Returns false when the refund doesn't exist or belongs to another reservation (the controller
    // turns that into a 404). Lines cascade.
    remove(reservationId, refundId) {
      const info = prep('DELETE FROM reservation_refunds WHERE id = ? AND reservationId = ?')
        .run(refundId, reservationId);
      return info.changes > 0;
    },

    // `{ book, withCash }` — book money (virement + espèces) vs everything including the caisse
    // interne. The two readings mirror what `complementPaidCash` does at each aggregate
    // (specs/reservation-refunds.md §3.3 rule 19). A `retained` avoir counts in NEITHER: it reverses
    // revenue in the journal but no money went back to the guest — we kept the acompte
    // (specs/payment-schedule-and-cancellation.md §3.6).
    totalsByReservation(reservationId) {
      const rows = prep('SELECT method, totalTtc FROM reservation_refunds WHERE reservationId = ?')
        .all(reservationId);
      let book = 0;
      let withCash = 0;
      for (const row of rows) {
        if (isRetainedDeposit(row.method)) continue;
        const amount = Number(row.totalTtc || 0);
        withCash += amount;
        if (!isOffBooks(row.method)) book += amount;
      }
      return { book: round2(book), withCash: round2(withCash) };
    },

    // Book-money refund totals for a set of reservations, `{ reservationId → { book, withCash } }`.
    // Used by financeModel to net a whole period in one query instead of N.
    totalsByReservationIds(ids) {
      const list = (ids || []).map(Number).filter(Number.isFinite);
      const totals = {};
      if (list.length === 0) return totals;
      const placeholders = list.map(() => '?').join(',');
      const rows = prep(`
        SELECT reservationId, method, totalTtc FROM reservation_refunds
        WHERE reservationId IN (${placeholders})
      `).all(...list);
      for (const row of rows) {
        if (isRetainedDeposit(row.method)) continue;
        const entry = totals[row.reservationId] || (totals[row.reservationId] = { book: 0, withCash: 0 });
        const amount = Number(row.totalTtc || 0);
        entry.withCash = round2(entry.withCash + amount);
        if (!isOffBooks(row.method)) entry.book = round2(entry.book + amount);
      }
      return totals;
    },

    // Book-money refunds whose date falls in [from, nextMonth) — the accounting export's source.
    // Caisse-interne refunds are excluded here, exactly like the cash complements are excluded from
    // `encaissementsByMonth` (specs/reservation-refunds.md §3.4 rule 26).
    listByMonth({ from, nextMonth }) {
      const headers = prep(`
        SELECT rf.id, rf.reservationId, rf.refundDate, rf.method, rf.totalTtc, rf.reason,
               r.platform, r.finalPrice,
               c.firstName, c.lastName,
               p.name AS propertyName
        FROM reservation_refunds rf
        JOIN reservations r ON rf.reservationId = r.id
        JOIN clients c ON r.clientId = c.id
        JOIN properties p ON r.propertyId = p.id
        WHERE rf.method <> 'internal'
          -- specs/payment-schedule-and-cancellation.md §3.6 rule 34 — a cancelled stay keeps its
          -- booked money visible: its requalification avoir is precisely an entry of the cancellation
          -- month, so accounting reads both kinds while every operational query keeps its filter.
          AND r.kind IN ('reservation', 'cancelled')
          AND rf.refundDate >= ? AND rf.refundDate < ?
        ORDER BY rf.refundDate, rf.id
      `).all(from, nextMonth);
      return headers.map((header) => ({ ...header, lines: selectLines().all(header.id) }));
    },
  };

  return model;
}

const defaultModel = createRefundsModel(db);
// `create` is already the insert method here, so the test factory is exposed as `createModel`.
defaultModel.createModel = createRefundsModel;

module.exports = defaultModel;
