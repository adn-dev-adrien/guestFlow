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
  SETTLED: 'settled',
  AMOUNT_CHANGED: 'amount-changed',
  VALIDITY: 'validity',
  STAY_STARTED: 'stay-started',
});

module.exports = {
  PAYMENT_LINK_VALIDITY_HOURS,
  PAYMENT_LINK_MIN_REMAINING_HOURS,
  LAST_LOOK_DELAY_MINUTES,
  DEACTIVATION_ALERT_AFTER_HOURS,
  LINK_REASONS,
};
