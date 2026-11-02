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
 * own `GUESTFLOW_TEST_*` knobs are kept. Since 2026-11-01 (audit R13 L-1) the app's other variables go too
 * (`PUBLIC_SITE_ORIGIN`, the rate-limit knobs, QONTO_*…): the list and what the runner keeps are in
 * `appEnvNames.js`.
 *
 * Under `npm test` it then traces what the app reads from the environment (rule 13, `envTrace.js`).
 */
const path = require('path');

const DEFAULT_DB = path.resolve(__dirname, '..', '..', '..', 'guestflow.db');

require('./appEnvNames').stripAppEnv();

// Before `isolate`: the runner's check reads the trace in an exit handler that must run before the temp dir goes.
require('./envTrace').start();

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
