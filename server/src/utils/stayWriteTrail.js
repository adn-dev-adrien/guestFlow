/**
 * Which stays THIS request wrote (specs/reservation-fiche-concurrency.md rule 8).
 *
 * A TEMP trigger records every change of `reservations.updatedAt` (id, before, after). The statements that
 * update `reservations` are wrapped so the rows are drained right after each `run()` — synchronously, so the
 * rows are the statement's own — and attributed to the request context (AsyncLocalStorage) the statement ran
 * in. A write made by another request, a background job or another tab runs in another context, or none: it is
 * never attributed to this request, whatever the handler awaited in between.
 * Rows are taken once the outermost transaction has committed, so a rolled-back write is never reported; two
 * writes of one request with a foreign write between them drop the stay from the list.
 * A write that escapes the wrapper (`db.exec`, a statement prepared before `install`) is simply not reported:
 * the fiche then falls back to the safe stale conflict.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
const UPDATES_STAYS = /\bUPDATE\s+(?:OR\s+\w+\s+)?reservations\b/i;

function install(db) {
  if (db.__stayWriteTrail) return;
  db.__stayWriteTrail = true;
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS stay_writes (seq INTEGER PRIMARY KEY, id INTEGER, before TEXT, after TEXT);
    CREATE TEMP TRIGGER IF NOT EXISTS stay_writes_trail AFTER UPDATE OF updatedAt ON main.reservations
    WHEN OLD.updatedAt IS NOT NEW.updatedAt
    BEGIN INSERT INTO stay_writes (id, before, after) VALUES (OLD.id, OLD.updatedAt, NEW.updatedAt); END;
  `);
  const read = db.prepare('SELECT id, before, after FROM stay_writes ORDER BY seq');
  const clear = db.prepare('DELETE FROM stay_writes');
  const drain = () => {
    // Inside a transaction the rows are not final: a rollback removes them with the write. They are taken once
    // the outermost transaction has committed.
    if (db.inTransaction) return;
    const rows = read.all();
    if (rows.length === 0) return;
    clear.run();
    const store = als.getStore();
    if (!store) return;
    rows.forEach((row) => {
      const known = store.moved.get(row.id);
      const before = String(row.before || '');
      // Two writes of this request with a foreign one between them (v0→v1, other tab v1→v2, v2→v3): the chain
      // is broken, the stay is not reported and the fiche keeps its version.
      const broken = Boolean(known && (known.broken || known.after !== before));
      store.moved.set(row.id, { id: row.id, before: known ? known.before : before, after: String(row.after || ''), broken });
    });
  };
  const prepare = db.prepare.bind(db);
  db.prepare = (sql, ...rest) => {
    const stmt = prepare(sql, ...rest);
    if (typeof sql === 'string' && UPDATES_STAYS.test(sql)) {
      const run = stmt.run.bind(stmt);
      stmt.run = (...args) => { try { return run(...args); } finally { drain(); } };
    }
    return stmt;
  };
  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    const wrapped = transaction(fn);
    const drained = (f) => (...args) => { try { return f(...args); } finally { drain(); } };
    const result = drained(wrapped);
    ['default', 'deferred', 'immediate', 'exclusive'].forEach((mode) => { if (wrapped[mode]) result[mode] = drained(wrapped[mode]); });
    return result;
  };
  const exec = db.exec.bind(db);
  db.exec = (sql) => { try { return exec(sql); } finally { drain(); } };
  drain();
}

/** Runs `fn` with a collector for the stays written by the statements it starts. */
function collect(fn) {
  const store = { moved: new Map() };
  return als.run(store, () => fn(store));
}

module.exports = { install, collect };
