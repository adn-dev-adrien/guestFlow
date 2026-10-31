/**
 * Payment link lifecycle constants (specs/payment-link-lifecycle.md).
 *
 * `LINK_REASONS` are the values of `payment_links.cancelReason`, the reason a link left `open`:
 * withdrawn (`cancelled`) — orphan, superseded, dates-taken, operator, settled, amount-changed;
 * lapsed (`expired`) — validity, stay-started (rule 2). A stay cancellation keeps writing NULL.
 */

const PAYMENT_LINK_VALIDITY_HOURS = 36;
const PAYMENT_LINK_MIN_REMAINING_HOURS = 24;
const LAST_LOOK_DELAY_MINUTES = 60;
const DEACTIVATION_ALERT_AFTER_HOURS = 24;

const LINK_REASONS = Object.freeze({
  ORPHAN: 'orphan',
  SUPERSEDED: 'superseded',
  DATES_TAKEN: 'dates-taken',
  OPERATOR: 'operator',
  // Rule 56 — a payment received on an `operator` link after its withdrawal, refunded by the operator.
  REFUNDED: 'refunded',
  SETTLED: 'settled',
  AMOUNT_CHANGED: 'amount-changed',
  VALIDITY: 'validity',
  STAY_STARTED: 'stay-started',
});

// Rule 1 — the reasons of a lapsed link (`status = 'expired'`); every other reason withdraws it.
const LAPSED_REASONS = new Set([LINK_REASONS.VALIDITY, LINK_REASONS.STAY_STARTED]);

// Rule 9 — the types that pay the stay before it begins; a `complement` is paid on site.
const PRE_ARRIVAL_TYPES = Object.freeze(['deposit', 'balance', 'full', 'installment']);

module.exports = {
  PAYMENT_LINK_VALIDITY_HOURS,
  PAYMENT_LINK_MIN_REMAINING_HOURS,
  LAST_LOOK_DELAY_MINUTES,
  DEACTIVATION_ALERT_AFTER_HOURS,
  LINK_REASONS,
  LAPSED_REASONS,
  PRE_ARRIVAL_TYPES,
};
