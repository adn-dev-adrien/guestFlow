/**
 * STEP schedule — SCHEDULE (specs/pricing-components.md §3 rule 52).
 *
 * The acompte, the solde, their due dates and the complement amounts.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { planSchedule } = require('../schedule');
const { isDirectChannel } = require('../../platformNameFormat');

const step = {
  id: 'schedule',
  requires: [
    'balanceAmount', 'balancePaid', 'bookingId', 'channel', 'complementAmount', 'complementAmountOverride',
    'complementForcedItemsTotal', 'complementPaid', 'depositAmount', 'depositAmountOverride', 'depositDisabled',
    'depositPaid', 'devisPromise', 'endDate', 'endOfStayComplementSettled', 'endOfStaySasAmount',
    'endOfStaySasAmountAuto', 'finalPrice', 'forcedItemsTotal', 'isTouristTaxCollectedOnArrival', 'midStayExtras',
    'midStayRemainingTotal', 'midStaySettledNotes', 'midStaySettledTotal', 'midStayTotal', 'midStayUnforced',
    'paidSoldeCaptured', 'paymentLedger', 'platform', 'platformGrossPin', 'platformPayoutDueDays',
    'platformTakesDeposit', 'quoteKind', 'settings', 'startDate', 'totalStayPrice', 'touristTaxAddedGuestsAmount',
    'touristTaxInComplement', 'touristTaxTotal', 'validUntil', 'clock',
  ],
  provides: [
    'accommodationPreArrival', 'autoComplementAmount', 'autoDepositAmount', 'balanceDueDate',
    'complementCollectedExcess', 'depositDueDate', 'endOfStayComplementAutoTotal', 'endOfStayComplementTotal',
    'installmentPlan', 'isTouristTaxForcedToComplement', 'midStayLinesWithExcess', 'midStayRemainingDue',
    'midStaySettledAll', 'overCollectedTtc', 'planScheduled', 'platformIsNonDirect', 'preArrivalAmount',
    'rawComplement', 'resolvedBalanceAmount', 'resolvedComplementAmount', 'resolvedDepositAmount',
    'taxInComplement',
  ],
  apply(ctx) {
    const {
      balanceAmount, balancePaid, bookingId, channel, complementAmount, complementAmountOverride,
      complementForcedItemsTotal, complementPaid, depositAmount, depositAmountOverride, depositDisabled,
      depositPaid, devisPromise, endDate, endOfStayComplementSettled, endOfStaySasAmount,
      endOfStaySasAmountAuto, finalPrice, forcedItemsTotal, isTouristTaxCollectedOnArrival,
      midStayExtras, midStayRemainingTotal, midStaySettledNotes, midStaySettledTotal, midStayTotal,
      midStayUnforced, paidSoldeCaptured, paymentLedger, platform, platformGrossPin,
      platformPayoutDueDays, platformTakesDeposit, quoteKind, settings, startDate, totalStayPrice,
      touristTaxAddedGuestsAmount, touristTaxInComplement, touristTaxTotal, validUntil,
    } = ctx;
    const { bookingDate, existingDepositDueDate } = ctx.clock;

    // The two readings of money received go through the PaymentLedger port here, under the conditions the plan has always
    // read them: a collected bucket has a split to carve out; a direct stay with nothing collected may have an installment
    // plan (rule 35 of specs/direct-installments.md: a bucket already collected is never zeroed). The unit gets values.
    const splitReceived = (depositPaid || balancePaid || complementPaid) ? paymentLedger.splitReceived(bookingId) : null;
    const installmentPlanRead = isDirectChannel(platform) && !depositPaid && !balancePaid ? paymentLedger.installments(bookingId) : null;

    // The two due dates are resolved AFTER the amounts (further down), because whether an échéance
    // exists at all depends on them — see the `resolveDepositDueDate` / `resolveBalanceDueDate` call
    // in `planSchedule` (specs/payment-schedule-and-cancellation.md §3.1-§3.2).

    const {
      accommodationPreArrival, autoComplementAmount, autoDepositAmount, balanceDueDate, complementCollectedExcess,
      depositDueDate, endOfStayComplementAutoTotal, endOfStayComplementTotal, installmentPlan,
      isTouristTaxForcedToComplement, midStayLinesWithExcess, midStayRemainingDue, midStaySettledAll, overCollectedTtc,
      planScheduled, platformIsNonDirect, preArrivalAmount, rawComplement, resolvedBalanceAmount,
      resolvedComplementAmount, resolvedDepositAmount, taxInComplement,
    } = planSchedule({
      totals: {
        finalPrice, totalStayPrice, touristTaxTotal, touristTaxAddedGuestsAmount, touristTaxInComplement,
        isTouristTaxCollectedOnArrival, forcedItemsTotal, complementForcedItemsTotal, platformGrossPin,
      },
      policy: {
        settings: settings.schedule, channel, platform, platformTakesDeposit, platformPayoutDueDays, quoteKind, devisPromise, validUntil,
        bookingDate, startDate, endDate, bookingId, depositDisabled,
      },
      planLines: {
        midStayExtras, midStayTotal, midStayUnforced, midStaySettledTotal, midStayRemainingTotal, midStaySettledNotes,
        endOfStaySasAmount, endOfStaySasAmountAuto,
      },
      overrides: { depositAmountOverride, complementAmountOverride },
      receipts: {
        depositPaid, balancePaid, complementPaid, depositAmount, balanceAmount, complementAmount, existingDepositDueDate,
        paidSoldeCaptured, endOfStayComplementSettled,
      },
      ledger: { splitReceived, installmentPlan: installmentPlanRead },
    });

    return {
      ...ctx,
      accommodationPreArrival, autoComplementAmount, autoDepositAmount, balanceDueDate,
      complementCollectedExcess, depositDueDate, endOfStayComplementAutoTotal, endOfStayComplementTotal,
      installmentPlan, isTouristTaxForcedToComplement, midStayLinesWithExcess, midStayRemainingDue,
      midStaySettledAll, overCollectedTtc, planScheduled, platformIsNonDirect, preArrivalAmount,
      rawComplement, resolvedBalanceAmount, resolvedComplementAmount, resolvedDepositAmount,
      taxInComplement,
    };
  },
};

module.exports = step;
