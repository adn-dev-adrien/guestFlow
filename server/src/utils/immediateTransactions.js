/**
 * Transactions that take the write lock up front (specs/plugins-phase-3a-online-payment.md rule 29).
 *
 * better-sqlite3 opens a transaction with `BEGIN` (deferred): a handler that reads first and writes after fails at
 * once with SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT when another connection commits in between — the busy timeout does not
 * apply to that upgrade. `BEGIN IMMEDIATE` takes the lock first and waits for the busy timeout instead.
 *
 * `makeImmediateByDefault(db)` makes `db.transaction(fn)()` immediate. `.deferred()`, `.immediate()` and `.exclusive()`
 * keep their meaning, and a transaction called inside another stays a savepoint (better-sqlite3 decides on
 * `db.inTransaction`, not on the mode). Idempotent.
 */

const MODES = ['deferred', 'immediate', 'exclusive'];

function makeImmediateByDefault(db) {
  if (db.__immediateTransactions) return;
  db.__immediateTransactions = true;
  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    const tx = transaction(fn);
    const immediate = tx.immediate;
    const byDefault = function immediateTransaction(...args) { return immediate.apply(this, args); };
    MODES.forEach((mode) => { byDefault[mode] = tx[mode]; });
    byDefault.default = immediate;
    byDefault.database = tx.database;
    return byDefault;
  };
}

module.exports = { makeImmediateByDefault };
