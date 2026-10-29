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
 *   markUnpaid(id)                                → takes a payment back (the bank reconciliation's « Défaire »), returns { flipped, row }
 *   markRequested(id, at)
 *   paidSplitOf(id)                               → that frozen split (parsed), or null — none stored / older schema
 *   setPaidSplit(id, split)                       → freezes the accounting split of a collected installment (rule 47)
 *   setTarget(reservationId, targetCents)
 *   listLate({ cutoff })                          → unpaid installments due on or before `cutoff`, with the stay and its guest
 */

const { parsePaidSplit } = require('../utils/installmentPaidSplit');

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
             COUNT(*) AS n, SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) AS unpaidCount
        FROM reservation_installments WHERE reservationId = ?`).get(Number(reservationId));
    if (totals.n === 0) {
      database.prepare('UPDATE reservations SET installmentsPaidAmount = 0, installmentsUnpaidAmount = 0, installmentsTarget = 0, installmentsLastPaidDate = NULL WHERE id = ?')
        .run(Number(reservationId));
      return;
    }
    const stored = database.prepare('SELECT installmentsTarget FROM reservations WHERE id = ?').get(Number(reservationId));
    const target = targetCents === undefined ? Math.round(Number(stored && stored.installmentsTarget || 0) * 100) : targetCents;
    // Rule 33 — once what was collected covers the stay, what remains unpaid on the plan is not owed.
    const owed = target > 0 && totals.paid >= target ? 0 : totals.unpaid;
    const last = totals.unpaidCount === 0
      ? database.prepare('SELECT MAX(paidDate) AS d FROM reservation_installments WHERE reservationId = ?').get(Number(reservationId)).d
      : null;
    database.prepare('UPDATE reservations SET installmentsPaidAmount = ?, installmentsUnpaidAmount = ?, installmentsTarget = ?, installmentsLastPaidDate = ? WHERE id = ?')
      .run(totals.paid / 100, owed / 100, target / 100, last, Number(reservationId));
  }

  function replacePlan(reservationId, rows, targetCents) {
    database.transaction(() => {
      database.prepare('DELETE FROM reservation_installments WHERE reservationId = ?').run(Number(reservationId));
      const insert = database.prepare(
        'INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (?, ?, ?, ?)',
      );
      for (const row of rows) insert.run(Number(reservationId), row.number, row.dueDate, row.amountCents);
      refreshAggregates(reservationId, targetCents);
    }).immediate();
    return listFor(reservationId);
  }

  function deletePlan(reservationId) {
    database.transaction(() => {
      database.prepare('DELETE FROM reservation_installments WHERE reservationId = ?').run(Number(reservationId));
      refreshAggregates(reservationId);
    }).immediate();
  }

  function updateRow(id, fields) {
    const row = findById(id);
    if (!row) return null;
    const next = { ...row, ...fields };
    database.transaction(() => {
      database.prepare('UPDATE reservation_installments SET dueDate = ?, dateEdited = ?, amountCents = ?, amountEdited = ? WHERE id = ?')
        .run(next.dueDate, next.dateEdited ? 1 : 0, next.amountCents, next.amountEdited ? 1 : 0, Number(id));
      refreshAggregates(row.reservationId);
    }).immediate();
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
    }).immediate();
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

  function markUnpaid(id) {
    const row = findById(id);
    if (!row) return { flipped: false, row: null };
    const info = database.prepare(
      'UPDATE reservation_installments SET paid = 0, paidDate = NULL, paidMethod = NULL, paidSplit = NULL WHERE id = ? AND paid = 1',
    ).run(Number(id));
    if (Number(info.changes) > 0) refreshAggregates(row.reservationId);
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  function paidSplitOf(id) {
    try {
      const row = database.prepare('SELECT paidSplit FROM reservation_installments WHERE id = ?').get(Number(id));
      return parsePaidSplit(row && row.paidSplit);
    } catch {
      return null;
    }
  }

  function setPaidSplit(id, split) {
    database.prepare('UPDATE reservation_installments SET paidSplit = ? WHERE id = ?').run(split ? JSON.stringify(split) : null, Number(id));
  }

  function markRequested(id, at) {
    database.prepare('UPDATE reservation_installments SET requestedAt = ? WHERE id = ?').run(at, Number(id));
  }

  function setTarget(reservationId, targetCents) {
    refreshAggregates(reservationId, targetCents);
  }

  // The unpaid installments due on or before `cutoff` — or whose guest has arrived (`today` ≥ arrival) — with
  // the stay and its guest: the collection alert's candidates (rules 22, 36). Own channels only: a plan never lives elsewhere (rule 1).
  function listLate({ cutoff, today }) {
    return database.prepare(`
      SELECT i.id, i.reservationId, i.number, i.dueDate, i.amountCents,
             (SELECT COUNT(*) FROM reservation_installments a WHERE a.reservationId = i.reservationId) AS count,
             r.reservationNumber, r.startDate, r.endDate, r.paymentAlertSnoozedUntil,
             c.firstName, c.lastName, c.email, p.name AS propertyName
        FROM reservation_installments i
        JOIN reservations r ON r.id = i.reservationId AND r.kind = 'reservation'
        JOIN clients c ON c.id = r.clientId
        JOIN properties p ON p.id = r.propertyId
       WHERE i.paid = 0 AND (i.dueDate <= ? OR r.startDate <= ?)
         AND NOT (r.installmentsTarget > 0 AND ROUND(r.installmentsPaidAmount * 100) >= ROUND(r.installmentsTarget * 100))
       ORDER BY i.dueDate, i.reservationId, i.number`).all(String(cutoff), String(today));
  }

  return {
    listFor, findById, replacePlan, deletePlan, updateRow, applyAmounts, markPaid, markUnpaid, markRequested, paidSplitOf, setPaidSplit, setTarget, listLate,
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
