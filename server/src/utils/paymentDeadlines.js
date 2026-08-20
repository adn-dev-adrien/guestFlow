/**
 * Payment-deadline alert rows (specs/payment-schedule-and-cancellation.md §3.4).
 *
 * `computePaymentStatus` has been able to say « overdue » since day one, but no screen ever asked:
 * the dashboard's red « Paiements » cell is deliberately about door money only
 * (specs/dashboard-collection-alert.md rule 3), and the Finances page lists what is left to pay
 * without ever saying it is late. An unpaid direct booking could therefore reach its arrival date
 * without a single alert. This is the missing surface.
 *
 * Five states, most severe first:
 *   `unpaid_at_arrival` — the guest is arriving (or has) and the pre-arrival money is not in;
 *   `cancel_due`        — the solde is late enough that the stay may be cancelled and the acompte kept;
 *   `balance_overdue`   — the solde is late, the cancellation deadline is not reached yet;
 *   `deposit_overdue`   — the acompte is late;
 *   `platform_payout_overdue` — an OTA has not settled `payoutDueDays` after the guest left
 *                         (specs/platform-payout-due-date.md §3.2). Money owed by a PLATFORM, not by
 *                         a guest: nothing to email, nothing to cancel — the stay already happened;
 *   `platform_amount_missing` — same deadline, but the booking carries no figures at all: the amount
 *                         was never entered, so there is nothing to chase and something to type
 *                         (§3.2bis). The one state with no expiry — it is a hole in the books.
 * A reservation late on both échéances yields ONE row, in its most severe state, listing both amounts.
 *
 * Pure: rows in, ready-to-render rows out. Everything the client needs to draw the card — the state,
 * the amounts, how many days late, whether cancelling is offered — is decided here.
 */

const { resolveCancelOn, daysBetween, toIsoDay } = require('./paymentSchedule');
const { isDirectChannel, formatPlatformName } = require('./platformNameFormat');
const { normalizePayoutDueDays } = require('./platformPayout');
const { addDaysToIsoDate } = require('./devisHelpers');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SEVERITY_BY_STATE = {
  unpaid_at_arrival: 'error',
  cancel_due: 'error',
  balance_overdue: 'warning',
  deposit_overdue: 'warning',
  // Deliberately NOT 'error' (rule §9): an OTA payout running a few days late is routine, and turning
  // the whole card red for it would blunt the red signal again — the very failure
  // specs/dashboard-collection-alert.md was written to fix.
  platform_payout_overdue: 'warning',
  // A booking with no figures at all is a data-entry to-do, not a debt: same tone.
  platform_amount_missing: 'warning',
};
// Render order: the two red states first, then the late solde, then the late acompte, and last the
// platform payout — money owed by a platform arrives eventually; money owed by a guest about to walk
// in does not (specs/platform-payout-due-date.md rule 13).
const STATE_RANK = [
  'unpaid_at_arrival', 'cancel_due', 'balance_overdue', 'deposit_overdue', 'platform_payout_overdue',
  'platform_amount_missing',
];

// How long a row keeps its place on the card, per channel (rule 21). The card is a to-do list, not an
// archive: after a month of daily alerts the operator has seen it, and the money stays visible on the
// Finances page and on the reservation itself.
const MAX_DAYS_AFTER_STAY = 30;    // own channel — measured from the departure (parent spec rule 20bis)
const MAX_DAYS_LATE_PLATFORM = 30; // platform — measured from the payout deadline, which is AFTER the stay

const clientNameOf = (row) => `${String(row.firstName || '').trim()} ${String(row.lastName || '').trim()}`.trim();

/**
 * A platform booking whose payout is late (specs/platform-payout-due-date.md §3.2).
 *
 * Only the SOLDE can put such a reservation on the card: it is the platform's transfer. An unpaid
 * acompte on a platform that takes one is the platform's business too (rule 14), and neither
 * « the guest is at the door unpaid » nor « cancel and keep the acompte » can describe a stay that
 * already happened (rule 15).
 *
 * @returns {object|null} the row, or null when nothing is owed / the deadline has not passed
 */
function buildPlatformPayoutRow(row, today) {
  // A payout cannot be late before the guest has left.
  const endDate = toIsoDay(row.endDate);
  if (!endDate || endDate >= today) return null;

  // The deadline is DERIVED here, not read from `balanceDueDate` (rule 12bis). It is a pure function
  // of the departure and the platform's delay, so deriving it costs nothing — and it is what makes
  // shipping without a migration safe (rule 10): a reservation created before this change still
  // carries the old guest-facing date (arrival − 30), which for a stay that just ended would be
  // announced as « en retard de 26 jours » when the payout is not due yet. The stored column is a
  // cache for the fiche; the truth is departure + payoutDueDays.
  const balanceDueDate = addDaysToIsoDate(endDate, normalizePayoutDueDays(row.payoutDueDays));
  if (!balanceDueDate || balanceDueDate >= today) return null;

  const daysLate = Math.max(0, daysBetween(balanceDueDate, today) || 0);

  // specs/platform-payout-due-date.md §3.2bis — the booking carries NO money at all: an iCal import
  // writes `finalPrice = 0` and empty buckets, and the operator never entered the platform's figures.
  // Chasing a payout is meaningless here — we cannot even say how much is owed — so the row says what
  // is actually missing: the data entry. Same deadline as the payout (rule 27): until then, not
  // having typed the amounts yet is not an oversight.
  const balanceAmount = round2(row.balanceAmount);
  const nothingRecorded = !(round2(row.finalPrice) > 0)
    && !(balanceAmount > 0)
    && !(round2(row.depositAmount) > 0);

  const base = {
    reservationId: Number(row.id),
    reservationNumber: row.reservationNumber || null,
    clientName: clientNameOf(row),
    clientEmail: row.email || '',
    propertyName: row.propertyName || '',
    // Which platform owes the money — the card says it out loud (rule 19).
    platformLabel: formatPlatformName(row.platform) || String(row.platform || '').trim() || null,
    startDate: toIsoDay(row.startDate),
    endDate,
    dueDate: balanceDueDate,
    daysLate,
    cancelOn: null,
    // The séjour already happened: there is nothing left to cancel (rule 17)…
    canCancel: false,
    retainedDepositAmount: 0,
    // …and nobody to chase by email. GuestFlow must never ask an OTA guest for money they already
    // paid the platform (rule 16); chasing the platform happens in the platform's back-office.
    canRemind: false,
    remindType: null,
  };

  if (nothingRecorded) {
    return {
      ...base,
      state: 'platform_amount_missing',
      severity: SEVERITY_BY_STATE.platform_amount_missing,
      // No window (rule 29): a booking whose amount was never entered is missing from the books, and
      // an unpaid to-do does not become acceptable by ageing. It leaves the card the day the operator
      // enters the figures, and only then.
      depositDue: 0,
      balanceDue: 0,
      totalDue: 0,
    };
  }

  // Nothing left to claim (settled, or an amount that legitimately nets to zero) → no row.
  if (!(balanceAmount > 0) || Number(row.balancePaid)) return null;

  // Rule 21 — measured from the payout deadline, not from the departure: the row only becomes late
  // after the stay, so a window counted from `endDate` would barely leave it time to be seen.
  if (daysLate > MAX_DAYS_LATE_PLATFORM) return null;

  return {
    ...base,
    state: 'platform_payout_overdue',
    severity: SEVERITY_BY_STATE.platform_payout_overdue,
    depositDue: 0,
    balanceDue: balanceAmount,
    totalDue: balanceAmount,
  };
}

/**
 * One reservation → one alert row, or null when it owes nothing overdue (or is not ours to chase).
 *
 * @param {object} row   reservation joined with client + property + the property's cancellation delay,
 *                       plus `payoutDueDays` (the platform's own delay) on a non-direct row
 * @param {string} today YYYY-MM-DD
 */
function buildPaymentDeadlineRow(row = {}, today) {
  // Snoozed by the operator: hidden until the date, but the échéances themselves never moved (rule 18).
  const snoozedUntil = toIsoDay(row.paymentAlertSnoozedUntil);
  if (snoozedUntil && snoozedUntil >= today) return null;

  // A platform booking is settled by the platform AFTER the stay, so its solde is not the guest's
  // money and none of the guest-facing states below describe it. It gets its own row instead
  // (specs/platform-payout-due-date.md §3.2), driven by the payout deadline the pricing engine and
  // the iCal import store on `balanceDueDate` = departure + the platform's payoutDueDays.
  if (!isDirectChannel(row.platform)) return buildPlatformPayoutRow(row, today);

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

  // Rule 21 — a stay that ended more than a month ago leaves the card. This used to live in the
  // candidates SQL; it moved here so the platform rows, which only BECOME late after the departure,
  // can have their own window without shortening this one.
  const endDate = toIsoDay(row.endDate);
  if (endDate && (daysBetween(endDate, today) || 0) > MAX_DAYS_AFTER_STAY) return null;

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
    // Own channel: there is no platform to name (rule 19). Kept on the row so both shapes match.
    platformLabel: null,
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
