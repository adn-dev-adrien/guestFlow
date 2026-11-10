/**
 * The guest app's own rate limits (specs/guest-app.md §4.3, rules 6, 37). A phone calls these routes directly — no
 * site proxy relays them — so the key is the caller's address. Windows and maxima follow `GUEST_*_RATELIMIT_*`.
 * - session: opening a stay link or a lodging poster creates a session row (default 30 / hour / IP);
 * - lookup: the name + reservation number fallback, a guessable pair (rule 6, default 5 / 15 min / IP);
 * - order: a session's orders (rule 37, default 10 / hour / session) — two devices of one family count apart, and
 *   an order refused for its input gives its hit back;
 * - cardOrder: the card orders of a stay, whatever its sessions or addresses (rule 57, default 6 / hour / stay): each
 *   one mints a payment link at the provider, and a new session costs only a link exchange. A refused one is free.
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { languageOf } = require('./language');
const { textOf } = require('./refusals');

const ONE_HOUR = 60 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

const callerKey = (req) => ipKeyGenerator(req.ip);
// Rule 56 — in the guest's language, like every other refusal of the guest API.
const tooMany = (key) => (req) => ({ error: { code: 'TOO_MANY_REQUESTS', message: textOf(key, languageOf(req, req.guest && req.guest.stay)) } });

function createGuestLimiters() {
  return {
    session: rateLimit({
      keyGenerator: callerKey,
      windowMs: Number(process.env.GUEST_SESSION_RATELIMIT_WINDOW_MS) || ONE_HOUR,
      max: Number(process.env.GUEST_SESSION_RATELIMIT_MAX) || 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: tooMany('tooManyRequests'),
    }),
    lookup: rateLimit({
      keyGenerator: callerKey,
      windowMs: Number(process.env.GUEST_LOOKUP_RATELIMIT_WINDOW_MS) || FIFTEEN_MIN,
      max: Number(process.env.GUEST_LOOKUP_RATELIMIT_MAX) || 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: tooMany('tooManyAttempts'),
    }),
    order: rateLimit({
      keyGenerator: (req) => (req.guest && req.guest.session ? `guest-session:${req.guest.session.id}` : callerKey(req)),
      windowMs: Number(process.env.GUEST_ORDER_RATELIMIT_WINDOW_MS) || ONE_HOUR,
      max: Number(process.env.GUEST_ORDER_RATELIMIT_MAX) || 10,
      standardHeaders: true,
      legacyHeaders: false,
      skipFailedRequests: true,
      message: tooMany('tooManyOrders'),
    }),
    cardOrder: rateLimit({
      keyGenerator: (req) => `guest-stay:${req.guest.stay.id}`,
      skip: (req) => !(req.body && req.body.payment === 'card'),
      windowMs: Number(process.env.GUEST_CARD_ORDER_RATELIMIT_WINDOW_MS) || ONE_HOUR,
      max: Number(process.env.GUEST_CARD_ORDER_RATELIMIT_MAX) || 6,
      standardHeaders: true,
      legacyHeaders: false,
      skipFailedRequests: true,
      message: tooMany('tooManyCardOrders'),
    }),
  };
}

module.exports = { createGuestLimiters };
