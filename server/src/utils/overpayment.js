/**
 * Trop-perçu (specs/reservation-refunds.md rule 34): what the guest paid on the acompte and the solde
 * beyond what the stay now costs, net of what was already given back.
 *
 * A paid bucket's collected amount is read from the contribs captured when it was ticked — they add up
 * to that day's amount (specs/force-item-to-complement.md, conservation), so they survive a later save
 * that lowers the bucket. Without a capture (a stay ticked before captures existed), the stored amount
 * is the only knowledge there is. A caisse-interne bucket is money received too.
 *
 * Pure: the caller reads the row, the captured sums and the refunds.
 */

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * @param {object} row       reservation row (depositPaid/Cash, balancePaid/Cash, depositAmount, balanceAmount)
 * @param {{ deposit: (number|null), balance: (number|null) }} captured  Σ contribs per bucket, null when none
 * @returns {number} the money received on the pre-arrival schedule
 */
function collectedOnSchedule(row = {}, captured = {}) {
  const sums = captured || {};
  const bucket = (paid, cash, capturedSum, stored) => {
    if (!(Number(paid || 0) === 1 || Number(cash || 0) === 1)) return 0;
    return capturedSum == null ? Number(stored || 0) : Number(capturedSum);
  };
  return round2(
    bucket(row.depositPaid, row.depositPaidCash, sums.deposit, row.depositAmount)
    + bucket(row.balancePaid, row.balancePaidCash, sums.balance, row.balanceAmount),
  );
}

/**
 * @param {object} args
 * @param {object} args.row            the reservation as stored (its payment flags and amounts)
 * @param {object} args.captured       Σ contribs per bucket (see collectedOnSchedule)
 * @param {number} args.refundedTtc    every refund already given back, whatever the means
 * @param {number} [args.depositAmount] the schedule the stay now has (default: the stored one)
 * @param {number} [args.balanceAmount]
 * @returns {number} ≥ 0 — the trop-perçu, 0 when the stay is not over-collected
 */
function overpaymentOf({ row = {}, captured = {}, refundedTtc = 0, depositAmount, balanceAmount }) {
  const pick = (given, stored) => Number((given === undefined ? stored : given) || 0);
  const due = pick(depositAmount, row.depositAmount) + pick(balanceAmount, row.balanceAmount);
  return Math.max(0, round2(collectedOnSchedule(row, captured) - Number(refundedTtc || 0) - due));
}

module.exports = { collectedOnSchedule, overpaymentOf };
