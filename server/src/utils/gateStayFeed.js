/**
 * The stay feed — what guestFlow publishes to the house
 * (specs/gate-access-sowel-connector.md §3.1).
 *
 * ## Why it is computed on READ rather than written by hooks
 *
 * The previous version of this feature wrote an outbox row in every path that touches a
 * reservation: the form, an accepted devis, an iCal import, an approved date drift, a platform
 * cancellation, a deletion. Six paths — and its own test plan admitted that two of them had
 * « nothing to hook ». A forgotten hook is not visible: it is discovered the day a guest stands in
 * front of the gate with a code nobody ever sent.
 *
 * Here nobody hooks anything. The reconciler compares the current state of the stays against the
 * last published snapshot and appends a row for whatever moved. It follows that:
 *
 *   - no write path is touched, so none can be forgotten — a future import, a hand-made fix in the
 *     database, a restore from backup are all seen like the rest;
 *   - a deletion detects itself (the reservation is simply no longer there);
 *   - deployment has nothing to backfill: the first read publishes everything;
 *   - and the cost is one query over the unfinished stays, once a minute.
 *
 * The revision number is the consumer's cursor. It never goes backwards, and the house ignores a
 * revision it has already seen — so a page replayed after a restart changes nothing.
 */

const { computeWindow } = require('./gateWindow');

/**
 * The feed, bound to a database. The factory exists for the tests: the rule lives here and is
 * verified against an in-memory database, with no server and no clock.
 */
function createGateStayFeed(db) {
/** How long after a stay ends its row is still watched. */
const WATCH_DAYS_AFTER_END = 30;
/** A stay's superseded rows are purged past this age. */
const PURGE_AFTER_DAYS = 90;

const ymd = (date) => date.toISOString().slice(0, 10);

/**
 * The stays under watch: the ones that have not finished, the ones that just did, and recent
 * cancellations — a cancellation must go out even on yesterday's stay.
 */
function watchedStays(now) {
  const from = new Date(now.getTime() - WATCH_DAYS_AFTER_END * 86400000);
  return db.prepare(`
    SELECT r.id, r.reservationNumber, r.kind, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
           p.name AS propertyName, c.firstName AS clientFirstName
    FROM reservations r
    LEFT JOIN properties p ON p.id = r.propertyId
    LEFT JOIN clients c ON c.id = r.clientId
    WHERE r.kind IN ('reservation', 'cancelled')
      AND r.endDate >= ?
    ORDER BY r.id
  `).all(ymd(from));
}

/** The published snapshot — exactly what the house consumes. */
function snapshotOf(row) {
  const window = String(row.kind) === 'cancelled' ? null : computeWindow(row);
  return {
    reservationId: Number(row.id),
    reservationNumber: row.reservationNumber ? String(row.reservationNumber) : null,
    property: row.propertyName ? String(row.propertyName) : null,
    // The first name only: it is what the guest reads at the top of their own page, and there is
    // no reason to send a family name to an equipment that opens a gate.
    guestName: row.clientFirstName ? String(row.clientFirstName).trim() : null,
    startsAt: window ? window.start.toISOString() : null,
    endsAt: window ? window.end.toISOString() : null,
    state: String(row.kind) === 'cancelled' ? 'cancelled' : 'active',
  };
}

function latestByReservation() {
  const rows = db.prepare(`
    SELECT f.reservationId, f.revision, f.state, f.payload
    FROM gate_stay_feed f
    JOIN (
      SELECT reservationId, MAX(revision) AS revision FROM gate_stay_feed GROUP BY reservationId
    ) last ON last.reservationId = f.reservationId AND last.revision = f.revision
  `).all();
  const map = new Map();
  for (const row of rows) map.set(Number(row.reservationId), row);
  return map;
}

function append(reservationId, state, payload) {
  return db.prepare(
    'INSERT INTO gate_stay_feed (reservationId, state, payload, createdAt) VALUES (?, ?, ?, ?)',
  ).run(Number(reservationId), state, JSON.stringify(payload), new Date().toISOString()).lastInsertRowid;
}

/**
 * Publishes whatever changed. Idempotent: two calls in a row append nothing the second time.
 * @returns {{ appended: number }}
 */
function reconcile(now = new Date()) {
  const latest = latestByReservation();
  const seen = new Set();
  let appended = 0;

  for (const row of watchedStays(now)) {
    seen.add(Number(row.id));
    const snapshot = snapshotOf(row);
    const previous = latest.get(Number(row.id));
    if (previous && previous.payload === JSON.stringify(snapshot)) continue;
    append(row.id, snapshot.state, snapshot);
    appended++;
  }

  // What the house believes it knows and we no longer watch: either the reservation was deleted —
  // which has to be said, an access with no stay behind it must not stay open — or it has simply
  // left the watch window, and its access ends on its own date. The two are told apart by looking
  // at whether the row still exists.
  const exists = db.prepare('SELECT 1 FROM reservations WHERE id = ?');
  for (const [reservationId, previous] of latest) {
    if (seen.has(reservationId) || previous.state === 'deleted') continue;
    if (exists.get(reservationId)) continue;
    append(reservationId, 'deleted', { reservationId, state: 'deleted' });
    appended++;
  }

  return { appended };
}

/**
 * The page the house reads. Always preceded by a reconciliation: the feed exists only to be read,
 * and computing it anywhere else would mean computing it on a timer for nothing.
 */
function readSince(cursor, limit = 200) {
  reconcile();
  const since = Number.isFinite(Number(cursor)) ? Math.max(0, Number(cursor)) : 0;
  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = db.prepare(
    'SELECT revision, reservationId, state, payload FROM gate_stay_feed WHERE revision > ? ORDER BY revision LIMIT ?',
  ).all(since, size + 1);

  const page = rows.slice(0, size).map((row) => ({
    revision: Number(row.revision),
    ...JSON.parse(row.payload),
    state: String(row.state),
  }));
  return {
    stays: page,
    cursor: page.length ? page[page.length - 1].revision : since,
    hasMore: rows.length > size,
  };
}

/**
 * Deletes rows that are both superseded and old. Never one without the other: a consumer that has
 * fallen behind must always be able to catch up on the latest state of everything, even when it
 * missed the steps that led there.
 */
function purge(now = new Date()) {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86400000).toISOString();
  const result = db.prepare(`
    DELETE FROM gate_stay_feed
    WHERE createdAt < ?
      AND revision < (SELECT MAX(revision) FROM gate_stay_feed f WHERE f.reservationId = gate_stay_feed.reservationId)
  `).run(cutoff);
  return { deleted: result.changes };
}

  return { reconcile, readSince, purge, __test: { snapshotOf, watchedStays } };
}

module.exports = createGateStayFeed;
module.exports.createGateStayFeed = createGateStayFeed;
/** The application's instance, bound to the real database. */
let defaultFeed = null;
module.exports.feed = () => {
  if (!defaultFeed) defaultFeed = createGateStayFeed(require('../database'));
  return defaultFeed;
};
