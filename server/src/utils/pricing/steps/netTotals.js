/**
 * STEP netTotals — TOTALS (specs/pricing-components.md §3 rule 52).
 *
 * The total the operator realises: net received, complements and the deductions that follow.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');

const step = {
  id: 'netTotals',
  requires: [
    'arrivalPaymentReduction', 'arrivalPaymentTip', 'endOfStayComplementTotal', 'installmentPlan',
    'midStaySettledAll', 'planScheduled', 'platformPenaltyAmount', 'preArrivalAmount', 'refundsTotal',
    'resolvedBalanceAmount', 'resolvedComplementAmount', 'resolvedDepositAmount', 'totalPlatformCommission',
  ],
  provides: ['resolvedArrivalReduction', 'resolvedArrivalTip', 'resolvedRefundsTotal', 'sejourNetTotal'],
  apply(ctx) {
    const {
      arrivalPaymentReduction, arrivalPaymentTip, endOfStayComplementTotal, installmentPlan,
      midStaySettledAll, planScheduled, platformPenaltyAmount, preArrivalAmount, refundsTotal,
      resolvedBalanceAmount, resolvedComplementAmount, resolvedDepositAmount, totalPlatformCommission,
    } = ctx;

    // specs/fiche-total-sejour-net-of-commission.md — the displayed « total du séjour » = what the
    // operator actually realises = net perçu + compléments. Net perçu = the platform's settlement
    // (pre-arrival − commission) when a commission applies, else the full pre-arrival amount (no
    // commission to deduct). Adding the complement back gives, for direct / no-commission bookings,
    // exactly today's `totalStayPrice`; for a platform with a commission it is `totalStayPrice −
    // commission`. `totalStayPrice` (gross) is kept for the brut « Montant soumis à commission » line.
    // (Caisse-interne complements are carved out at the finance layer, not here.)
    // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 15 — the end-of-stay complement is
    // realised money too (financeModel.totalSejour already counts it); the fiche used to ignore it, so
    // the two screens disagreed. It now rides the same total.
    // specs/fiche-total-sejour-net-of-commission.md rule 11 — the net is what the acompte and the solde
    // (or the installment plan) actually carry, minus the commission. While nothing is paid it is the
    // pre-arrival amount, as before; once a solde is paid and kept at what it collected, the rise is
    // owed by the arrival complement — counting the pre-arrival amount too took it twice (600 paid,
    // stay raised to 700: « Total perçu » 800). A plan not fully paid absorbs the rise itself (rule 8 of
    // direct-installments), so it still counts for the whole pre-arrival amount.
    // A plan above the stay after a drop (rule 8: nothing is lowered) counts for the stay, never for
    // installments the guest does not owe; what it already collected stays counted
    // (specs/reservation-payment-ledger.md rule 48 — same figure as the stored headline).
    const planCarries = installmentPlan
      ? (installmentPlan.allPaid ? planScheduled : Math.max(preArrivalAmount, Number(installmentPlan.paid || 0)))
      : 0;
    const netReceivedForTotal = roundMoney(
      resolvedDepositAmount + resolvedBalanceAmount + planCarries - totalPlatformCommission,
    );
    // specs/reservation-refunds.md §3.3 rule 17 — refunds are the only deduction on this total, and they
    // are the LAST one: the buckets above still show what was sold and collected.
    const resolvedRefundsTotal = roundMoney(Math.max(0, Number(refundsTotal) || 0));
    const resolvedArrivalReduction = roundMoney(Math.max(0, Number(arrivalPaymentReduction) || 0));
    const resolvedArrivalTip = roundMoney(Math.max(0, Number(arrivalPaymentTip) || 0));
    // Rule 36 of reservation-refunds — the trop-perçu is money received too: it is already inside the
    // acompte and solde kept at what they collected, so it stays in the total until a refund returns it.
    const sejourNetTotal = roundMoney(
      netReceivedForTotal + resolvedComplementAmount + endOfStayComplementTotal + midStaySettledAll
      - resolvedRefundsTotal - resolvedArrivalReduction + resolvedArrivalTip
      - roundMoney(Math.max(0, Number(platformPenaltyAmount) || 0)),
    );

    return { ...ctx, resolvedArrivalReduction, resolvedArrivalTip, resolvedRefundsTotal, sejourNetTotal };
  },
};

module.exports = step;
