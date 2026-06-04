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
