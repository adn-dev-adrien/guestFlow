/**
 * Remboursements — specs/reservation-refunds.md.
 *
 * A refund is an « avoir »: money returned to the guest AFTER the sale, with its own date, WITHOUT
 * touching the sale. The sale keeps its price, its échéances and its paid flags; the refund lives in
 * its own register and is subtracted downstream (fiche total, finance aggregates, CA) and mirrored
 * as a reversed journal entry in the monthly export.
 *
 * Everything here is pure (no DB, no clock — `today` is injected): the caps, the refundable-line
 * derivation and the HT/VAT split are unit-testable in isolation. Persistence belongs to
 * models/refundsModel.js, orchestration to controllers/refundsController.js.
 */

const register = require('./pricing/refunds/register');
const collected = require('./pricing/refunds/collected');
const refundable = require('./pricing/refunds/refundable');
const judge = require('./pricing/refunds/judge');

module.exports = {
  lastBookPaymentDateOf: judge.lastBookPaymentDateOf,
  REFUND_METHODS: register.REFUND_METHODS,
  SELECTABLE_REFUND_METHODS: register.SELECTABLE_REFUND_METHODS,
  RETAINED_DEPOSIT_METHOD: register.RETAINED_DEPOSIT_METHOD,
  REFUND_BUCKETS: register.REFUND_BUCKETS,
  INDEMNITY_BUCKET: register.INDEMNITY_BUCKET,
  OFF_BOOKS_METHOD: register.OFF_BOOKS_METHOD,
  ACCOMMODATION_KEY: register.ACCOMMODATION_KEY,
  TOURIST_TAX_KEY: register.TOURIST_TAX_KEY,
  COMMISSION_KEY: register.COMMISSION_KEY,
  isOffBooks: register.isOffBooks,
  isRetainedDeposit: register.isRetainedDeposit,
  isIndemnityLine: register.isIndemnityLine,
  cancelledRefundBudget: refundable.cancelledRefundBudget,
  collectedByLine: collected.collectedByLine,
  collectedLinesGone: collected.collectedLinesGone,
  nettedByCancellation: register.nettedByCancellation,
  refundDeletionRefusal: judge.refundDeletionRefusal,
  madeAfterCancellation: register.madeAfterCancellation,
  billedLineKey: register.billedLineKey,
  refundedByKey: register.refundedByKey,
  buildRefundableLines: refundable.buildRefundableLines,
  validateRefundPayload: judge.validateRefundPayload,
  round2: register.round2,
};
