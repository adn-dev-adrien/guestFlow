/**
 * `guest_app_service_hours` / `guest_app_service_exceptions` — the service hours (specs/guest-app.md rule 40).
 * One shared configuration (`propertyId IS NULL`) that every lodging follows, unless a lodging holds rows of
 * its own: then those are its hours, whole. The all-properties establishment closures come from the core's
 * own model.
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const sdk = require('../../sdk');

const WEEKDAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

const parseRanges = (text) => {
  try {
    const ranges = JSON.parse(text || '[]');
    return Array.isArray(ranges) ? ranges : [];
  } catch {
    return [];
  }
};

function createServiceHoursModel(db) {
  const closures = sdk.models.closures(db);
  const scoped = (column = 'propertyId') => `${column} IS ?`;
  const scopeOf = (propertyId) => (propertyId == null ? null : Number(propertyId));

  const hasOwn = (propertyId) => Boolean(
    db.prepare(`SELECT 1 FROM guest_app_service_hours WHERE ${scoped()} LIMIT 1`).get(scopeOf(propertyId))
      || db.prepare(`SELECT 1 FROM guest_app_service_exceptions WHERE ${scoped()} LIMIT 1`).get(scopeOf(propertyId)),
  );

  function readScope(propertyId) {
    const weekly = Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
    db.prepare(`SELECT weekday, fromTime, toTime FROM guest_app_service_hours WHERE ${scoped()} ORDER BY weekday, fromTime`)
      .all(scopeOf(propertyId))
      .forEach((row) => weekly[row.weekday].push({ from: row.fromTime, to: row.toTime }));
    const exceptions = db.prepare(`SELECT date, closed, rangesJson FROM guest_app_service_exceptions WHERE ${scoped()} ORDER BY date`)
      .all(scopeOf(propertyId))
      .map((row) => (Number(row.closed) === 1 ? { date: row.date, closed: true } : { date: row.date, closed: false, ranges: parseRanges(row.rangesJson) }));
    return { weekly, exceptions };
  }

  /** The hours a lodging follows (its own, else the shared ones), or the shared ones for `null`. */
  function read(propertyId = null) {
    const own = propertyId != null && hasOwn(propertyId);
    return { propertyId: scopeOf(propertyId), shared: !own, ...readScope(own ? propertyId : null) };
  }

  /**
   * Replaces the hours of one scope. A lodging saved with no range and no exception goes back to the shared
   * hours: an empty configuration of its own would be indistinguishable from none.
   */
  function save(propertyId, { weekly, exceptions }) {
    const scope = scopeOf(propertyId);
    db.transaction(() => {
      db.prepare(`DELETE FROM guest_app_service_hours WHERE ${scoped()}`).run(scope);
      db.prepare(`DELETE FROM guest_app_service_exceptions WHERE ${scoped()}`).run(scope);
      const addRange = db.prepare('INSERT INTO guest_app_service_hours (weekday, fromTime, toTime, propertyId) VALUES (?, ?, ?, ?)');
      Object.entries(weekly).forEach(([weekday, ranges]) => ranges.forEach((r) => addRange.run(Number(weekday), r.from, r.to, scope)));
      const addException = db.prepare('INSERT INTO guest_app_service_exceptions (date, propertyId, closed, rangesJson) VALUES (?, ?, ?, ?)');
      exceptions.forEach((e) => addException.run(e.date, scope, e.closed ? 1 : 0, e.closed ? null : JSON.stringify(e.ranges)));
    })();
    return read(propertyId);
  }

  /** The dates the stored exceptions of a scope already name: a kept date is never judged again. */
  const storedExceptionDates = (propertyId) => new Set(
    db.prepare(`SELECT date FROM guest_app_service_exceptions WHERE ${scoped()}`).all(scopeOf(propertyId)).map((r) => r.date),
  );

  const propertyExists = (propertyId) => Boolean(db.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(propertyId)));

  /** Whether any range or exception is stored, shared or of a lodging: until then the service is unconstrained. */
  const isConfigured = () => Boolean(
    db.prepare('SELECT 1 FROM guest_app_service_hours LIMIT 1').get() || db.prepare('SELECT 1 FROM guest_app_service_exceptions LIMIT 1').get(),
  );

  /**
   * Rule 40 — what `serviceHours.js` reads for a lodging: its hours, and the all-properties closures not over by
   * `from`. `unconstrained` while the lodging follows hours nobody set (nothing shared, nothing of its own).
   */
  function scheduleFor(propertyId, { from }) {
    const { weekly, exceptions } = read(propertyId);
    return {
      unconstrained: !exceptions.length && Object.values(weekly).every((ranges) => !ranges.length),
      weekly,
      exceptions,
      closures: closures.list({ from }).filter((c) => c.propertyId == null).map((c) => ({ startDate: c.startDate, endDate: c.endDate })),
    };
  }

  return {
    isConfigured, propertyExists, read, save, scheduleFor, storedExceptionDates,
  };
}

module.exports = createServiceHoursModel;
