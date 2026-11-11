/**
 * Counts the SQL statements a better-sqlite3 database executes (test-only). Install it before any
 * module prepares a statement, then read `count()` around the code under test:
 *
 *   const counter = installStatementCounter(db);
 *   const executed = await counter.during(() => doRequest());
 *
 * `prepare` itself is not counted, only each `run` / `get` / `all` / `iterate` (and `exec`), because a
 * statement executed once per reservation is the cost that grows with the data.
 */
const EXECUTING = new Set(['run', 'get', 'all', 'iterate']);

function installStatementCounter(db) {
  let executed = 0;
  const prepare = db.prepare.bind(db);
  const exec = db.exec.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return EXECUTING.has(property)
          ? (...args) => { executed += 1; return value.apply(target, args); }
          : value.bind(target);
      },
    });
  };
  db.exec = (sql) => { executed += 1; return exec(sql); };
  return {
    count: () => executed,
    async during(work) {
      const before = executed;
      await work();
      return executed - before;
    },
  };
}

module.exports = { installStatementCounter };
