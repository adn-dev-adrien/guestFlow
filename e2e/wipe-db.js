#!/usr/bin/env node
// Pre-test wipe for the ephemeral SQLite at GUESTFLOW_E2E_DB_PATH (default
// /tmp/guestflow-e2e.db). Lives OUTSIDE playwright.config.js because the config is
// re-evaluated by every worker — putting the unlink there would delete the DB mid-suite.
//
// Idempotent: missing files are silently ignored.
const fs = require('fs');
const DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(`${DB_PATH}${suffix}`); } catch { /* not there — fine */ }
}
console.log(`[wipe-db] cleared ${DB_PATH}{,-wal,-shm}`);

// The support access request lives beside the database (server/src/utils/supportAccess.js reads it from the DB's folder), and
// support-access.spec.js leaves its file there: a second run on a fresh database in the same folder opened with the banner of every
// admin page already up, and mobile/page-tabs measured the strip 238 px down (smoke rule 20, reading of loop t6). It is the run's state.
const path = require('path');
const REQUEST_FILE = path.join(path.dirname(DB_PATH), 'support-request.jws');
try { fs.unlinkSync(REQUEST_FILE); console.log(`[wipe-db] cleared ${REQUEST_FILE}`); } catch { /* not there — fine */ }
