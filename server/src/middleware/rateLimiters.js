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

module.exports = { apiLimiter, loginLimiter };
