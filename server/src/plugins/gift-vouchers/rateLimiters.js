/**
 * The limits on the public code check (specs/gift-vouchers.md rule 33), counted on `gift_voucher_checks` so a restart
 * forgets nothing: 5 failed checks per visitor per 15 minutes, 20 per visitor per day, and a global breaker — more than 30
 * failed checks in an hour over the whole instance refuses every public check for 30 minutes. A failed check is a
 * well-formed code that is unknown; a mistyped code never counts (rule 34).
 */

const MINUTE = 60 * 1000;
const PER_VISITOR_WINDOW_MS = 15 * MINUTE;
const PER_VISITOR_MAX = 5;
const PER_VISITOR_DAY_MAX = 20;
const DAY_MS = 24 * 60 * MINUTE;
const BREAKER_WINDOW_MS = 60 * MINUTE;
const BREAKER_MAX = 30;
const BREAKER_PAUSE_MS = 30 * MINUTE;

/** `onTrip({ failed, until })` runs once each time the breaker opens (the operator's « À traiter » item and push). */
function createCheckLimits({ checks, now = () => new Date(), onTrip = () => {} }) {
  let pausedUntil = 0;
  let countedFrom = 0;

  function pause() {
    const at = now().getTime();
    if (at < pausedUntil) return { code: 'VOUCHER_CHECKS_PAUSED', retryAfterSeconds: Math.ceil((pausedUntil - at) / 1000) };
    const failed = checks.failedSince(BREAKER_WINDOW_MS, null, countedFrom);
    if (failed <= BREAKER_MAX) return null;
    pausedUntil = at + BREAKER_PAUSE_MS;
    countedFrom = pausedUntil;
    onTrip({ failed, until: new Date(pausedUntil) });
    return { code: 'VOUCHER_CHECKS_PAUSED', retryAfterSeconds: Math.ceil(BREAKER_PAUSE_MS / 1000) };
  }

  /** → null when the visitor may check, else `{ code, retryAfterSeconds }`. */
  function refusal(visitorHash) {
    const paused = pause();
    if (paused) return paused;
    if (checks.failedSince(PER_VISITOR_WINDOW_MS, visitorHash) >= PER_VISITOR_MAX) {
      return { code: 'VOUCHER_CHECKS_EXCEEDED', retryAfterSeconds: Math.ceil(PER_VISITOR_WINDOW_MS / 1000) };
    }
    if (checks.failedSince(DAY_MS, visitorHash) >= PER_VISITOR_DAY_MAX) {
      return { code: 'VOUCHER_CHECKS_EXCEEDED', retryAfterSeconds: Math.ceil(DAY_MS / 1000) };
    }
    return null;
  }

  /** Whether the breaker is open now (opening it when the count says so), for the operator's « À traiter ». */
  const isPaused = () => pause() !== null;

  /** How many tries the visitor still has in the window: « Encore 3 essais. » */
  const triesLeft = (visitorHash) => Math.max(0, PER_VISITOR_MAX - checks.failedSince(PER_VISITOR_WINDOW_MS, visitorHash));

  return { refusal, isPaused, triesLeft };
}

module.exports = {
  createCheckLimits, PER_VISITOR_MAX, PER_VISITOR_DAY_MAX, BREAKER_MAX, BREAKER_PAUSE_MS, PER_VISITOR_WINDOW_MS,
};
