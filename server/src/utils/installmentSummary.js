/**
 * The installment plan as the pricing engine needs it (specs/direct-installments.md rules 4-5, 8): how
 * much the plan schedules, how much of it is collected, whether it is entirely settled. A plain read on
 * the handle it is given — no model, no database import — so the engine stays usable on any database;
 * `null` when the reservation has no plan or the table does not exist.
 */
function readInstallmentSummary(db, reservationId) {
  if (!db || !reservationId || Number(reservationId) <= 0) return null;
  // `amountEdited` is the pin of rule 9a; a schema that predates it has no pinned installment, hence no closed plan.
  const read = (floating) => db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(amountCents), 0) AS scheduledCents,
           COALESCE(SUM(CASE WHEN paid = 1 THEN amountCents ELSE 0 END), 0) AS paidCents,
           COALESCE(SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END), 0) AS unpaidCount,
           ${floating} AS floatingCount
      FROM reservation_installments WHERE reservationId = ?`).get(Number(reservationId));
  let row;
  try {
    try {
      row = read('COALESCE(SUM(CASE WHEN paid = 0 AND COALESCE(amountEdited, 0) = 0 THEN 1 ELSE 0 END), 0)');
    } catch {
      row = read('COALESCE(SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END), 0)');
    }
  } catch {
    return null;
  }
  if (!row || row.count === 0) return null;
  return {
    count: row.count,
    scheduled: row.scheduledCents / 100,
    paid: row.paidCents / 100,
    allPaid: row.paidCents === row.scheduledCents,
    // Rule 53 — some installment is unpaid and none of them adjusts: what the plan does not cover is paid at the arrival.
    closed: row.unpaidCount > 0 && row.floatingCount === 0,
  };
}

module.exports = { readInstallmentSummary };
