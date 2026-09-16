/**
 * Payment links model — sole DB access for `payment_links`
 * (specs/online-payments-qonto.md §5).
 *
 * One row per Qonto payment link issued for a reservation/devis (deposit / balance / full /
 * complement). The polling pass reads `status='open'` rows, checks Qonto, and flips them to `paid`.
 * Amounts are stored in **cents** (integer, exact — never float euros).
 *
 * API:
 *   create({ reservationId, type, amountCents, currency?, qontoPaymentLinkId?, url?, status?, expiresAt? }) → row
 *   listOpen()                              → all status='open' rows
 *   retireExpired({ now })                  → flips open links past a known expiresAt to 'expired'; returns them
 *   listPollable({ now, force, cadence })   → the open links due for a provider check (the polling worklist)
 *   touchPolled(id, at?)                    → stamps lastPolledAt (every provider call made for a link)
 *   hasKnownExpiry(link)                    → whether the link carries a real expiry date
 *   listForReservation(reservationId)       → every link for a reservation, newest first
 *   findOpenForReservation(reservationId, type) → the current open link of that type, or undefined
 *   markPaid(id, { qontoPaymentId, paidAt }) → flips open|expired→paid (idempotent: a paid/cancelled row is untouched)
 *   updateStatus(id, status)                → 'open'|'paid'|'expired'|'cancelled'
 *   findById(id)
 *
 * Poll cadence (specs/payment-polling-fair-use.md rules 1, 3, 4, 9): a link is due every pass while
 * younger than `freshHours`, at most every `warmIntervalMinutes` until `warmDays`, then at most every
 * `coldIntervalMinutes` — measured from its persisted `lastPolledAt`, so a restart resets nothing.
 */

const VALID_TYPES = new Set(['deposit', 'balance', 'full', 'complement']);
const VALID_STATUSES = new Set(['open', 'paid', 'expired', 'cancelled']);

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const POLL_CADENCE_DEFAULTS = Object.freeze({ freshHours: 24, warmDays: 7, warmIntervalMinutes: 60, coldIntervalMinutes: 24 * 60 });

function positiveNumber(value, fallback) {
  const n = Number(value);
  return value != null && String(value).trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolvePollCadence(env = process.env) {
  return {
    freshHours: positiveNumber(env.PAYMENT_POLL_FRESH_HOURS, POLL_CADENCE_DEFAULTS.freshHours),
    warmDays: positiveNumber(env.PAYMENT_POLL_WARM_DAYS, POLL_CADENCE_DEFAULTS.warmDays),
    warmIntervalMinutes: positiveNumber(env.PAYMENT_POLL_WARM_INTERVAL_MINUTES, POLL_CADENCE_DEFAULTS.warmIntervalMinutes),
    coldIntervalMinutes: positiveNumber(env.PAYMENT_POLL_COLD_INTERVAL_MINUTES, POLL_CADENCE_DEFAULTS.coldIntervalMinutes),
  };
}

// SQLite's datetime('now') writes `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker; Date.parse would
// read that as local time.
function parseTimestampMs(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// In production Qonto returns `expiration_date: "0001-01-01T00:00:00Z"` (Go's zero time) for links that
// have no expiry. Read as a date, that is two thousand years in the past: every link would be retired on
// the first pass and payment detection would silently stop. Anything at or before the Unix epoch is that
// sentinel, i.e. "no known expiry".
function knownExpiryMs(expiresAt) {
  const ms = parseTimestampMs(expiresAt);
  return ms != null && ms > 0 ? ms : null;
}

function isPollDue(link, nowMs, cadence = POLL_CADENCE_DEFAULTS) {
  const lastMs = parseTimestampMs(link.lastPolledAt);
  if (lastMs == null) return true;
  const createdMs = parseTimestampMs(link.createdAt);
  const ageMs = createdMs == null ? 0 : nowMs - createdMs;
  if (ageMs < cadence.freshHours * HOUR_MS) return true;
  const intervalMinutes = ageMs < cadence.warmDays * 24 * HOUR_MS ? cadence.warmIntervalMinutes : cadence.coldIntervalMinutes;
  return nowMs - lastMs >= intervalMinutes * MINUTE_MS;
}

function buildModel(database) {
  const SELECT_COLS = `id, reservationId, type, qontoPaymentLinkId, url, amountCents, currency,
    status, qontoPaymentId, createdAt, paidAt, expiresAt, lastPolledAt`;

  const insertStmt = database.prepare(`
    INSERT INTO payment_links
      (reservationId, type, qontoPaymentLinkId, url, amountCents, currency, status, expiresAt)
    VALUES
      (@reservationId, @type, @qontoPaymentLinkId, @url, @amountCents, @currency, @status, @expiresAt)
  `);

  function findById(id) {
    return database.prepare(`SELECT ${SELECT_COLS} FROM payment_links WHERE id = ?`).get(Number(id));
  }

  function create(payload) {
    const type = String(payload.type || '');
    if (!VALID_TYPES.has(type)) throw new Error(`Invalid payment link type: ${type}`);
    const status = payload.status ? String(payload.status) : 'open';
    if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment link status: ${status}`);
    const info = insertStmt.run({
      reservationId: Number(payload.reservationId),
      type,
      qontoPaymentLinkId: payload.qontoPaymentLinkId == null ? null : String(payload.qontoPaymentLinkId),
      url: String(payload.url || ''),
      amountCents: Math.round(Number(payload.amountCents || 0)),
      currency: String(payload.currency || 'EUR'),
      status,
      expiresAt: payload.expiresAt == null ? null : String(payload.expiresAt),
    });
    return findById(info.lastInsertRowid);
  }

  function listOpen() {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE status = 'open' ORDER BY id`
    ).all();
  }

  // Rule 1: no provider call — the expiry is already in our record.
  function retireExpired({ now = new Date() } = {}) {
    const nowMs = now.getTime();
    const candidates = database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE status = 'open' AND expiresAt IS NOT NULL ORDER BY id`
    ).all();
    const due = candidates.filter((link) => {
      const expiryMs = knownExpiryMs(link.expiresAt);
      return expiryMs != null && expiryMs <= nowMs;
    });
    const retire = database.prepare("UPDATE payment_links SET status = 'expired' WHERE id = ? AND status = 'open'");
    const retired = [];
    database.transaction(() => {
      for (const link of due) {
        if (Number(retire.run(link.id).changes) > 0) retired.push({ ...link, status: 'expired' });
      }
    })();
    return retired;
  }

  function listPollable({ now = new Date(), force = false, cadence = resolvePollCadence() } = {}) {
    const open = listOpen();
    if (force) return open;
    const nowMs = now.getTime();
    return open.filter((link) => isPollDue(link, nowMs, cadence));
  }

  function touchPolled(id, at = new Date()) {
    database.prepare('UPDATE payment_links SET lastPolledAt = ? WHERE id = ?').run(at.toISOString(), Number(id));
  }

  function hasKnownExpiry(link) {
    return Boolean(link) && knownExpiryMs(link.expiresAt) != null;
  }

  function listForReservation(reservationId) {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? ORDER BY id DESC`
    ).all(Number(reservationId));
  }

  function findOpenForReservation(reservationId, type) {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? AND type = ? AND status = 'open' ORDER BY id DESC LIMIT 1`
    ).get(Number(reservationId), String(type));
  }

  // Resolve a link by its Qonto id (the webhook receives the remote id, not our row id).
  function findByQontoPaymentLinkId(qontoId) {
    if (!qontoId) return undefined;
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE qontoPaymentLinkId = ? ORDER BY id DESC LIMIT 1`
    ).get(String(qontoId));
  }

  // Idempotent: only an `open` or `expired` row transitions to `paid`. `expired` is accepted because
  // rule 1 retires links on our own clock, and a payment in flight at that moment must still be
  // processed once. A late/duplicate call on an already-paid (or cancelled) row changes nothing and
  // reports it didn't flip — so the polling pass never double-processes a payment.
  function markPaid(id, { qontoPaymentId, paidAt } = {}) {
    const info = database.prepare(`
      UPDATE payment_links
         SET status = 'paid',
             qontoPaymentId = COALESCE(?, qontoPaymentId),
             paidAt = COALESCE(?, datetime('now'))
       WHERE id = ? AND status IN ('open', 'expired')
    `).run(qontoPaymentId == null ? null : String(qontoPaymentId), paidAt == null ? null : String(paidAt), Number(id));
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  function updateStatus(id, status) {
    const s = String(status);
    if (!VALID_STATUSES.has(s)) throw new Error(`Invalid payment link status: ${s}`);
    database.prepare("UPDATE payment_links SET status = ? WHERE id = ?").run(s, Number(id));
    return findById(id);
  }

  return {
    create,
    findById,
    listOpen,
    retireExpired,
    listPollable,
    touchPolled,
    hasKnownExpiry,
    listForReservation,
    findOpenForReservation,
    findByQontoPaymentLinkId,
    markPaid,
    updateStatus,
  };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

const statics = { buildModel, resolvePollCadence, isPollDue, knownExpiryMs, POLL_CADENCE_DEFAULTS };

if (defaultModel) {
  Object.assign(defaultModel, statics);
  module.exports = defaultModel;
} else {
  module.exports = statics;
}
