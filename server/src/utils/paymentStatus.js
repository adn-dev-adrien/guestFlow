// Single source of truth for a reservation's payment status (remaining due, overdue flags/amount).
// Pure: takes a reservation row + the reference "today" (YYYY-MM-DD) and returns ready-to-render fields.
// Replaces the two divergent client-side getRemainingDue implementations.

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * @param {object} reservation row with finalPrice, depositAmount/depositPaid/depositDueDate,
 *                              balanceAmount/balancePaid/balanceDueDate
 * @param {string} today reference date `YYYY-MM-DD` (defaults to the current UTC day)
 * @returns {{
 *   remainingDue:number, paymentComplete:boolean,
 *   depositOverdue:boolean, balanceOverdue:boolean,
 *   overdueAmount:number, oldestDueDate:(string|null), isOverdue:boolean
 * }}
 */
function computePaymentStatus(reservation = {}, today = new Date().toISOString().split('T')[0]) {
  const finalPrice = Number(reservation.finalPrice || 0);
  const depositAmount = Number(reservation.depositAmount || 0);
  const balanceAmount = Number(reservation.balanceAmount || 0);
  const depositPaid = !!reservation.depositPaid;
  const balancePaid = !!reservation.balancePaid;

  const remainingDue = round2(
    finalPrice - (depositPaid ? depositAmount : 0) - (balancePaid ? balanceAmount : 0),
  );

  const depositOverdue = !depositPaid && !!reservation.depositDueDate && reservation.depositDueDate < today;
  const balanceOverdue = !balancePaid && !!reservation.balanceDueDate && reservation.balanceDueDate < today;
  const overdueAmount = round2(
    (depositOverdue ? depositAmount : 0) + (balanceOverdue ? balanceAmount : 0),
  );

  const oldestDueDate = [reservation.depositDueDate, reservation.balanceDueDate]
    .filter(Boolean)
    .sort()[0] || null;

  return {
    remainingDue,
    paymentComplete: remainingDue <= 0,
    depositOverdue,
    balanceOverdue,
    overdueAmount,
    oldestDueDate,
    isOverdue: depositOverdue || balanceOverdue,
  };
}

module.exports = { computePaymentStatus, round2 };
