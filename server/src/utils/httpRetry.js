/**
 * Exponential back-off for provider HTTP calls (specs/payment-polling-fair-use.md rules 6 and 9).
 *
 * `withRetry(fn, opts)` runs `fn(attempt)` and retries it when it throws an error whose `status` is
 * `429` or `5xx`, waiting `baseDelayMs × 2^(attempt-1)` between attempts — or the error's
 * `retryAfter` header value when that is longer — each wait capped at `maxDelayMs`. Any other error is
 * rethrown at once. It owns no network and no timer: the caller's `fn` does the request and `sleep` is
 * injectable, so tests never wait.
 *
 * Options: { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 60000, sleep, now, onRetry }
 *   - maxAttempts counts every request, the first one included (3 → at most 2 retries).
 *   - onRetry({ attempt, delayMs, error }) is called before each wait (logging).
 *
 * `resolveRetryOptions(env)` reads QONTO_RETRY_MAX_ATTEMPTS / QONTO_RETRY_BASE_DELAY_MS /
 * QONTO_RETRY_MAX_DELAY_MS, falling back to the defaults on a missing or invalid value.
 */

const RETRY_DEFAULTS = Object.freeze({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60 * 1000 });

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status) {
  const s = Number(status);
  return s === 429 || (s >= 500 && s <= 599);
}

// `Retry-After` is either delta-seconds or an HTTP date. Returns milliseconds, or null when the value
// is absent, unparseable or negative (rule 6 edge case: treated as absent).
function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  const ms = at - nowMs;
  return ms >= 0 ? ms : null;
}

function retryDelayMs({ attempt, baseDelayMs, maxDelayMs, retryAfter, nowMs }) {
  const computed = baseDelayMs * 2 ** (attempt - 1);
  const fromHeader = parseRetryAfterMs(retryAfter, nowMs);
  const delay = fromHeader == null ? computed : Math.max(computed, fromHeader);
  return Math.min(delay, maxDelayMs);
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function resolveRetryOptions(env = process.env) {
  return {
    maxAttempts: positiveInt(env.QONTO_RETRY_MAX_ATTEMPTS, RETRY_DEFAULTS.maxAttempts),
    baseDelayMs: positiveInt(env.QONTO_RETRY_BASE_DELAY_MS, RETRY_DEFAULTS.baseDelayMs),
    maxDelayMs: positiveInt(env.QONTO_RETRY_MAX_DELAY_MS, RETRY_DEFAULTS.maxDelayMs),
  };
}

async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = RETRY_DEFAULTS.maxAttempts,
    baseDelayMs = RETRY_DEFAULTS.baseDelayMs,
    maxDelayMs = RETRY_DEFAULTS.maxDelayMs,
    sleep = defaultSleep,
    now = Date.now,
    onRetry,
  } = opts;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableStatus(error && error.status)) throw error;
      const delayMs = retryDelayMs({ attempt, baseDelayMs, maxDelayMs, retryAfter: error.retryAfter, nowMs: now() });
      if (typeof onRetry === 'function') onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}

module.exports = { withRetry, resolveRetryOptions, parseRetryAfterMs, retryDelayMs, isRetryableStatus, RETRY_DEFAULTS };
