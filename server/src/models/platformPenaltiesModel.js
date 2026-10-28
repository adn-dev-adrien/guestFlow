/**
 * Platform penalties of a stay (specs/reconciliation-assisted-matching.md rules 23–31): what a platform
 * keeps on a payout for a reason other than its commission or the tourist tax.
 *
 * Persistence only — the guards, the payout adjustment and the history live in
 * platformPenaltiesController. `reservations.platformPenaltyAmount` is the sum of the lines in euros,
 * rewritten in the same call as every insert or delete (the precedent of `installmentsPaidAmount`), so
 * every reader of a stay's money already holds it and none of them learns about this table.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function buildModel(database) {
  const syncTotal = (reservationId) => {
    const { cents } = database.prepare('SELECT COALESCE(SUM(amountCents), 0) AS cents FROM reservation_platform_penalties WHERE reservationId = ?').get(Number(reservationId));
    database.prepare("UPDATE reservations SET platformPenaltyAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(round2(cents / 100), Number(reservationId));
    return round2(cents / 100);
  };

  const shape = (row) => ({
    id: row.id, reservationId: row.reservationId, amountCents: row.amountCents, amount: round2(row.amountCents / 100), reason: row.reason,
    date: row.penaltyDate, source: row.source, payoutAdjustedFrom: row.payoutAdjustedFrom, payoutAdjustedTo: row.payoutAdjustedTo,
    commissionAdjustedFrom: row.commissionAdjustedFrom, commissionAdjustedTo: row.commissionAdjustedTo, createdAt: row.createdAt, createdBy: row.createdBy,
  });

  return {
    listFor(reservationId) {
      return database.prepare('SELECT * FROM reservation_platform_penalties WHERE reservationId = ? ORDER BY penaltyDate, id').all(Number(reservationId)).map(shape);
    },
    findById(id) {
      const row = database.prepare('SELECT * FROM reservation_platform_penalties WHERE id = ?').get(Number(id));
      return row ? shape(row) : null;
    },
    /** Penalties dated within [from, before) — the accounting entries of a month. */
    listByDate({ from, before }) {
      return database.prepare('SELECT * FROM reservation_platform_penalties WHERE penaltyDate >= ? AND penaltyDate < ? ORDER BY penaltyDate, id').all(String(from), String(before)).map(shape);
    },
    insert({
      reservationId, amountCents, reason, date, source = 'fiche', payoutAdjustedFrom = null, payoutAdjustedTo = null,
      commissionAdjustedFrom = null, commissionAdjustedTo = null, createdBy = null,
    }) {
      const id = database.prepare(`INSERT INTO reservation_platform_penalties
        (reservationId, amountCents, reason, penaltyDate, source, payoutAdjustedFrom, payoutAdjustedTo, commissionAdjustedFrom, commissionAdjustedTo, createdBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(reservationId), Math.round(amountCents), String(reason), String(date), String(source), payoutAdjustedFrom, payoutAdjustedTo, commissionAdjustedFrom, commissionAdjustedTo, createdBy).lastInsertRowid;
      syncTotal(reservationId);
      return Number(id);
    },
    remove(id) {
      const row = database.prepare('SELECT reservationId FROM reservation_platform_penalties WHERE id = ?').get(Number(id));
      if (!row) return false;
      database.prepare('DELETE FROM reservation_platform_penalties WHERE id = ?').run(Number(id));
      syncTotal(row.reservationId);
      return true;
    },
    totalFor(reservationId) {
      const row = database.prepare('SELECT platformPenaltyAmount AS total FROM reservations WHERE id = ?').get(Number(reservationId));
      return row ? round2(row.total) : 0;
    },
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
