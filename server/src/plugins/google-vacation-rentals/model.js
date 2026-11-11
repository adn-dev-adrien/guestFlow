/**
 * The plugin's tables (specs/google-vacation-rentals-feed.md §5): what was last sent per property, and
 * the push log (kept 90 days).
 */

const MIGRATIONS = Object.freeze([{
  name: 'tables_v1',
  up: (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS gvr_rate_snapshot (
      propertyId  INTEGER NOT NULL,
      checkin     TEXT NOT NULL,
      nights      INTEGER NOT NULL,
      guests      INTEGER NOT NULL,
      amountCents INTEGER NOT NULL,
      sentAt      TEXT NOT NULL,
      PRIMARY KEY (propertyId, checkin, nights, guests)
    );
    CREATE TABLE IF NOT EXISTS gvr_day_snapshot (
      propertyId        INTEGER NOT NULL,
      date              TEXT NOT NULL,
      inventory         INTEGER NOT NULL,
      minLos            INTEGER,
      maxLos            INTEGER,
      closedToArrival   INTEGER NOT NULL DEFAULT 0,
      closedToDeparture INTEGER NOT NULL DEFAULT 0,
      closed            INTEGER NOT NULL DEFAULT 0,
      sentAt            TEXT NOT NULL,
      PRIMARY KEY (propertyId, date)
    );
    CREATE TABLE IF NOT EXISTS gvr_push_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      propertyId  INTEGER,
      startedAt   TEXT NOT NULL,
      finishedAt  TEXT,
      mode        TEXT NOT NULL,
      full        INTEGER NOT NULL DEFAULT 0,
      reason      TEXT NOT NULL DEFAULT '',
      messages    INTEGER NOT NULL DEFAULT 0,
      rates       INTEGER NOT NULL DEFAULT 0,
      days        INTEGER NOT NULL DEFAULT 0,
      failed      INTEGER NOT NULL DEFAULT 0,
      httpStatus  INTEGER,
      result      TEXT NOT NULL DEFAULT '',
      googleBody  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_gvr_push_log_started ON gvr_push_log(startedAt);
  `),
}]);

const TABLES = Object.freeze(['gvr_rate_snapshot', 'gvr_day_snapshot', 'gvr_push_log']);
const LOG_KEEP_DAYS = 90;
const DAY_FIELDS = ['inventory', 'minLos', 'maxLos', 'closedToArrival', 'closedToDeparture', 'closed'];

function buildModel(db) {
  const st = {
    rates: db.prepare('SELECT checkin, nights, guests, amountCents FROM gvr_rate_snapshot WHERE propertyId = ?'),
    upsertRate: db.prepare(`INSERT INTO gvr_rate_snapshot (propertyId, checkin, nights, guests, amountCents, sentAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(propertyId, checkin, nights, guests) DO UPDATE SET amountCents = excluded.amountCents, sentAt = excluded.sentAt`),
    deleteRate: db.prepare('DELETE FROM gvr_rate_snapshot WHERE propertyId = ? AND checkin = ? AND nights = ? AND guests = ?'),
    days: db.prepare(`SELECT date, ${DAY_FIELDS.join(', ')} FROM gvr_day_snapshot WHERE propertyId = ?`),
    upsertDay: db.prepare(`INSERT INTO gvr_day_snapshot (propertyId, date, ${DAY_FIELDS.join(', ')}, sentAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(propertyId, date) DO UPDATE SET inventory = excluded.inventory, minLos = excluded.minLos,
        maxLos = excluded.maxLos, closedToArrival = excluded.closedToArrival,
        closedToDeparture = excluded.closedToDeparture, closed = excluded.closed, sentAt = excluded.sentAt`),
    pastDays: db.prepare('DELETE FROM gvr_day_snapshot WHERE propertyId = ? AND date < ?'),
    pastRates: db.prepare('DELETE FROM gvr_rate_snapshot WHERE propertyId = ? AND checkin < ?'),
    countRates: db.prepare('SELECT COUNT(*) AS n FROM gvr_rate_snapshot WHERE propertyId = ?'),
    insertLog: db.prepare(`INSERT INTO gvr_push_log (propertyId, startedAt, mode, full, reason) VALUES (?, ?, ?, ?, ?)`),
    finishLog: db.prepare(`UPDATE gvr_push_log SET finishedAt = ?, messages = ?, rates = ?, days = ?, failed = ?,
      httpStatus = ?, result = ?, googleBody = ? WHERE id = ?`),
    listLog: db.prepare('SELECT * FROM gvr_push_log ORDER BY id DESC LIMIT ?'),
    lastLog: db.prepare('SELECT * FROM gvr_push_log WHERE propertyId = ? AND finishedAt IS NOT NULL ORDER BY id DESC LIMIT 1'),
    lastFull: db.prepare("SELECT startedAt FROM gvr_push_log WHERE full = 1 AND reason = 'nightly' ORDER BY id DESC LIMIT 1"),
    lastError: db.prepare("SELECT * FROM gvr_push_log WHERE result = 'error' ORDER BY id DESC LIMIT 1"),
    purgeLog: db.prepare('DELETE FROM gvr_push_log WHERE startedAt < ?'),
  };

  return {
    /** Map itineraryKey → amountCents of what Google last acknowledged. */
    rateSnapshot(propertyId) {
      const map = new Map();
      st.rates.all(propertyId).forEach((r) => map.set(`${r.checkin}|${r.nights}|${r.guests}`, r.amountCents));
      return map;
    },
    daySnapshot(propertyId) {
      const map = new Map();
      st.days.all(propertyId).forEach((r) => map.set(r.date, r));
      return map;
    },
    // Rule 14 — only the parts Google acknowledged are committed, in one transaction.
    commit(propertyId, { rates = [], removedRates = [], days = [] }, sentAt) {
      db.transaction(() => {
        rates.forEach((r) => st.upsertRate.run(propertyId, r.checkin, r.nights, r.guests, r.amountCents, sentAt));
        removedRates.forEach((r) => st.deleteRate.run(propertyId, r.checkin, r.nights, r.guests));
        days.forEach((d) => st.upsertDay.run(propertyId, d.date, ...DAY_FIELDS.map((k) => (d[k] == null ? null : d[k])), sentAt));
      })();
    },
    // Yesterday is no longer sent: its rows would read as « removed » forever.
    dropPast(propertyId, today) {
      st.pastDays.run(propertyId, today);
      st.pastRates.run(propertyId, today);
    },
    countRates: (propertyId) => st.countRates.get(propertyId).n,
    startLog: ({ propertyId, mode, full, reason, startedAt }) => Number(st.insertLog.run(propertyId, startedAt, mode, full ? 1 : 0, reason).lastInsertRowid),
    finishLog(id, {
      finishedAt, messages, rates, days, failed, httpStatus, result, googleBody,
    }) {
      st.finishLog.run(finishedAt, messages, rates, days, failed, httpStatus == null ? null : httpStatus, result, String(googleBody || '').slice(0, 4000), id);
    },
    listLog: (limit = 30) => st.listLog.all(Math.max(1, Math.min(200, Number(limit) || 30))),
    lastLog: (propertyId) => st.lastLog.get(propertyId) || null,
    lastNightlyStart: () => (st.lastFull.get() || {}).startedAt || null,
    lastError: () => st.lastError.get() || null,
    purgeLog(nowIso) {
      const cut = new Date(Date.parse(nowIso) - LOG_KEEP_DAYS * 86400000).toISOString();
      st.purgeLog.run(cut);
    },
  };
}

module.exports = { MIGRATIONS, TABLES, DAY_FIELDS, buildModel, LOG_KEEP_DAYS };
