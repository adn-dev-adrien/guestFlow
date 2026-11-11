/**
 * One-shot cleanup of the deadline a 0 € acompte still carries —
 * specs/disable-deposit-per-reservation.md rules 2, 10 and 11 (spec review of 2026-10-27).
 *
 * Before rule 10, switching the acompte off (on the fiche or with the property switch) kept the date
 * the fiche posted back, so production holds reservations with `depositAmount = 0` and a
 * `depositDueDate`. The audit snapshot now reads such a row as « no deadline » on both sides of a
 * save; this cleanup makes the row say the same, so nothing (payment status, reminders) can read an
 * overdue acompte of 0 €.
 *
 * Conservative: reservations only (a devis dates its single payment on its validity), and only where
 * nothing was ever recorded on the acompte (`depositPaid = 0`, no `depositPaidDate`). Returns the
 * number of rows cleared, or null when the schema still lacks a column (the caller then does not
 * record the migration and retries at the next boot).
 */

function hasColumns(db, names) {
  try {
    const cols = new Set(db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
    return names.every((n) => cols.has(n));
  } catch {
    return false;
  }
}

function runZeroDepositDeadlineCleanup(db) {
  if (!hasColumns(db, ['kind', 'depositAmount', 'depositDueDate', 'depositPaid', 'depositPaidDate'])) return null;
  return db.prepare(`
    UPDATE reservations SET depositDueDate = NULL
     WHERE COALESCE(kind, 'reservation') = 'reservation'
       AND depositDueDate IS NOT NULL
       AND ROUND(COALESCE(depositAmount, 0) * 100) = 0
       AND COALESCE(depositPaid, 0) = 0
       AND depositPaidDate IS NULL
  `).run().changes;
}

module.exports = { runZeroDepositDeadlineCleanup };
