/**
 * Cancellation compensations model — sole DB access for `cancellation_compensations`
 * (specs/cancellation-compensation.md §5).
 *
 * A compensation is what a platform pays back when a guest cancels outside the free-cancellation
 * window. It is deliberately **standalone**: approving an iCal cancellation DELETES the reservation,
 * so each row carries a frozen snapshot (property name, platform, client name, stay dates, lost stay
 * amount) rather than foreign keys.
 *
 * Lifecycle (spec §3.1): `pending` — editable, invisible to accounting — then `received`, which
 * freezes the row and books it at `receivedDate`. `reopen()` walks it back when a mistake needs
 * fixing; `remove()` is for the compensation that will never be paid.
 *
 * Business errors are returned, never thrown: `{ error: 'CODE', status }`, mapped to HTTP by the
 * controller. Statements are prepared LAZILY so building the model against a minimal test schema
 * (the accounting unit tests) never throws — only actually querying may.
 *
 * Factory `buildModel(database)` (+ a default bound to the production DB), like the other models.
 */

const { getTodayIsoDate } = require('../utils/reservationHelpers');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const COLUMNS = `id, cancellationAlertId, reservationId, propertyId, propertyName, platform,
                 clientFirstName, clientLastName, startDate, endDate, cancelledStayAmount,
                 expectedAmount, expectedDate, receivedAmount, receivedDate, status, notes,
                 createdAt, updatedAt`;

// The DB row plus the two derived fields the UI renders. `overdue` is computed HERE (server side)
// so no client ever re-derives "is this payment late" from a date.
function decorate(row) {
  if (!row) return null;
  const status = String(row.status || 'pending');
  return {
    ...row,
    cancelledStayAmount: row.cancelledStayAmount == null ? null : round2(row.cancelledStayAmount),
    expectedAmount: round2(row.expectedAmount),
    receivedAmount: row.receivedAmount == null ? null : round2(row.receivedAmount),
    overdue: status === 'pending' && Boolean(row.expectedDate) && String(row.expectedDate) < getTodayIsoDate(),
    clientName: `${String(row.clientFirstName || '').trim()} ${String(row.clientLastName || '').trim()}`.trim(),
  };
}

function buildModel(database) {
  const cache = new Map();
  const prep = (sql) => {
    if (!cache.has(sql)) cache.set(sql, database.prepare(sql));
    return cache.get(sql);
  };

  const insert = () => prep(`
    INSERT INTO cancellation_compensations
      (cancellationAlertId, reservationId, propertyId, propertyName, platform,
       clientFirstName, clientLastName, startDate, endDate, cancelledStayAmount,
       expectedAmount, expectedDate, notes)
    VALUES
      (@cancellationAlertId, @reservationId, @propertyId, @propertyName, @platform,
       @clientFirstName, @clientLastName, @startDate, @endDate, @cancelledStayAmount,
       @expectedAmount, @expectedDate, @notes)
  `);

  // Every write path normalises through the same shape so a manual creation and an approval-time
  // creation produce identical rows.
  function normalize(payload) {
    const p = payload || {};
    return {
      cancellationAlertId: p.cancellationAlertId == null ? null : Number(p.cancellationAlertId),
      reservationId: p.reservationId == null ? null : Number(p.reservationId),
      propertyId: p.propertyId == null ? null : Number(p.propertyId),
      propertyName: String(p.propertyName || '').trim(),
      platform: String(p.platform || '').trim(),
      clientFirstName: String(p.clientFirstName || '').trim(),
      clientLastName: String(p.clientLastName || '').trim(),
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      cancelledStayAmount: p.cancelledStayAmount == null ? null : round2(p.cancelledStayAmount),
      expectedAmount: round2(p.expectedAmount),
      expectedDate: p.expectedDate || null,
      notes: String(p.notes || '').trim(),
    };
  }

  const model = {
    // Returns the created row (decorated). The caller has already validated the payload.
    create(payload) {
      const info = insert().run(normalize(payload));
      return model.getById(Number(info.lastInsertRowid));
    },

    getById(id) {
      return decorate(prep(`SELECT ${COLUMNS} FROM cancellation_compensations WHERE id = ?`).get(id));
    },

    // Oldest expected payment first: the list doubles as an operator to-do list, so what is most
    // overdue sits at the top. NULL expected dates sort last.
    listPending() {
      return prep(`
        SELECT ${COLUMNS} FROM cancellation_compensations
         WHERE status = 'pending'
         ORDER BY (expectedDate IS NULL), expectedDate, id
      `).all().map(decorate);
    },

    // Half-open range [from, nextMonth) — same bounding as accountingModel.refundsByMonth, so a
    // compensation banked on the 1st or the 31st lands in exactly one month.
    listReceivedByMonth({ from, nextMonth }) {
      return prep(`
        SELECT ${COLUMNS} FROM cancellation_compensations
         WHERE status = 'received'
           AND receivedDate >= ? AND receivedDate < ?
         ORDER BY receivedDate, id
      `).all(from, nextMonth).map(decorate);
    },

    // Editable only while pending — a booked compensation is an accounting entry, not a draft.
    update(id, payload) {
      const current = model.getById(id);
      if (!current) return { error: 'INTROUVABLE', status: 404 };
      if (current.status === 'received') return { error: 'COMPENSATION_LOCKED', status: 409 };
      const next = normalize({ ...payload, cancellationAlertId: current.cancellationAlertId });
      prep(`
        UPDATE cancellation_compensations
           SET propertyId = @propertyId, propertyName = @propertyName, platform = @platform,
               clientFirstName = @clientFirstName, clientLastName = @clientLastName,
               startDate = @startDate, endDate = @endDate,
               cancelledStayAmount = @cancelledStayAmount,
               expectedAmount = @expectedAmount, expectedDate = @expectedDate,
               notes = @notes, updatedAt = datetime('now')
         WHERE id = @id
      `).run({ ...next, id: Number(id) });
      return { ok: true, data: model.getById(id) };
    },

    // The moment the money actually lands. `receivedDate` becomes the accounting date of the entry.
    receive(id, { receivedAmount, receivedDate }) {
      const current = model.getById(id);
      if (!current) return { error: 'INTROUVABLE', status: 404 };
      if (current.status === 'received') return { error: 'COMPENSATION_LOCKED', status: 409 };
      prep(`
        UPDATE cancellation_compensations
           SET receivedAmount = ?, receivedDate = ?, status = 'received', updatedAt = datetime('now')
         WHERE id = ?
      `).run(round2(receivedAmount), receivedDate, Number(id));
      return { ok: true, data: model.getById(id) };
    },

    // Walk a booked compensation back to editable. The amount + date are CLEARED, not kept: leaving
    // them would let a half-corrected row look booked to a future reader.
    reopen(id) {
      const current = model.getById(id);
      if (!current) return { error: 'INTROUVABLE', status: 404 };
      if (current.status !== 'received') return { error: 'COMPENSATION_NOT_RECEIVED', status: 409 };
      prep(`
        UPDATE cancellation_compensations
           SET receivedAmount = NULL, receivedDate = NULL, status = 'pending', updatedAt = datetime('now')
         WHERE id = ?
      `).run(Number(id));
      return { ok: true, data: model.getById(id) };
    },

    // Only a compensation that was never banked can be deleted — anything booked must be reopened
    // first, which is an explicit, warned-about action.
    remove(id) {
      const current = model.getById(id);
      if (!current) return { error: 'INTROUVABLE', status: 404 };
      if (current.status === 'received') return { error: 'COMPENSATION_LOCKED', status: 409 };
      prep('DELETE FROM cancellation_compensations WHERE id = ?').run(Number(id));
      return { ok: true };
    },
  };

  return model;
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;
defaultModel.__test = { decorate, round2 };

module.exports = defaultModel;
