/**
 * Payment-deadline alert rows (specs/payment-schedule-and-cancellation.md §3.4).
 *
 * `computePaymentStatus` has been able to say « overdue » since day one, but no screen ever asked:
 * the dashboard's red « Paiements » cell is deliberately about door money only
 * (specs/dashboard-collection-alert.md rule 3), and the Finances page lists what is left to pay
 * without ever saying it is late. An unpaid direct booking could therefore reach its arrival date
 * without a single alert. This is the missing surface.
 *
 * Four states, most severe first:
 *   `unpaid_at_arrival` — the guest is arriving (or has) and the pre-arrival money is not in;
 *   `cancel_due`        — the solde is late enough that the stay may be cancelled and the acompte kept;
 *   `balance_overdue`   — the solde is late, the cancellation deadline is not reached yet;
 *   `deposit_overdue`   — the acompte is late.
 * A reservation late on both échéances yields ONE row, in its most severe state, listing both amounts.
 *
 * Pure: rows in, ready-to-render rows out. Everything the client needs to draw the card — the state,
 * the amounts, how many days late, whether cancelling is offered — is decided here.
 */

const { resolveCancelOn, daysBetween, toIsoDay } = require('./paymentSchedule');
const { isDirectChannel } = require('./platformNameFormat');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SEVERITY_BY_STATE = {
  unpaid_at_arrival: 'error',
  cancel_due: 'error',
  balance_overdue: 'warning',
  deposit_overdue: 'warning',
};
// Render order: the two red states first, then the late solde, then the late acompte.
const STATE_RANK = ['unpaid_at_arrival', 'cancel_due', 'balance_overdue', 'deposit_overdue'];

const clientNameOf = (row) => `${String(row.firstName || '').trim()} ${String(row.lastName || '').trim()}`.trim();

/**
 * One reservation → one alert row, or null when it owes nothing overdue (or is not ours to chase).
 *
 * @param {object} row   reservation joined with client + property + the property's cancellation delay
 * @param {string} today YYYY-MM-DD
 */
function buildPaymentDeadlineRow(row = {}, today) {
  // Platform bookings are settled by the platform after the stay: an unpaid solde is the normal
  // state of affairs there, not something to chase (rule 1).
  if (!isDirectChannel(row.platform)) return null;

  // Snoozed by the operator: hidden until the date, but the échéances themselves never moved (rule 18).
  const snoozedUntil = toIsoDay(row.paymentAlertSnoozedUntil);
  if (snoozedUntil && snoozedUntil >= today) return null;

  const depositAmount = round2(row.depositAmount);
  const balanceAmount = round2(row.balanceAmount);
  const depositUnpaid = depositAmount > 0 && !Number(row.depositPaid);
  const balanceUnpaid = balanceAmount > 0 && !Number(row.balancePaid);
  if (!depositUnpaid && !balanceUnpaid) return null;

  const depositDueDate = toIsoDay(row.depositDueDate);
  const balanceDueDate = toIsoDay(row.balanceDueDate);
  const depositLate = depositUnpaid && Boolean(depositDueDate) && depositDueDate < today;
  const balanceLate = balanceUnpaid && Boolean(balanceDueDate) && balanceDueDate < today;

  const startDate = toIsoDay(row.startDate);
  const arrived = Boolean(startDate) && startDate <= today;
  const cancelOn = resolveCancelOn({
    balanceDueDate,
    cancelAfterBalanceDueDays: row.cancelAfterBalanceDueDays,
  });

  let state = null;
  if (arrived) state = 'unpaid_at_arrival';
  else if (balanceLate && cancelOn && cancelOn <= today) state = 'cancel_due';
  else if (balanceLate) state = 'balance_overdue';
  else if (depositLate) state = 'deposit_overdue';
  if (!state) return null;

  // The deadline the row is really about — the solde as soon as it is late, else the acompte.
  const drivingDueDate = balanceLate ? balanceDueDate : (depositLate ? depositDueDate : (balanceDueDate || depositDueDate));
  const daysLate = drivingDueDate ? Math.max(0, daysBetween(drivingDueDate, today) || 0) : 0;

  return {
    reservationId: Number(row.id),
    reservationNumber: row.reservationNumber || null,
    state,
    severity: SEVERITY_BY_STATE[state],
    clientName: clientNameOf(row),
    clientEmail: row.email || '',
    propertyName: row.propertyName || '',
    startDate: startDate || null,
    endDate: toIsoDay(row.endDate),
    depositDue: depositUnpaid ? depositAmount : 0,
    balanceDue: balanceUnpaid ? balanceAmount : 0,
    totalDue: round2((depositUnpaid ? depositAmount : 0) + (balanceUnpaid ? balanceAmount : 0)),
    dueDate: drivingDueDate || null,
    daysLate,
    cancelOn: cancelOn || null,
    // Cancelling is only ever proposed BEFORE the arrival: suggesting it for a guest already at the
    // door would be absurd (rule 13). `cancel_due` already implies `today < startDate`.
    canCancel: state === 'cancel_due',
    // What would be kept if the stay were cancelled now — the acompte already collected (rule 27:
    // an unpaid acompte keeps nothing).
    retainedDepositAmount: Number(row.depositPaid) ? depositAmount : 0,
    canRemind: Boolean(row.email),
    remindType: balanceUnpaid ? 'balance' : 'deposit',
  };
}

/** Every alert row, most severe first, then most overdue first. */
function buildPaymentDeadlineRows(rows = [], today) {
  return rows
    .map((row) => buildPaymentDeadlineRow(row, today))
    .filter(Boolean)
    .sort((a, b) => {
      const rank = STATE_RANK.indexOf(a.state) - STATE_RANK.indexOf(b.state);
      if (rank !== 0) return rank;
      if (b.daysLate !== a.daysLate) return b.daysLate - a.daysLate;
      return a.reservationId - b.reservationId;
    });
}

module.exports = {
  buildPaymentDeadlineRow,
  buildPaymentDeadlineRows,
  SEVERITY_BY_STATE,
  STATE_RANK,
};
