/**
 * What each property's iCal export last published, and what recently left it
 * (specs/lodgify-decommission.md §3 rule 7).
 *
 * Booking.com re-imports GuestFlow's feed on its own schedule, so for a few hours after a stay is
 * cancelled, moved or deleted, Booking still exports those dates as « CLOSED - Not available ». A
 * tombstone lets the Booking echo filter recognise that echo instead of turning it into a phantom
 * Booking reservation. Tombstones come from diffing the published ranges against a snapshot, so no
 * code path that removes or moves a reservation has to remember to write one.
 */
const db = require('../database');

const TOMBSTONE_COVER_HOURS = 72;
const TOMBSTONE_PURGE_DAYS = 7;

function createModel(database) {
  const listPublished = database.prepare(`
    SELECT DISTINCT startDate, endDate FROM reservations
    WHERE propertyId = ? AND kind = 'reservation' AND startDate IS NOT NULL AND endDate IS NOT NULL
  `);
  const listSnapshot = database.prepare('SELECT startDate, endDate FROM ical_export_ranges WHERE propertyId = ?');
  const deleteSnapshot = database.prepare('DELETE FROM ical_export_ranges WHERE propertyId = ?');
  const insertSnapshot = database.prepare('INSERT OR IGNORE INTO ical_export_ranges (propertyId, startDate, endDate) VALUES (?, ?, ?)');
  const insertTombstone = database.prepare('INSERT INTO ical_export_tombstones (propertyId, startDate, endDate) VALUES (?, ?, ?)');
  const listTombstones = database.prepare(`
    SELECT startDate, endDate, removedAt FROM ical_export_tombstones
    WHERE propertyId = ? AND datetime(removedAt) > datetime('now', ?)
  `);
  const purgeTombstones = database.prepare("DELETE FROM ical_export_tombstones WHERE datetime(removedAt) <= datetime('now', ?)");

  const key = (r) => `${r.startDate}|${r.endDate}`;

  // Diff the property's published ranges against the last snapshot: every range that disappeared
  // becomes a tombstone, then the snapshot is replaced. Returns the number of tombstones written.
  const refresh = database.transaction((propertyId) => {
    const current = listPublished.all(propertyId);
    const currentKeys = new Set(current.map(key));
    const removed = listSnapshot.all(propertyId).filter((r) => !currentKeys.has(key(r)));
    removed.forEach((r) => insertTombstone.run(propertyId, r.startDate, r.endDate));
    deleteSnapshot.run(propertyId);
    current.forEach((r) => insertSnapshot.run(propertyId, r.startDate, r.endDate));
    return removed.length;
  });

  return {
    refresh,
    listActiveTombstones(propertyId, hours = TOMBSTONE_COVER_HOURS) {
      return listTombstones.all(propertyId, `-${Number(hours)} hours`);
    },
    purge(days = TOMBSTONE_PURGE_DAYS) {
      return purgeTombstones.run(`-${Number(days)} days`).changes;
    },
  };
}

let defaultModel = null;
function getDefault() {
  if (!defaultModel) defaultModel = createModel(db);
  return defaultModel;
}

module.exports = {
  create: createModel,
  refresh: (propertyId) => getDefault().refresh(propertyId),
  listActiveTombstones: (propertyId, hours) => getDefault().listActiveTombstones(propertyId, hours),
  purge: (days) => getDefault().purge(days),
  TOMBSTONE_COVER_HOURS,
  TOMBSTONE_PURGE_DAYS,
};
