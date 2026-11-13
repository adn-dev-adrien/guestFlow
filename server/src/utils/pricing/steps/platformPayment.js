/**
 * STEP platformPayment — PLATFORM PAYMENT (specs/pricing-components.md §3 rule 52).
 *
 * Clamps the commissions entered for the platform and computes the net it pays out.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { clampCommissions, netReceived } = require('../platformPayment');

const step = {
  id: 'platformPayment',
  requires: [
    'acompteCommissionAmountInput', 'channel', 'installmentPlan', 'platformCommissionAmountInput',
    'preArrivalAmount', 'resolvedBalanceAmount', 'resolvedDepositAmount',
  ],
  provides: ['acompteCommissionAmount', 'platformCommissionAmount', 'platformNetReceivedAmount', 'totalPlatformCommission'],
  apply(ctx) {
    const {
      acompteCommissionAmountInput, channel, installmentPlan, platformCommissionAmountInput,
      preArrivalAmount, resolvedBalanceAmount, resolvedDepositAmount,
    } = ctx;

    const { solde: platformCommissionAmount, acompte: acompteCommissionAmount, total: totalPlatformCommission } = clampCommissions({
      channel,
      solde: platformCommissionAmountInput,
      acompte: acompteCommissionAmountInput,
      installmentPlan,
      preArrivalAmount,
      balanceAmount: resolvedBalanceAmount,
      depositAmount: resolvedDepositAmount,
    });
    const platformNetReceivedAmount = netReceived({ preArrivalAmount, totalPlatformCommission });

    return {
      ...ctx,
      acompteCommissionAmount, platformCommissionAmount, platformNetReceivedAmount,
      totalPlatformCommission,
    };
  },
};

module.exports = step;
