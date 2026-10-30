/**
 * The life of a payment link once minted (specs/payment-link-lifecycle.md §3.C, §3.D, §3.F).
 *
 * Database only, never a provider call: what the provider must then be asked (deactivate, read the
 * payment) is the poll runner's (`paymentPollRunner.runLinkLifecycle`, rule 18). `now` is injected;
 * the Paris day of rule 9 is the process's local day (utils/localDate, Europe/Paris in production).
 *
 *   validityEnd(createdAt)                         → the `expiresAt` of a link minted at `createdAt` (rule 6)
 *   validityOf(link, now)                          → { expiresAt, remainingMs, lapsed, reusable } (rules 7, 8)
 *   retireLapsedAndWithdrawn(database, { now, paymentLinksModel? }) → the links it moved out of `open` (rule 16)
 *   listLastLookDue(database, { now })             → the lapsed links whose last look is due (rule 19)
 *   lapsesAtArrival(database, link, now)           → whether rule 9 lapses this open link at the next pass (rule 51)
 *   lastLookAfter(now)                             → when the last look of a link deactivated at `now` is due
 */

const {
  PAYMENT_LINK_VALIDITY_HOURS, PAYMENT_LINK_MIN_REMAINING_HOURS, LAST_LOOK_DELAY_MINUTES, LINK_REASONS, PRE_ARRIVAL_TYPES,
} = require('../constants/paymentLinks');
const { localIsoDate } = require('./localDate');

const HOUR_MS = 60 * 60 * 1000;

const model = () => require('../models/paymentLinksModel');

function validityEnd(createdAt) {
  return new Date(createdAt.getTime() + PAYMENT_LINK_VALIDITY_HOURS * HOUR_MS).toISOString();
}

// Rule 8 — a link with no known end (Qonto's zero-time sentinel, a row from before rule 34) cannot promise
// the guest 24 hours: it is never reused, a fresh one is minted.
function validityOf(link, now = new Date()) {
  const expiresMs = model().knownExpiryMs(link && link.expiresAt);
  if (expiresMs == null) return { expiresAt: null, remainingMs: null, lapsed: false, reusable: false };
  const remainingMs = expiresMs - now.getTime();
  return {
    expiresAt: new Date(expiresMs).toISOString(),
    remainingMs,
    lapsed: remainingMs <= 0,
    reusable: remainingMs >= PAYMENT_LINK_MIN_REMAINING_HOURS * HOUR_MS,
  };
}

function lastLookAfter(now = new Date()) {
  return new Date(now.getTime() + LAST_LOOK_DELAY_MINUTES * 60 * 1000);
}

// Rule 13 — an open link of a stay that is gone (orphan) or cancelled (its own row or the stay its devis
// became) is withdrawn: the defence in depth behind the cancel and delete paths.
function withdrawGoneOrCancelled(database, links, now) {
  const rows = database.prepare(`
    SELECT l.id, CASE WHEN r.id IS NULL THEN ? END AS reason
      FROM payment_links l
      LEFT JOIN reservations r ON r.id = l.reservationId
      LEFT JOIN reservations c ON c.id = r.convertedReservationId
     WHERE l.status = 'open' AND (r.id IS NULL OR r.kind = 'cancelled' OR c.kind = 'cancelled')
     ORDER BY l.id
  `).all(LINK_REASONS.ORPHAN);
  const withdraw = database.prepare(`
    UPDATE payment_links
       SET status = 'cancelled', cancelReason = ?,
           remoteCancelPendingAt = CASE WHEN providerLinkId IS NULL OR providerLinkId = '' THEN NULL ELSE ? END
     WHERE id = ? AND status = 'open'
  `);
  return rows
    .filter((row) => Number(withdraw.run(row.reason, now.toISOString(), row.id).changes) > 0)
    .map((row) => links.findById(row.id));
}

// Rule 9 — from 00:00 Paris on the arrival day, the pre-arrival links of the stay (and of the devis it
// came from) lapse; a link minted on or after that day keeps its 36 hours. SQL selects the stays that
// began; the minting day is read in Paris time here, which SQLite cannot do.
const ARRIVED_SQL = `
    SELECT l.id, l.createdAt, COALESCE(c.startDate, r.startDate) AS startDate
      FROM payment_links l
      JOIN reservations r ON r.id = l.reservationId
      LEFT JOIN reservations c ON c.id = r.convertedReservationId
     WHERE l.status = 'open'
       AND l.type IN (${PRE_ARRIVAL_TYPES.map(() => '?').join(', ')})
       AND COALESCE(c.kind, r.kind) IN ('reservation', 'devis')
       AND COALESCE(c.startDate, r.startDate) <= ?`;

function mintedBeforeArrival(row) {
  const createdMs = model().parseTimestampMs(row.createdAt);
  return createdMs == null || localIsoDate(new Date(createdMs)) < String(row.startDate).slice(0, 10);
}

function lapseStarted(database, links, now) {
  return database.prepare(`${ARRIVED_SQL} ORDER BY l.id`).all(...PRE_ARRIVAL_TYPES, localIsoDate(now))
    .filter(mintedBeforeArrival)
    .map((row) => links.lapseIfOpen(row.id, { reason: LINK_REASONS.STAY_STARTED, now }))
    .filter(Boolean);
}

// Rule 51 — the mint asks the same question of the one link it would reuse: a link the next pass lapses
// cannot be handed to the guest as valid.
function lapsesAtArrival(database, link, now = new Date()) {
  if (!link || link.id == null) return false;
  const row = database.prepare(`${ARRIVED_SQL} AND l.id = ?`).get(...PRE_ARRIVAL_TYPES, localIsoDate(now), link.id);
  return Boolean(row && mintedBeforeArrival(row));
}

// Rule 16 — one pass, one transaction; every move is conditional on `open`, so a webhook that paid the
// link meanwhile wins. A withdrawn stay goes first, then the validity (rule 7), then the arrival (rule 9).
function retireLapsedAndWithdrawn(database, { now = new Date(), paymentLinksModel = null } = {}) {
  const links = paymentLinksModel || model().buildModel(database);
  return database.transaction(() => [
    ...withdrawGoneOrCancelled(database, links, now),
    ...links.retireExpired({ now }),
    ...lapseStarted(database, links, now),
  ])();
}

function listLastLookDue(database, { now = new Date() } = {}) {
  const { parseTimestampMs, buildModel } = model();
  const links = buildModel(database);
  return database.prepare("SELECT id, lastLookAt FROM payment_links WHERE status = 'expired' AND lastLookAt IS NOT NULL ORDER BY id")
    .all()
    .filter((row) => {
      const dueMs = parseTimestampMs(row.lastLookAt);
      return dueMs != null && dueMs <= now.getTime();
    })
    .map((row) => links.findById(row.id));
}

module.exports = { validityEnd, validityOf, lastLookAfter, retireLapsedAndWithdrawn, listLastLookDue, lapsesAtArrival };
