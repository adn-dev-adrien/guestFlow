/**
 * One prepared statement per SQL text and database handle (specs/pricing/pricing-components.md rule 48, extended to the
 * handle by the stabilisation loop t19).
 *
 * The models prepare their statements where they run them, call after call. Preparing is the expensive part of a short
 * read: `SELECT * FROM reservations WHERE id = ?` costs more to compile than to answer, and one fiche save prepares it
 * dozens of times. `install(db)` makes `db.prepare(sql)` hand back the statement it already compiled for that exact
 * text, so every caller pays the compilation once per handle, however it is written.
 *
 * Same answers as before, by construction:
 * - The cache empties whenever the schema changes (`PRAGMA schema_version` read at each call, a cheap pragma): a table
 *   dropped or a column added is seen exactly as a fresh `prepare` would see it — a statement naming a table that is
 *   gone still throws at `prepare`.
 * - A text that fails to compile is not kept: it throws again next time, as before.
 * - At most `LIMIT` texts per handle, the least recently used dropped first, so SQL built with inlined values cannot
 *   grow it without bound.
 * - It must be installed LAST, over every other `db.prepare` wrapper (`stayWriteTrail`), so each wrapper runs once for
 *   the statement it wraps. A statement's modes (`pluck`, `raw`, `expand`, `bind`) are shared by every caller of its
 *   text: no module of `src/` sets one (the cache test enumerates them), and `iterate()` is not used (a cached statement
 *   cannot be iterated twice at once).
 */
const LIMIT = 2000;

function install(db) {
  if (db.__statementCache) return;
  Object.defineProperty(db, '__statementCache', { value: true });
  const prepare = db.prepare.bind(db);
  const schemaVersion = prepare('PRAGMA schema_version').pluck();
  const cache = new Map();
  let version = schemaVersion.get();
  db.prepare = (sql, ...rest) => {
    if (typeof sql !== 'string' || rest.length > 0) return prepare(sql, ...rest);
    const now = schemaVersion.get();
    if (now !== version) {
      cache.clear();
      version = now;
    }
    const hit = cache.get(sql);
    if (hit) {
      cache.delete(sql);
      cache.set(sql, hit);
      return hit;
    }
    const statement = prepare(sql);
    cache.set(sql, statement);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    return statement;
  };
}

module.exports = { install, LIMIT };
