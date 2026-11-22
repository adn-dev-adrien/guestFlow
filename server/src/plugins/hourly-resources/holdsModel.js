/**
 * `resource_booking_holds` — a slot held for a few minutes while the money for it is on its way (rule 29 of the campaigns spec, the one
 * exception to « nothing is booked before the bank confirms »). A hold blocks its slot in every availability read — the occupancy model hands it to the
 * planning, the guest app's slots, the outside bookings and the checks of a write — until it is released (the booking was made, or the buyer gave up)
 * or its `expiresAt` passes: an expired hold blocks nothing the second it lapses, whether or not the job has marked it yet.
 *
 *   hold({ resourceId, date, start, end, ref, minutes })   → { expiresAt }; the previous active hold of the same `ref` is replaced
 *   release(ref)                                            → whether an active hold was released
 *   activeIn({ resourceId, from, to, excludeRef? })         → the active holds of a resource between two ISO days
 *   find(ref)                                               → the active hold of `ref`, or null
 *   expire()                                                → how many lapsed holds the job marked released
 */

const HOLD_MINUTES = 15;

const hasTable = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resource_booking_holds'").get());

function createHoldsModel(db, { now = () => new Date() } = {}) {
  const present = () => hasTable(db);
  const at = () => now().toISOString();

  function hold({
    resourceId, date, start, end, ref, minutes = HOLD_MINUTES,
  }) {
    const expiresAt = new Date(now().getTime() + minutes * 60 * 1000).toISOString();
    db.transaction(() => {
      db.prepare('UPDATE resource_booking_holds SET releasedAt = ? WHERE ref = ? AND releasedAt IS NULL').run(at(), String(ref));
      db.prepare(`INSERT INTO resource_booking_holds (resourceId, date, startTime, endTime, ref, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(resourceId), date, start, end, String(ref), expiresAt, at());
    })();
    return { expiresAt };
  }

  function release(ref) {
    if (!present()) return false;
    return db.prepare('UPDATE resource_booking_holds SET releasedAt = ? WHERE ref = ? AND releasedAt IS NULL').run(at(), String(ref)).changes > 0;
  }

  function activeIn({
    resourceId, from, to, excludeRef = null,
  }) {
    if (!present()) return [];
    return db.prepare(`SELECT * FROM resource_booking_holds WHERE resourceId = ? AND date >= ? AND date <= ? AND releasedAt IS NULL AND expiresAt > ?
      ${excludeRef ? 'AND ref != ?' : ''} ORDER BY date, startTime`).all(Number(resourceId), from, to, at(), ...(excludeRef ? [String(excludeRef)] : []));
  }

  const find = (ref) => (present()
    ? db.prepare('SELECT * FROM resource_booking_holds WHERE ref = ? AND releasedAt IS NULL AND expiresAt > ? ORDER BY id DESC').get(String(ref), at()) || null
    : null);

  function expire() {
    if (!present()) return 0;
    return db.prepare('UPDATE resource_booking_holds SET releasedAt = ? WHERE releasedAt IS NULL AND expiresAt <= ?').run(at(), at()).changes;
  }

  return {
    hold, release, activeIn, find, expire,
  };
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS resource_booking_holds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    resourceId INTEGER NOT NULL,
    date       TEXT NOT NULL,
    startTime  TEXT NOT NULL,
    endTime    TEXT NOT NULL,
    ref        TEXT NOT NULL,
    expiresAt  TEXT NOT NULL,
    releasedAt TEXT,
    createdAt  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resource_booking_holds_slot ON resource_booking_holds(resourceId, date);
  CREATE INDEX IF NOT EXISTS idx_resource_booking_holds_ref ON resource_booking_holds(ref);
`;

module.exports = { createHoldsModel, CREATE_SQL, HOLD_MINUTES };
