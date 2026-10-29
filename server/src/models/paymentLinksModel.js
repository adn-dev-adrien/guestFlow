/**
 * Payment links model — sole DB access for `payment_links`
 * (specs/online-payments-qonto.md §5, provider-neutral since specs/plugins-phase-3a-online-payment.md
 * rule 6).
 *
 * One row per payment link a provider issued for a reservation/devis (deposit / balance / full /
 * complement, or one installment of a plan — `installmentId`, specs/direct-installments.md). The polling pass reads `status='open'` rows, asks the provider, and flips them to `paid`.
 * Amounts are stored in **cents** (integer, exact — never float euros). The rows are core data: they
 * are the trace of what was asked and paid online, and outlive the provider's plugin.
 *
 * API:
 *   create({ reservationId, type, amountCents, currency?, provider?, providerLinkId?, url?, status?, expiresAt? }) → row
 *   listOpen()                              → all status='open' rows
 *   retireExpired({ now })                  → flips open links past a known expiresAt to 'expired'; returns them
 *   retireSettled()                         → cancels the open links whose bucket the stay already settled; returns them
 *   settledBucketDateOf(link)               → the day the stay recorded that link's bucket as paid, or null
 *   markRetiredLinkPaid(id, { providerPaymentId, paidAt, reason? }) → a link retired by retireSettled (or, with
 *                                           reason 'amount-changed', by retireForAmountChange) was paid: cancelled→paid
 *   retireForAmountChange(reservationId, type, newAmountCents, installmentId?) → cancels the open links of that type whose amount
 *                                           the fiche changed (specs/reservation-payment-ledger.md rule 29)
 *   listPollable({ now, force, cadence })   → the open links due for a provider check (the polling worklist)
 *   touchPolled(id, at?)                    → stamps lastPolledAt (every provider call made for a link)
 *   hasKnownExpiry(link)                    → whether the link carries a real expiry date
 *   listForReservation(reservationId)       → every link for a reservation, newest first
 *   findOpenForReservation(reservationId, type) → the current open link of that type, or undefined
 *   findOpenForInstallment(installmentId)   → the current open link of that installment, or undefined
 *   findByProviderLinkId(provider, linkId)  → the row a provider id names (webhook, retries)
 *   markPaid(id, { providerPaymentId, paidAt }) → flips open|expired→paid (idempotent: a paid/cancelled row is untouched)
 *   updateStatus(id, status)                → 'open'|'paid'|'expired'|'cancelled'
 *   cancel(id, { remotePending })           → 'cancelled', with the remote-deactivation marker when pending
 *   listRemoteCancelPending()               → cancelled rows whose deactivation at the provider is owed
 *   clearRemoteCancelPending(id, { providerPaymentId?, paidAt? }) → the provider settled it (deactivated, or paid)
 *   findById(id)
 *
 * Poll cadence (specs/payment-polling-fair-use.md rules 1, 3, 4, 9): a link is due every pass while
 * younger than `freshHours`, at most every `warmIntervalMinutes` until `warmDays`, then at most every
 * `coldIntervalMinutes` — measured from its persisted `lastPolledAt`, so a restart resets nothing.
 */

const VALID_TYPES = new Set(['deposit', 'balance', 'full', 'complement', 'installment']);
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
  const SELECT_COLS = `id, reservationId, type, provider, providerLinkId, url, amountCents, currency,
    status, providerPaymentId, createdAt, paidAt, expiresAt, lastPolledAt, remoteCancelPendingAt, cancelReason, installmentId`;

  const insertStmt = database.prepare(`
    INSERT INTO payment_links
      (reservationId, type, provider, providerLinkId, url, amountCents, currency, status, expiresAt, installmentId)
    VALUES
      (@reservationId, @type, @provider, @providerLinkId, @url, @amountCents, @currency, @status, @expiresAt, @installmentId)
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
      provider: String(payload.provider || 'qonto'),
      providerLinkId: payload.providerLinkId == null ? null : String(payload.providerLinkId),
      url: String(payload.url || ''),
      amountCents: Math.round(Number(payload.amountCents || 0)),
      currency: String(payload.currency || 'EUR'),
      status,
      expiresAt: payload.expiresAt == null ? null : String(payload.expiresAt),
      installmentId: payload.installmentId == null ? null : Number(payload.installmentId),
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

  // specs/plugins-phase-3a-online-payment.md rule 23 — a link whose bucket the stay settled another
  // way (transfer, cash, platform, a second link) is abandoned like a stale one: cancelled here with
  // the remote-deactivation marker, so the poll deactivates it at the provider — after checking it was
  // not paid in the meantime, which would be a double payment to refund. A link on a devis reads the
  // reservation the devis became.
  function retireSettled() {
    const settled = database.prepare(`
      SELECT ${SELECT_COLS.split(',').map((c) => `l.${c.trim()}`).join(', ')}
        FROM payment_links l
        JOIN reservations r ON r.id = l.reservationId
        LEFT JOIN reservations c ON c.id = r.convertedReservationId
       WHERE l.status = 'open'
         AND (
           (l.type = 'deposit' AND COALESCE(c.depositPaid, r.depositPaid, 0) = 1)
           OR (l.type IN ('balance', 'full') AND COALESCE(c.balancePaid, r.balancePaid, 0) = 1)
           OR (l.type = 'complement' AND COALESCE(c.complementPaid, r.complementPaid, 0) = 1)
           OR (l.type = 'installment' AND EXISTS (
             SELECT 1 FROM reservation_installments i WHERE i.id = l.installmentId AND i.paid = 1
           ))
         )
       ORDER BY l.id
    `).all();
    const retire = database.prepare("UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = ?, cancelReason = 'settled' WHERE id = ? AND status = 'open'");
    const retired = [];
    const at = new Date().toISOString();
    database.transaction(() => {
      for (const link of settled) {
        if (Number(retire.run(link.providerLinkId ? at : null, link.id).changes) > 0) {
          retired.push({ ...link, status: 'cancelled', remoteCancelPendingAt: link.providerLinkId ? at : null, cancelReason: 'settled' });
        }
      }
    })();
    return retired;
  }

  // Rule 24 — the day the stay recorded the bucket of a link retired by rule 23 (a link on a devis
  // reads the reservation the devis became); null when unknown or no longer paid.
  function settledBucketDateOf(link) {
    if (link && link.type === 'installment') {
      const installment = database.prepare('SELECT paid, paidDate FROM reservation_installments WHERE id = ?').get(Number(link.installmentId));
      return installment && Number(installment.paid) === 1 && installment.paidDate ? String(installment.paidDate).slice(0, 10) : null;
    }
    const col = { deposit: 'depositPaid', balance: 'balancePaid', full: 'balancePaid', complement: 'complementPaid' }[link && link.type];
    if (!col) return null;
    const row = database.prepare(`
      SELECT COALESCE(c.id, r.id) AS id FROM reservations r
        LEFT JOIN reservations c ON c.id = r.convertedReservationId
       WHERE r.id = ?
    `).get(Number(link.reservationId));
    if (!row) return null;
    const stay = database.prepare(`SELECT ${col} AS paid, ${col}Date AS paidDate FROM reservations WHERE id = ?`).get(row.id);
    return stay && Number(stay.paid) === 1 && stay.paidDate ? String(stay.paidDate).slice(0, 10) : null;
  }

  // Rule 24 — a link retired by rule 23 that the guest had paid IS the payment that settled the bucket:
  // it becomes `paid` with the provider's payment, and its deactivation is no longer owed.
  function markRetiredLinkPaid(id, { providerPaymentId = null, paidAt = null, reason = 'settled' } = {}) {
    const info = database.prepare(`
      UPDATE payment_links
         SET status = 'paid',
             remoteCancelPendingAt = NULL,
             providerPaymentId = COALESCE(?, providerPaymentId),
             paidAt = COALESCE(?, paidAt, datetime('now'))
       WHERE id = ? AND status = 'cancelled' AND cancelReason = ?
    `).run(providerPaymentId == null ? null : String(providerPaymentId), paidAt == null ? null : String(paidAt), Number(id), String(reason));
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  // specs/reservation-payment-ledger.md rule 29 (§9 Q3) — the fiche changed the amount an open link
  // bills: the link is abandoned at once, with the remote-deactivation marker so the poll deactivates
  // it at the provider (rule 8) and books it if the guest paid it anyway (rule 31).
  function retireForAmountChange(reservationId, type, newAmountCents, installmentId = null) {
    const open = installmentId == null
      ? database.prepare(
        `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? AND type = ? AND status = 'open' ORDER BY id`
      ).all(Number(reservationId), String(type))
      : database.prepare(
        `SELECT ${SELECT_COLS} FROM payment_links WHERE reservationId = ? AND type = ? AND installmentId = ? AND status = 'open' ORDER BY id`
      ).all(Number(reservationId), String(type), Number(installmentId));
    const retire = database.prepare("UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = ?, cancelReason = 'amount-changed' WHERE id = ? AND status = 'open'");
    const at = new Date().toISOString();
    const retired = [];
    database.transaction(() => {
      for (const link of open) {
        if (Number(link.amountCents) === Math.round(Number(newAmountCents))) continue;
        const pending = link.providerLinkId ? at : null;
        if (Number(retire.run(pending, link.id).changes) > 0) {
          retired.push({ ...link, status: 'cancelled', remoteCancelPendingAt: pending, cancelReason: 'amount-changed' });
        }
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

  function findOpenForInstallment(installmentId) {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE type = 'installment' AND installmentId = ? AND status = 'open' ORDER BY id DESC LIMIT 1`
    ).get(Number(installmentId));
  }

  // Resolve a link by its provider id (the webhook receives the remote id, not our row id).
  function findByProviderLinkId(provider, linkId) {
    if (!linkId) return undefined;
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE provider = ? AND providerLinkId = ? ORDER BY id DESC LIMIT 1`
    ).get(String(provider), String(linkId));
  }

  // Idempotent: only an `open` or `expired` row transitions to `paid`. `expired` is accepted because
  // rule 1 retires links on our own clock, and a payment in flight at that moment must still be
  // processed once. A late/duplicate call on an already-paid (or cancelled) row changes nothing and
  // reports it didn't flip — so the polling pass never double-processes a payment.
  function markPaid(id, { providerPaymentId, paidAt } = {}) {
    const info = database.prepare(`
      UPDATE payment_links
         SET status = 'paid',
             providerPaymentId = COALESCE(?, providerPaymentId),
             paidAt = COALESCE(?, datetime('now'))
       WHERE id = ? AND status IN ('open', 'expired')
    `).run(providerPaymentId == null ? null : String(providerPaymentId), paidAt == null ? null : String(paidAt), Number(id));
    return { flipped: Number(info.changes) > 0, row: findById(id) };
  }

  function updateStatus(id, status) {
    const s = String(status);
    if (!VALID_STATUSES.has(s)) throw new Error(`Invalid payment link status: ${s}`);
    database.prepare("UPDATE payment_links SET status = ? WHERE id = ?").run(s, Number(id));
    return findById(id);
  }

  // specs/plugins-phase-3a-online-payment.md rule 7 — the row is abandoned locally at once; when the
  // provider could not deactivate it, the marker keeps it on the poll's retry list (rule 8).
  function cancel(id, { remotePending = false } = {}) {
    database.prepare("UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = ? WHERE id = ? AND status != 'paid'")
      .run(remotePending ? new Date().toISOString() : null, Number(id));
    return findById(id);
  }

  // Two overlapping retry passes can both find the same owed deactivation paid: the one whose UPDATE
  // clears the marker owns the booking, the other does nothing.
  function claimRemoteCancelPending(id) {
    return Number(database.prepare('UPDATE payment_links SET remoteCancelPendingAt = NULL WHERE id = ? AND remoteCancelPendingAt IS NOT NULL')
      .run(Number(id)).changes) === 1;
  }

  function restoreRemoteCancelPending(id) {
    database.prepare("UPDATE payment_links SET remoteCancelPendingAt = ? WHERE id = ? AND status = 'cancelled'")
      .run(new Date().toISOString(), Number(id));
  }

  function listRemoteCancelPending() {
    return database.prepare(
      `SELECT ${SELECT_COLS} FROM payment_links WHERE status = 'cancelled' AND remoteCancelPendingAt IS NOT NULL ORDER BY id`
    ).all();
  }

  // The provider settled a pending deactivation: deactivated, or — rule 8 — paid after all, in which
  // case the payment's id and date stay on the row for the refund.
  function clearRemoteCancelPending(id, { providerPaymentId = null, paidAt = null } = {}) {
    database.prepare(`
      UPDATE payment_links
         SET remoteCancelPendingAt = NULL,
             providerPaymentId = COALESCE(?, providerPaymentId),
             paidAt = COALESCE(?, paidAt)
       WHERE id = ?
    `).run(providerPaymentId == null ? null : String(providerPaymentId), paidAt == null ? null : String(paidAt), Number(id));
    return findById(id);
  }

  return {
    create,
    findById,
    listOpen,
    retireExpired,
    retireSettled,
    settledBucketDateOf,
    markRetiredLinkPaid,
    retireForAmountChange,
    listPollable,
    touchPolled,
    hasKnownExpiry,
    listForReservation,
    findOpenForReservation,
    findOpenForInstallment,
    findByProviderLinkId,
    markPaid,
    updateStatus,
    cancel,
    claimRemoteCancelPending,
    restoreRemoteCancelPending,
    listRemoteCancelPending,
    clearRemoteCancelPending,
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
