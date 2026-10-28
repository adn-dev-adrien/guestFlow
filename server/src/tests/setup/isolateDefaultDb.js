/**
 * Preloaded by `npm test` (`node --require`) into every test process (specs/server-test-isolation.md
 * rule 1): the process gets its own throw-away SQLite file, and opening the checkout's own
 * `guestflow.db` (or `PERSISTENT_DB`) throws. A test that needs a database sets `DB_PATH` itself, as
 * before; one that forgets used to create and migrate the developer's `server/guestflow.db`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const DEFAULT_DB = path.resolve(__dirname, '..', '..', '..', 'guestflow.db');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-')), 'guestflow.db');
delete process.env.PERSISTENT_DB;

const isForbidden = (file) => {
  if (typeof file !== 'string' || file === ':memory:' || file === '') return false;
  return [DEFAULT_DB, `${DEFAULT_DB}-wal`, `${DEFAULT_DB}-shm`].includes(path.resolve(file));
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  if (request !== 'better-sqlite3' || exported.__guardsDefaultDb) return exported;
  function GuardedDatabase(file, ...rest) {
    if (isForbidden(file)) {
      throw new Error(`A test opened the checkout's own database (${file}): set DB_PATH to a temp file first.`);
    }
    return new exported(file, ...rest);
  }
  Object.setPrototypeOf(GuardedDatabase, exported);
  GuardedDatabase.prototype = exported.prototype;
  GuardedDatabase.__guardsDefaultDb = true;
  Module._load = originalLoad;
  require.cache[require.resolve('better-sqlite3')].exports = GuardedDatabase;
  return GuardedDatabase;
};
