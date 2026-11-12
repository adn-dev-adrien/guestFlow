/**
 * PLATFORM PAYMENT — what a platform pays out (specs/pricing-components.md §3 rules 70 and 6).
 *
 * Contract: `commissionOf({ basis: 'statement' | 'rentOnly', ... })` the commission of a platform stay from its
 * statement figures or from the rent alone; `clampCommissions(...)` each stored commission clamped to its instalment
 * and their total; `netReceived(...)` the amount the platform settles before arrival; `acompteNet(row)` the acompte
 * already paid out net of its commission; `grossOf(row)` the gross with its deposit + balance fallback;
 * `payoutWithPenalty(...)` the payout including a penalty the platform kept; `withheldOnCancellation(row)` the
 * commissions the payment provider withheld on a cancelled stay's acompte and solde.
 *
 * Pure: no DB, no clock, no settings. The engine reads `clampCommissions` and `netReceived`; the SDK
 * `reservations.platformCommission` reads `computePlatformCommission`. The penalties controller, the reconciliation
 * and the cancellation still carry their own copies of the formulas below and move here in PR B / C.
 */
const { roundMoney } = require('./money');

/**
 * The commission of a platform stay, from the figures of its statement
 * (specs/booking-extranet-intake.md §4.1). « Calculer la commission » of the fiche and the Booking
 * intake plugin both ask for it here, so the two can never disagree.
 *
 *   commission = gross − payout − tourist tax withheld − commission already taken on the acompte
 *
 * Rounded to the cent and never negative. Pure.
 */

const { roundMoneyStrict: round2 } = require('./money');
// The four helpers below stand for copies that read a stored row, where a column can be NULL, '' or text: a figure that is not a
// number counts as 0 (`round2` above is the commission formula's own, kept as it was).
const { roundMoneyOrZero: roundSafe } = require('./money');
const asNumber = (v) => (v === '' || v == null ? 0 : Number(v));

function computePlatformCommission({ gross, payout, touristTax = 0, acompteCommission = 0 }) {
  const g = Number(gross);
  const p = Number(payout);
  if (gross === '' || gross == null || payout === '' || payout == null || !Number.isFinite(g) || !Number.isFinite(p)) return null;
  const tax = Math.max(0, asNumber(touristTax) || 0);
  const acompte = asNumber(acompteCommission) || 0;
  return Math.max(0, round2(g - p - tax - acompte));
}

/**
 * The commission of a platform stay. `statement`: from the figures of the platform's statement (gross − payout − tax
 * withheld − acompte commission), never negative. `rentOnly` (Gîtes de France): the rent less the net rent the
 * centrale pays, rounded to the cent. `null` when a figure is missing.
 */
function commissionOf({ basis = 'statement', gross, payout, withheldTax = 0, acompteCommission = 0, rent, netRent } = {}) {
  if (basis === 'rentOnly') {
    const r = Number(rent);
    const n = Number(netRent);
    if (rent === '' || rent == null || netRent === '' || netRent == null || !Number.isFinite(r) || !Number.isFinite(n)) return null;
    return round2(r - n);
  }
  return computePlatformCommission({ gross, payout, touristTax: withheldTax, acompteCommission });
}

/**
 * Each stored commission clamped to ITS instalment, and their total (`channel` = the sale channel: only a named
 * platform carries a commission).
 */
function clampCommissions({
  channel, solde: platformCommissionAmountInput, acompte: acompteCommissionAmountInput, installmentPlan, preArrivalAmount,
  balanceAmount: resolvedBalanceAmount, depositAmount: resolvedDepositAmount,
}) {
  // specs/platform-commission-line.md — the platform commission is operator-entered (€, TTC) and only
  // applies to a non-direct platform; direct bookings have no commission (always 0). Negative input is
  // clamped to 0. The net the operator receives = total séjour − commission (null when no commission,
  // so the summary shows the single « Total du séjour TTC » line).
  // specs/platform-per-echeance-commission.md — per-échéance platform commissions, operator-entered (€).
  // Both ≥ 0, non-direct only. The acompte/solde AMOUNTS are gross (what the guest pays); the commissions
  // are tracked separately and booked on the platform account per échéance. Net perçu = total − Σ.
  // Rule 3 + edge case — each commission is clamped to ITS échéance (net cash ≥ 0): a 100 € commission
  // typed on a 0 € acompte used to flow into finance as a −100 € net (spec review 2026-10-27). Clamped
  // here, after the split, because the échéance amounts are only known now. An installment plan holds
  // the whole pre-arrival amount, so it is the solde's cap there.
  const clampCommission = (input, echeanceAmount) => {
    const n = input === '' || input == null ? 0 : Number(input);
    if (!channel.namedChannel || !Number.isFinite(n) || n <= 0) return 0;
    return roundMoney(Math.min(n, Math.max(0, Number(echeanceAmount) || 0)));
  };
  const platformCommissionAmount = clampCommission( // solde
    platformCommissionAmountInput,
    installmentPlan ? preArrivalAmount : resolvedBalanceAmount,
  );
  const acompteCommissionAmount = clampCommission(acompteCommissionAmountInput, resolvedDepositAmount); // acompte
  const totalPlatformCommission = roundMoney(platformCommissionAmount + acompteCommissionAmount);
  return { solde: platformCommissionAmount, acompte: acompteCommissionAmount, total: totalPlatformCommission };
}

/** What the platform settles before arrival: the pre-arrival amount less the commissions, null without commission. */
function netReceived({ preArrivalAmount, totalPlatformCommission }) {
  // Net perçu = what the platform actually settles to us = the PRE-ARRIVAL amount (acompte + solde) minus
  // its commission. It must NOT be based on `totalStayPrice`: the complement (the on-arrival tourist tax
  // for owner-collect platforms — `touristTaxCollectedOnArrival` — plus any on-site extras) is collected
  // by US at check-in, never by the platform. Using `totalStayPrice` over-counted the platform's payout by
  // exactly the complement, so the « Paiement plateforme » reconciliation always showed an écart equal to
  // the tourist tax (specs/platform-payment-entry.md). `preArrivalAmount` already routes the tax to the
  // right bucket, so for tax-collecting platforms (tax in the balance, complement = 0) the value is
  // unchanged (= totalStayPrice − commission).
  const platformNetReceivedAmount = totalPlatformCommission > 0
    ? roundMoney(preArrivalAmount - totalPlatformCommission)
    : null;
  return platformNetReceivedAmount;
}

const present = (v) => v !== '' && v != null && Number.isFinite(Number(v));

/** What the acompte the platform already paid out is worth net of its commission (rule 46 of the reconciliation). */
const acompteNet = (row) => (Number(row.depositDisabled || 0) === 1 || !(Number(row.depositAmount || 0) > 0)
  ? 0 : Math.max(0, roundSafe(Number(row.depositAmount) - Number(row.acompteCommissionAmount || 0))));

const grossOf = (row) => (present(row.platformGrossAmount) ? Number(row.platformGrossAmount) : roundSafe(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0)));

/** What the platform's statement leaves unexplained once its payout, the tourist tax it withheld and the acompte commission are out (negative when the figures disagree). */
const statementRemainder = ({ gross, payout, tax = 0, acompteCommission = 0 }) => roundSafe(Number(gross) - Number(payout) - Number(tax) - Number(acompteCommission));

/** The payout a statement implies from its gross and its commissions (no payout recorded yet). */
const statementPayout = ({ gross, commission = 0, acompteCommission = 0, tax = 0 }) => roundSafe(Number(gross) - Number(commission || 0) - Number(acompteCommission) - Number(tax));

/** What reaches the bank for the solde: the payout less the acompte already paid out and the penalties the platform kept (null without a payout). */
const bankReceived = ({ payout, acompteNet: paidOut = 0, penalties = 0 }) => (payout == null ? null : roundSafe(Number(payout) - Number(paidOut) - Number(penalties)));

/** What a still-unpaid échéance will actually bring in: its amount less the commission the platform takes on it and the penalty it keeps. */
const netOfCommission = ({ amount, commission = 0, penalty = 0 }) => Number(amount || 0) - Number(commission || 0) - Number(penalty || 0);

/** The two per-échéance commissions together. */
const totalCommission = (acompte, solde) => roundSafe(Number(acompte) + Number(solde));

/** The payout the platform made, penalty it kept included. */
const payoutWithPenalty = ({ payout, penalty }) => roundSafe(Number(payout || 0) + Math.max(0, Number(penalty || 0)));

/** The commissions the payment provider withheld on the acompte and the solde paid to the books. */
function withheldOnCancellation(row) {
  const book = (paid, cash) => Number(row[paid]) === 1 && !Number(row[cash] || 0);
  const depositTtc = book('depositPaid', 'depositPaidCash') ? Math.max(0, roundSafe(row.acompteCommissionAmount)) : 0;
  const soldeTtc = book('balancePaid', 'balancePaidCash') ? Math.max(0, roundSafe(row.platformCommissionAmount)) : 0;
  return { acompte: depositTtc, solde: soldeTtc };
}

module.exports = {
  computePlatformCommission, commissionOf, clampCommissions, netReceived, acompteNet, grossOf, payoutWithPenalty, withheldOnCancellation,
  statementRemainder, statementPayout, bankReceived, totalCommission, netOfCommission,
};
