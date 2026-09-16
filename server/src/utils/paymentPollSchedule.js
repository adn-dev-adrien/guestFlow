/**
 * How often the payment reconciliation pass runs.
 * See specs/payment-polling-fair-use.md §3 rule 11.
 *
 * Three passes a day, not ninety-six. The 15-minute tick was chosen when the poll was the *only* way
 * a payment could be noticed; since specs/public-online-payment.md §3bis the webhook confirms in real
 * time and the guest's own success page reconciles on demand. What is left for the cron is catching a
 * webhook that never arrived — a question of hours.
 *
 * Kept apart from `scheduledTasks.js` so the value can be asserted by a test instead of read from a
 * `setInterval` argument.
 */

const DEFAULT_TICK_MINUTES = 8 * 60;

/** Same reading as the cadence thresholds of rule 9: junk, zero or negative falls back. */
function resolvePaymentPollTickMs(env = process.env) {
  const raw = env.PAYMENT_POLL_TICK_MINUTES;
  const n = Number(raw);
  const minutes = raw != null && String(raw).trim() !== '' && Number.isFinite(n) && n > 0 ? n : DEFAULT_TICK_MINUTES;
  return minutes * 60 * 1000;
}

module.exports = { resolvePaymentPollTickMs, DEFAULT_TICK_MINUTES };
