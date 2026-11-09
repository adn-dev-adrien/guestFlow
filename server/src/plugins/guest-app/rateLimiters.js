/**
 * The guest app's own rate limits (specs/guest-app.md §4.3, rules 6, 37). A phone calls these routes directly — no
 * site proxy relays them — so the key is the caller's address. Windows and maxima follow `GUEST_*_RATELIMIT_*`.
 * - session: opening a stay link or a lodging poster creates a session row (default 30 / hour / IP);
 * - lookup: the name + reservation number fallback, a guessable pair (rule 6, default 5 / 15 min / IP);
 * - order: a session's orders (rule 37, default 10 / hour / session) — two devices of one family count apart, and
 *   an order refused for its input gives its hit back.
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const ONE_HOUR = 60 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

const callerKey = (req) => ipKeyGenerator(req.ip);
const tooMany = (message) => ({ error: { code: 'TOO_MANY_REQUESTS', message } });
const envNumber = (name, fallback) => Number(process.env[name]) || fallback;

function createGuestLimiters() {
  return {
    session: rateLimit({
      keyGenerator: callerKey,
      windowMs: envNumber('GUEST_SESSION_RATELIMIT_WINDOW_MS', ONE_HOUR),
      max: envNumber('GUEST_SESSION_RATELIMIT_MAX', 30),
      standardHeaders: true,
      legacyHeaders: false,
      message: tooMany('Trop de requêtes, réessayez plus tard.'),
    }),
    lookup: rateLimit({
      keyGenerator: callerKey,
      windowMs: envNumber('GUEST_LOOKUP_RATELIMIT_WINDOW_MS', FIFTEEN_MIN),
      max: envNumber('GUEST_LOOKUP_RATELIMIT_MAX', 5),
      standardHeaders: true,
      legacyHeaders: false,
      message: tooMany('Trop de tentatives, réessayez plus tard.'),
    }),
    order: rateLimit({
      keyGenerator: (req) => (req.guest && req.guest.session ? `guest-session:${req.guest.session.id}` : callerKey(req)),
      windowMs: envNumber('GUEST_ORDER_RATELIMIT_WINDOW_MS', ONE_HOUR),
      max: envNumber('GUEST_ORDER_RATELIMIT_MAX', 10),
      standardHeaders: true,
      legacyHeaders: false,
      skipFailedRequests: true,
      message: tooMany('Trop de commandes en une heure, réessayez plus tard.'),
    }),
  };
}

module.exports = { createGuestLimiters };
