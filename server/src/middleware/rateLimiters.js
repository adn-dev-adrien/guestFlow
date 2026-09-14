const rateLimit = require('express-rate-limit');

/**
 * Rate limiters (per IP). Windows/maxes are env-configurable.
 *
 * - apiLimiter: broad protection across /api (default 3000 / 15 min). The SPA fires many calls per
 *   navigation (lists, pricing recalcs, …), so this only catches abusive bursts, not normal usage.
 * - loginLimiter: brute-force protection on POST /api/auth/login (default 10 / 15 min).
 *
 * `trust proxy` is set in index.js so the client IP is correct behind the prod reverse proxy.
 */

const FIFTEEN_MIN = 15 * 60 * 1000;

const apiLimiter = rateLimit({
  windowMs: Number(process.env.API_RATELIMIT_WINDOW_MS) || FIFTEEN_MIN,
  max: Number(process.env.API_RATELIMIT_MAX) || 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' },
});

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATELIMIT_WINDOW_MS) || FIFTEEN_MIN,
  max: Number(process.env.LOGIN_RATELIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count toward the limit
  message: { error: 'TOO_MANY_ATTEMPTS' },
});

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Public API limiters (specs/public-api.md §3 rule 9). The public surface is consumed by a single
 * trusted proxy, so the limits are intentionally tighter than the admin SPA's `apiLimiter`.
 *
 * - publicApiLimiter: broad protection across all `/public/v1` routes (default 600 / 15 min / IP).
 * - bookingRequestLimiter: anti-spam on the only public write (default 5 / hour / IP). The
 *   per-API-key cap from the spec is enforced upstream by the proxy + the honeypot; here we cap by
 *   IP since the proxy forwards the visitor's IP via `trust proxy`.
 *
 * Both emit the uniform public error envelope so the client parses one shape everywhere.
 */
const publicApiLimiter = rateLimit({
  windowMs: Number(process.env.PUBLIC_API_RATELIMIT_WINDOW_MS) || FIFTEEN_MIN,
  max: Number(process.env.PUBLIC_API_RATELIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Trop de requêtes, réessayez plus tard.' } },
});

const bookingRequestLimiter = rateLimit({
  windowMs: Number(process.env.BOOKING_REQUEST_RATELIMIT_WINDOW_MS) || ONE_HOUR,
  max: Number(process.env.BOOKING_REQUEST_RATELIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Trop de demandes envoyées, réessayez plus tard.' } },
});

/**
 * Payment-status poll limiter (specs/public-online-payment.md §7, resolves §9 Q3). GET /status is a
 * read that also drives external Qonto calls + a devis→reservation conversion when a link is paid, so
 * it must be capped tighter than the broad public limiter to prevent a Qonto-quota / cost DoS. A legit
 * success page polls every 3 s for ~1 min (≈20 hits) then stops, so the default 120 / 5 min / IP leaves
 * ample headroom for reloads while blocking abusive bursts.
 */
const paymentStatusLimiter = rateLimit({
  windowMs: Number(process.env.PAYMENT_STATUS_RATELIMIT_WINDOW_MS) || (5 * 60 * 1000),
  max: Number(process.env.PAYMENT_STATUS_RATELIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Trop de requêtes, réessayez plus tard.' } },
});

module.exports = { apiLimiter, loginLimiter, publicApiLimiter, bookingRequestLimiter, paymentStatusLimiter };
