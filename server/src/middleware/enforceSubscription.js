/**
 * Read-only guard for an unpaid instance (specs/control-plane-plans-and-access.md rules 14, 16) —
 * runs on `/api/*` after the auth and role guards.
 *
 * While the licence says `read_only` (or `suspended`/`archived`, or is missing on a managed
 * install), every write answers 402 SUBSCRIPTION_READ_ONLY. Reads and exports keep working, and so
 * does what protects guests who are still arriving: the calendar sync that prevents double bookings,
 * and collecting a payment on an existing reservation. `isReadOnly` is injectable for tests.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths are relative to `/api`.
const ALLOWED_WRITES = [
  ['POST', /^\/properties\/\d+\/ical-sources\/(\d+\/sync|sync-all)$/],
  ['POST', /^\/google-calendar\/sync-now$/],
  ['POST', /^\/payments\/poll$/],
  ['POST', /^\/payments\/reservations\/\d+\/(payment-links|payment-emails)$/],
  ['PATCH', /^\/reservations\/\d+\/payment$/],
  ['POST', /^\/reservations\/\d+\/arrival-payment$/],
  ['POST', /^\/push\/subscribe$/],
  ['DELETE', /^\/push\/subscribe$/],
  // Computations sent as POST that write nothing: opening a reservation recomputes its price.
  ['POST', /^\/reservations\/calculate-price$/],
  ['POST', /^\/properties\/\d+\/pricing\/progressive-preview$/],
  ['POST', /^\/terms\/preview$/],
  // Support and account safety stay in reach of an unpaid customer (specs/hosting-h2-account-security.md).
  ['POST', /^\/support-access\/(\d+\/(decide|revoke)|page)$/],
  ['DELETE', /^\/users\/\d+\/two-factor$/],
];

const READ_ONLY_BODY = {
  error: 'SUBSCRIPTION_READ_ONLY',
  message: 'Modification impossible : abonnement à renouveler.',
};

function isAllowedWrite(method, path) {
  return ALLOWED_WRITES.some(([m, re]) => m === method && re.test(path));
}

function enforceSubscription({ isReadOnly, isWebhook } = {}) {
  const readOnly = isReadOnly || (() => require('../utils/licence').isReadOnly());
  const webhook = isWebhook || ((method, path) => require('../plugins/loader').isWebhook(method, path));
  return function enforceSubscriptionMiddleware(req, res, next) {
    if (READ_METHODS.has(req.method)) return next();
    if (!readOnly()) return next();
    if (isAllowedWrite(req.method, req.path)) return next();
    // A provider calling back about a payment (specs/plugins-phase-3a-online-payment.md rule 12).
    if (webhook(req.method, req.path)) return next();
    return res.status(402).json(READ_ONLY_BODY);
  };
}

// The website takes no new booking while the instance is read-only; its quote and the payment of an
// existing booking keep working (rule 14).
function closedWhenReadOnly({ isReadOnly } = {}) {
  const readOnly = isReadOnly || (() => require('../utils/licence').isReadOnly());
  return function closedWhenReadOnlyMiddleware(req, res, next) {
    if (!readOnly()) return next();
    return res.status(503).json({ error: 'BOOKING_UNAVAILABLE', message: 'Réservations en ligne momentanément indisponibles.' });
  };
}

module.exports = { enforceSubscription, closedWhenReadOnly, isAllowedWrite, READ_ONLY_BODY };
