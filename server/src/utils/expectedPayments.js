/**
 * Expected payments of a stay (specs/mobile-dashboard-exercise-cash.md rule 14) — `remainingToPay(r)` broken
 * into dated lines, one per unpaid bucket, with the day the money is expected.
 *
 * It reads the same flags as `remainingToPay` and nets the platform commission the same way, so the lines add
 * up to it; whatever the buckets do not explain comes out as one « Reste à régler » line on the departure day
 * (rule 14: a difference is listed, never dropped). Pure: the unpaid installments and the platform's payout
 * delay are handed in.
 */

const { remainingToPay, platformPenalty } = require('./reservationSettlement');
const { netOfCommission } = require('./pricing/platformPayment');
const { addDaysToIsoDate } = require('./devisHelpers');
const { isDirectChannel } = require('./platformNameFormat');
const { platformDisplayName } = require('./attributionChannel');
const { normalizePayoutDueDays } = require('./platformPayout');
const { roundMoneyOrZero: round2 } = require('./pricing/money');
const { localIsoDate } = require('./localDate');
const { LATE_AFTER_DAYS } = require('./installmentPlan');

const day = (value) => (value ? String(value).slice(0, 10) : null);
// `createdAt` is written by SQLite in UTC (`YYYY-MM-DD HH:MM:SS`): the booking day is the server-local one.
const localDayOf = (stamp) => {
  if (!stamp) return null;
  const text = String(stamp);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? day(text) : localIsoDate(date);
};

/**
 * @param {object} r stay row (amount, paid and due-date columns)
 * @param {{ today: string, installments?: Array<{ number: number, count: number, dueDate: string, amountCents: number }>,
 *           payoutDueDays?: number }} context the plan's unpaid rows (with the plan's size) and the platform's delay
 * @returns {Array<{ kind: string, label: string, date: string, amount: number, late: boolean, dueNow: boolean }>} by expected date.
 *   `late` means what the « En retard » tile means (an acompte / solde past its due date, a platform payout past its
 *   due date, an installment three days past its due date or on a stay that began); `dueNow` is a date already past
 *   that is NOT late (no due date, a complement, a split reste): money to receive now, counted on today.
 */
function expectedPayments(r, { today, installments = [], payoutDueDays } = {}) {
  const lines = [];
  const add = (kind, label, date, amount, late = false) => {
    const value = round2(amount);
    if (value === 0) return;
    lines.push({ kind, label, date, amount: value, late, dueNow: !late && date < today });
  };
  const arrival = day(r.startDate);
  const departure = day(r.endDate);

  if (!r.depositDisabled && !r.depositPaid && !r.depositPaidCash) {
    const due = day(r.depositDueDate);
    add('deposit', 'Acompte', due || localDayOf(r.createdAt) || arrival, netOfCommission({ amount: r.depositAmount, commission: r.acompteCommissionAmount }), Boolean(due) && due < today);
  }
  if (!r.balancePaid && !r.balancePaidCash) {
    const net = netOfCommission({ amount: r.balanceAmount, commission: r.platformCommissionAmount, penalty: platformPenalty(r) });
    if (r.requestOrigin !== 'public' && !isDirectChannel(r.platform)) {
      const payoutDate = addDaysToIsoDate(departure, normalizePayoutDueDays(payoutDueDays));
      add('payout', `Versement ${platformDisplayName(r.platform)}`, payoutDate, net, payoutDate < today && departure < today);
    } else {
      const due = day(r.balanceDueDate);
      add('balance', 'Solde', due || departure, net, Boolean(due) && due < today);
    }
  }
  if (!r.complementPaid && !r.complementPaidCash) add('complement', 'Complément d\'arrivée', arrival, r.complementAmount);
  if (!r.endOfStayComplementPaid && !r.endOfStayComplementPaidCash) add('endOfStay', 'Complément fin de séjour', departure, r.endOfStayComplementAmount);
  if (r.kind !== 'cancelled') {
    for (const i of installments) {
      const due = day(i.dueDate) || departure;
      add('installment', `Échéance ${i.number}/${i.count}`, due, Number(i.amountCents || 0) / 100, today >= addDaysToIsoDate(due, LATE_AFTER_DAYS) || arrival <= today);
    }
  }
  const due = round2(r.splitShortfallDue);
  if (due > 0) add('split', 'Reste à percevoir', departure, due);

  const gap = round2(remainingToPay(r) - lines.reduce((sum, l) => sum + l.amount, 0));
  add('residual', 'Reste à régler', departure, gap);

  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

module.exports = { expectedPayments };
