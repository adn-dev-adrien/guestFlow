/**
 * Nights held by another stay (specs/payment-link-lifecycle.md rules 10, 11, 37, 39, 46, 48).
 *
 *   heldOverlaps(database, { propertyId, startDate, endDate, excludeIds })
 *       → the stays that hold their dates (stayMoney.holdsDates) and block a night of [startDate, endDate),
 *         in start order; a neighbour's late check-out or early check-in counts, as for the public `pay`
 *   answeringStay(database, rowId)  → the row a devis became when it was converted, else the row itself
 *   takenByOf(database, rowId)      → the first stay holding the nights of an UNPAID devis or reservation, or null
 *   datesTakenRefusal(database, rowId) → 409 DATES_UNAVAILABLE for a mint on such a row (rule 11), or null
 *   datesTakenMarker(database, row) → `{ label, takenBy: { id, label, url } }` for a devis or a reservation whose
 *                                     nights another stay holds (rule 48), or null
 *   stayRefs(database, rows, year)  → `[{ id, label, url }]`, the ConflictList shape (rules 40, 46)
 *   withdrawForStay(database, stayId, { deactivate? }) → rule 32: the links rule 10 withdraws because this stay
 *                                     appeared on nights or moved onto them; their deactivation follows the commit
 */

const { buildOccupiedDatesFromReservations, addIsoDays, timeColumnsOf, rangeHasBlockedNight } = require('./occupancy');
const { holdsDates, carriesMoney } = require('./stayMoney');

const DATES_UNAVAILABLE = Object.freeze({
  httpStatus: 409, error: 'DATES_UNAVAILABLE', message: 'Dates déjà prises par une autre réservation : aucun lien créé.',
});

const reservationUrl = (id) => `/reservations/${Number(id)}`;

const schemaReady = new WeakMap();
// A minimal schema (a unit suite's) without the stay kind or its platform holds nothing.
function readsHolds(database) {
  if (!schemaReady.has(database)) {
    const columns = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
    schemaReady.set(database, ['kind', 'platform', 'propertyId'].every((name) => columns.has(name)));
  }
  return schemaReady.get(database);
}

function heldOverlaps(database, { propertyId, startDate, endDate, excludeIds = [] }) {
  if (propertyId == null || !startDate || !endDate || !readsHolds(database)) return [];
  const excluded = excludeIds.filter((id) => id != null).map(Number);
  const columns = ['id', 'kind', 'platform', 'propertyId', 'startDate', 'endDate', ...timeColumnsOf(database)];
  const rows = database.prepare(`
    SELECT ${columns.join(', ')} FROM reservations
     WHERE kind = 'reservation' AND propertyId = ? AND endDate > ? AND startDate < ?
       ${excluded.length ? `AND id NOT IN (${excluded.map(() => '?').join(', ')})` : ''}
     ORDER BY startDate, id
  `).all(Number(propertyId), addIsoDays(startDate, -1), addIsoDays(endDate, 1), ...excluded);
  return rows.filter((row) => holdsDates(database, row)
    && rangeHasBlockedNight(startDate, endDate, buildOccupiedDatesFromReservations([row])));
}

function answeringStay(database, rowId) {
  const row = database.prepare('SELECT id, kind, convertedReservationId, propertyId, startDate, endDate FROM reservations WHERE id = ?').get(Number(rowId));
  if (!row) return null;
  if (!row.convertedReservationId) return { row, stay: row };
  const stay = database.prepare('SELECT id, kind, convertedReservationId, propertyId, startDate, endDate FROM reservations WHERE id = ?').get(Number(row.convertedReservationId));
  return { row, stay: stay || row };
}

// Rule 10 — a devis not converted, or a reservation, with no money on it: another stay holding the nights takes
// them. The row itself and the stay its devis became never count.
function takenByOf(database, rowId) {
  const found = answeringStay(database, rowId);
  if (!found || !['devis', 'reservation'].includes(String(found.stay.kind))) return null;
  if (carriesMoney(database, found.stay.id)) return null;
  const [first] = heldOverlaps(database, { ...found.stay, excludeIds: [found.row.id, found.stay.id] });
  return first || null;
}

function datesTakenRefusal(database, rowId) {
  return takenByOf(database, rowId) ? { ...DATES_UNAVAILABLE } : null;
}

function stayRefs(database, rows, year = null) {
  const { shortDate } = require('./reservationLedger');
  const { guestName } = require('./paymentLinkLabel');
  const columns = new Set(database.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
  const read = database.prepare(`
    SELECT r.id, ${columns.has('reservationNumber') ? 'r.reservationNumber' : 'NULL AS reservationNumber'}, r.startDate, r.endDate,
           c.firstName, c.lastName
      FROM reservations r LEFT JOIN clients c ON c.id = r.clientId WHERE r.id = ?
  `);
  return rows.map((row) => {
    const stay = read.get(Number(row.id)) || row;
    const span = `${shortDate(stay.startDate, year)} → ${shortDate(stay.endDate, year)}`;
    return {
      id: Number(stay.id),
      label: [stay.reservationNumber || `#${stay.id}`, guestName(stay), span].filter(Boolean).join(' · '),
      url: reservationUrl(stay.id),
    };
  });
}

// Review of #907 (n1) — only a devis still open (draft, sent, accepted) and a stay not over yet are marked.
const OPEN_DEVIS_STATUSES = new Set(['draft', 'sent', 'accepted']);

function datesTakenMarker(database, row) {
  if (!row || row.id == null) return null;
  if (String(row.kind) === 'devis' && (row.convertedReservationId || !OPEN_DEVIS_STATUSES.has(String(row.devisStatus || 'draft')))) return null;
  if (row.endDate && String(row.endDate).slice(0, 10) <= require('./localDate').localIsoDate(new Date())) return null;
  const holder = takenByOf(database, row.id);
  if (!holder) return null;
  const [takenBy] = stayRefs(database, [holder], String(row.startDate || '').slice(0, 4));
  return { label: 'Dates prises', takenBy };
}

function scheduleDeactivation(database, links) {
  setImmediate(() => {
    const appDb = require('../database');
    if (database !== appDb) return;
    const provider = require('./paymentProviders').active();
    if (!provider) return;
    const { retryPendingCancellations } = require('./paymentPollRunner');
    const deps = { ...require('./paymentEffectDeps').buildPaymentEffectDeps(), provider };
    (async () => {
      for (const link of links) {
        if (!link.remoteCancelPendingAt) continue;
        await retryPendingCancellations({ ...deps, only: link.id });
      }
    })().catch((err) => console.error('[payments] dates-taken deactivation:', err && err.message ? err.message : err));
  });
}

function withdrawForStay(database, stayId, { deactivate = scheduleDeactivation, now = new Date() } = {}) {
  const stay = database.prepare('SELECT id, propertyId, startDate, endDate FROM reservations WHERE id = ?').get(Number(stayId));
  if (!stay) return [];
  // Review of #907 (M1) — a side concern: a throw here never rolls back the caller (the iCal import, a save that
  // succeeded). Its own savepoint undoes a half-done withdrawal; the lifecycle pass (rule 16) catches it later.
  let links;
  const wasInTx = database.inTransaction;
  try {
    links = database.transaction(() => require('./paymentLinkLifecycle').withdrawLinksOverlapping(database, { ...stay, causeId: stay.id, now }))();
  } catch (err) {
    // Re-review of #907 (N1) — SQLite aborted the caller's whole transaction (disk full, I/O): going on would run
    // the rest of the caller in autocommit. The caller fails as a whole instead.
    if (wasInTx && !database.inTransaction) throw err;
    console.warn(`[payments] dates-taken withdrawal for stay ${stay.id} skipped, left to the lifecycle pass: ${(err && err.message) || err}`);
    return [];
  }
  if (links.length > 0 && typeof deactivate === 'function') deactivate(database, links);
  return links;
}

module.exports = {
  heldOverlaps, answeringStay, takenByOf, datesTakenRefusal, datesTakenMarker, stayRefs, withdrawForStay, scheduleDeactivation, DATES_UNAVAILABLE,
};
