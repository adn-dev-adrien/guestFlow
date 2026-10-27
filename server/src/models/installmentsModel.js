/**
 * Installments model — sole DB access for `reservation_installments`
 * (specs/direct-installments.md §5).
 *
 * One row per installment of a reservation's plan, amounts in cents. The stay's own row carries three
 * aggregates (`installmentsPaidAmount`, `installmentsUnpaidAmount`, `installmentsTarget`, in euros) that
 * every reader of the stay's money takes from the row it already loads — settlement, finance, the
 * collection alert. Every write here refreshes them, so they never lag the installments.
 *
 * API:
 *   listFor(reservationId)                        → rows ordered by number
 *   findById(id)
 *   replacePlan(reservationId, rows, targetCents) → creates the plan { number, dueDate, amountCents }[]
 *   deletePlan(reservationId)
 *   updateRow(id, { dueDate?, dateEdited?, amountCents?, amountEdited? })
 *   applyAmounts(reservationId, amounts, { clearPins, added }) → amounts: Map number → cents
 *   markPaid(id, { paidDate, method })            → flips unpaid→paid (idempotent), returns { flipped, row }
 *   markRequested(id, at)
 *   setTarget(reservationId, targetCents)
 *   listLate({ cutoff })                          → unpaid installments due on or before `cutoff`, with the stay and its guest
 */

function buildModel(database) {
  const COLS = 'id, reservationId, number, dueDate, amountCents, paid, paidDate, paidMethod, requestedAt, dateEdited, amountEdited, addedCents';

  const listFor = (reservationId) => database.prepare(
    `SELECT ${COLS} FROM reservation_installments WHERE reservationId = ? ORDER BY number`,
  ).all(Number(reservationId));

  const findById = (id) => database.prepare(`SELECT ${COLS} FROM reservation_installments WHERE id = ?`).get(Number(id));

  function refreshAggregates(reservationId, targetCents) {
    const totals = database.prepare(`
      SELECT COALESCE(SUM(CASE WHEN paid = 1 THEN amountCents END), 0) AS paid,
             COALESCE(SUM(CASE WHEN paid = 0 THEN amountCents END), 0) AS unpaid,
             COUNT(*) AS n
        FROM reservation_installments WHERE reservationId = ?`).get(Number(reservationId));
    if (totals.n === 0) {
      database.prepare('UPDATE reservations SET installmentsPaidAmount = 0, installmentsUnpaidAmount = 0, installmentsTarget = 0 WHERE id = ?')
        .run(Number(reservationId));
      return;
    }
    if (targetCents === undefined) {
      database.prepare('UPDATE reservations SET installmentsPaidAmount = ?, installmentsUnpaidAmount = ? WHERE id = ?')
        .run(totals.paid / 100, totals.unpaid / 100, Number(reservationId));
      return;
    }
    database.prepare('UPDATE reservations SET installmentsPaidAmount = ?, installmentsUnpaidAmount = ?, installmentsTarget = ? WHERE id = ?')
      .run(totals.paid / 100, totals.unpaid / 100, targetCents / 100, Number(reservationId));
  }

  function replacePlan(reservationId, rows, targetCents) {
    database.transaction(() => {
      database.prepare('DELETE FROM reservation_installments WHERE reservationId = ?').run(Number(reservationId));
      const insert = database.prepare(
        'INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (?, ?, ?, ?)',
      );
      for (const row of rows) insert.run(Number(reservationId), row.number, row.dueDate, row.amountCents);
      refreshAggregates(reservationId, targetCents);
    })();
    return listFor(reservationId);
  }

  function deletePlan(reservationId) {
    database.transaction(() => {
      database.prepare('DELETE FROM reservation_installments WHERE reservationId = ?').run(Number(reservationId));
      refreshAggregates(reservationId);
    })();
  }

  function updateRow(id, fields) {
    const row = findById(id);
    if (!row) return null;
    const next = { ...row, ...fields };
    database.transaction(() => {
      database.prepare('UPDATE reservation_installments SET dueDate = ?, dateEdited = ?, amountCents = ?, amountEdited = ? WHERE id = ?')
        .run(next.dueDate, next.dateEdited ? 1 : 0, next.amountCents, next.amountEdited ? 1 : 0, Number(id));
      refreshAggregates(row.reservationId);
    })();
    return findById(id);
  }

  // `added`: number → the part a rise just brought to that unpaid installment (rule 8), shown beside its
  // amount until the next recalculation; every other write resets it.
  function applyAmounts(reservationId, amounts, { clearPins = false, added = new Map() } = {}) {
    database.transaction(() => {
      const update = database.prepare(
        'UPDATE reservation_installments SET amountCents = ?, addedCents = ? WHERE reservationId = ? AND number = ? AND paid = 0',
      );
      for (const [number, cents] of amounts) update.run(cents, added.get(number) || 0, Number(reservationId), number);
      if (clearPins) {
        database.prepare('UPDATE reservation_installments SET amountEdited = 0 WHERE reservationId = ?').run(Number(reservationId));
      }
      refreshAggregates(reservationId);
    })();
  }

  function markPaid(id, { paidDate, method }) {
    const row = findById(id);
    if (!row) return { flipped: false, row: null };
    const info = database.prepare(
      'UPDATE reservation_installments SET paid = 1, paidDate = ?, paidMethod = ? WHERE id = ? AND paid = 0',
    ).run(paidDate, method, Number(id));
    if (Number(info.changes) > 0) refreshAggregates(row.reservationId);
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  function markRequested(id, at) {
    database.prepare('UPDATE reservation_installments SET requestedAt = ? WHERE id = ?').run(at, Number(id));
  }

  function setTarget(reservationId, targetCents) {
    refreshAggregates(reservationId, targetCents);
  }

  // The unpaid installments due on or before `cutoff`, with the stay and its guest — the collection alert's
  // candidates (rule 22). Own channels only: a plan never lives elsewhere (rule 1).
  function listLate({ cutoff }) {
    return database.prepare(`
      SELECT i.id, i.reservationId, i.number, i.dueDate, i.amountCents,
             r.reservationNumber, r.startDate, r.endDate, r.paymentAlertSnoozedUntil,
             c.firstName, c.lastName, c.email, p.name AS propertyName
        FROM reservation_installments i
        JOIN reservations r ON r.id = i.reservationId AND r.kind = 'reservation'
        JOIN clients c ON c.id = r.clientId
        JOIN properties p ON p.id = r.propertyId
       WHERE i.paid = 0 AND i.dueDate <= ?
       ORDER BY i.dueDate, i.reservationId, i.number`).all(String(cutoff));
  }

  return {
    listFor, findById, replacePlan, deletePlan, updateRow, applyAmounts, markPaid, markRequested, setTarget, listLate,
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
