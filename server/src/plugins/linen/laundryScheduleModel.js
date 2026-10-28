/**
 * Laundry schedule model — sole DB access for `laundry_schedule_versions`
 * (specs/linen-laundry-days.md §5): the dated versions of the laundry schedule. A version is
 * effective from its `effectiveFrom` date until the next one; the migration seeds the first, effective
 * from the beginning of time.
 *
 * `create(db)` builds it on a database — the plugin's `ctx.db` in production, an in-memory schema in
 * tests.
 */

const { createSchedule } = require('./laundrySchedule');

const parseWeekdays = (csv) => String(csv).split(',').filter((d) => d !== '').map(Number);

function createModel(database) {
  const listStmt = database.prepare(
    'SELECT effectiveFrom, weekdays, turnaroundDays FROM laundry_schedule_versions ORDER BY effectiveFrom ASC',
  );
  const upsertStmt = database.prepare(`
    INSERT INTO laundry_schedule_versions (effectiveFrom, weekdays, turnaroundDays)
    VALUES (?, ?, ?)
    ON CONFLICT(effectiveFrom) DO UPDATE SET
      weekdays = excluded.weekdays,
      turnaroundDays = excluded.turnaroundDays,
      updatedAt = datetime('now')
  `);
  const removeStmt = database.prepare('DELETE FROM laundry_schedule_versions WHERE effectiveFrom = ?');

  const listAll = () => listStmt.all().map((r) => ({
    effectiveFrom: r.effectiveFrom,
    weekdays: parseWeekdays(r.weekdays),
    turnaroundDays: Number(r.turnaroundDays),
  }));

  return {
    /** Every version, oldest first: `[{ effectiveFrom, weekdays: number[], turnaroundDays }]`. */
    listAll,

    /** The versions as a `laundrySchedule` value. */
    schedule: () => createSchedule(listAll()),

    /** Write (or overwrite) the version effective from `effectiveFrom`. */
    upsert(effectiveFrom, { weekdays, turnaroundDays }) {
      upsertStmt.run(effectiveFrom, [...weekdays].sort((a, b) => a - b).join(','), turnaroundDays);
    },

    /** Delete the version effective from `effectiveFrom` (idempotent). */
    remove(effectiveFrom) {
      removeStmt.run(effectiveFrom);
    },
  };
}

module.exports = { create: createModel };
