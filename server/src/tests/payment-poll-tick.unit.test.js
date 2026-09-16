/**
 * How often the reconciliation pass runs.
 * See specs/payment-polling-fair-use.md §3 rule 11.
 *
 * Three passes a day, not ninety-six: the webhook confirms payments in real time and the guest's own
 * success page reconciles on demand, so what is left for the cron is catching a webhook that never
 * arrived — a question of hours.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePaymentPollTickMs, DEFAULT_TICK_MINUTES } = require('../utils/paymentPollSchedule');

const HOUR = 60 * 60 * 1000;

// Rule 11 — the default is three passes a day.
test('rule 11: the default tick is 8 hours, i.e. three passes a day', () => {
  assert.equal(DEFAULT_TICK_MINUTES, 480);
  assert.equal(resolvePaymentPollTickMs({}), 8 * HOUR);
  assert.equal(24 * HOUR / resolvePaymentPollTickMs({}), 3);
});

// Rule 11 — configurable, like the cadence thresholds of rule 9.
test('rule 11: PAYMENT_POLL_TICK_MINUTES overrides the default', () => {
  assert.equal(resolvePaymentPollTickMs({ PAYMENT_POLL_TICK_MINUTES: '15' }), 15 * 60 * 1000);
  assert.equal(resolvePaymentPollTickMs({ PAYMENT_POLL_TICK_MINUTES: 720 }), 12 * HOUR);
});

// Rule 11 — a value that cannot mean a duration must not silently stop or flood the pass.
test('rule 11: a missing, junk, zero or negative value falls back to the default', () => {
  for (const raw of [undefined, null, '', '   ', 'soon', NaN, 0, '0', -30, '-30']) {
    assert.equal(resolvePaymentPollTickMs({ PAYMENT_POLL_TICK_MINUTES: raw }), 8 * HOUR, `for ${JSON.stringify(raw)}`);
  }
});
