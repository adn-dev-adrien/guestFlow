// Single source of truth for a reservation's payment status (remaining due, overdue flags/amount).
// Pure: takes a reservation row + the reference "today" (YYYY-MM-DD) and returns ready-to-render fields.
// Replaces the two divergent client-side getRemainingDue implementations.

const { todayIso: localTodayIso } = require('./localDate');
function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * @param {object} reservation row with depositAmount/depositPaid/depositDueDate,
 *                              balanceAmount/balancePaid/balanceDueDate, the complements and the plan totals
 * @param {string} today reference date `YYYY-MM-DD` (defaults to the current UTC day)
 * @returns {{
 *   remainingDue:number, paymentComplete:boolean,
 *   depositOverdue:boolean, balanceOverdue:boolean,
 *   overdueAmount:number, oldestDueDate:(string|null), isOverdue:boolean
 * }}
 */
function computePaymentStatus(reservation = {}, today = localTodayIso()) {
  const depositAmount = Number(reservation.depositAmount || 0);
  const balanceAmount = Number(reservation.balanceAmount || 0);
  const depositPaid = !!reservation.depositPaid;
  const balancePaid = !!reservation.balancePaid;

  // What is still owed = the unpaid buckets, the very figure the finance invariant reads
  // (`remainingToPay`). It used to be `finalPrice − paid buckets`: the tourist tax (outside finalPrice,
  // inside the solde) made a fully paid stay read « −6 € », and a line routed to the arrival complement
  // read the wrong « reste » once the solde was paid (audit 2026-10-27).
  const remainingDue = require('./reservationSettlement').remainingToPay(reservation);

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
