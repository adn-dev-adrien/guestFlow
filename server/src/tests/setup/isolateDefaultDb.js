/**
 * Preloaded by `npm test` (`node --require`) into every test process (specs/server-test-isolation.md
 * rule 1): the process gets its own throw-away SQLite file, and opening the checkout's own
 * `guestflow.db` (or `PERSISTENT_DB`) throws. A test that needs a database sets `DB_PATH` itself, as
 * before; one that forgets used to create and migrate the developer's `server/guestflow.db`. The secrets
 * file and the uploads folder move to the same temp directory (rule 4).
 *
 * It also starts the process without the shell's GuestFlow flags (rule 12): a developer shell exporting
 * `GUESTFLOW_MANAGED=1` or the E2E `GUESTFLOW_DISABLE_OUTBOUND=1` turned tests that read `process.env`
 * red, or vacuously green. A test that needs a flag sets it inline or passes its own `env`. The runner's
 * own `GUESTFLOW_TEST_*` knobs are kept.
 */
const path = require('path');

const DEFAULT_DB = path.resolve(__dirname, '..', '..', '..', 'guestflow.db');

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GUESTFLOW_') && !name.startsWith('GUESTFLOW_TEST_')) delete process.env[name];
}

require('../../utils/testProcessIsolation').isolate({ force: true });

const isForbidden = (file) => {
  if (typeof file !== 'string' || file === ':memory:' || file === '') return false;
  return [DEFAULT_DB, `${DEFAULT_DB}-wal`, `${DEFAULT_DB}-shm`].includes(path.resolve(file));
};

const exported = require('better-sqlite3');
function GuardedDatabase(file, ...rest) {
  if (isForbidden(file)) {
    throw new Error(`A test opened the checkout's own database (${file}): set DB_PATH to a temp file first.`);
  }
  return new exported(file, ...rest);
}
Object.setPrototypeOf(GuardedDatabase, exported);
GuardedDatabase.prototype = exported.prototype;
require.cache[require.resolve('better-sqlite3')].exports = GuardedDatabase;
