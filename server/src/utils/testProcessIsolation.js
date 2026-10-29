/**
 * Keeps a `node --test` process away from the checkout's own state (specs/server-test-isolation.md
 * rules 1 and 4). Under the test runner (`NODE_TEST_CONTEXT` is set in every test child, with or
 * without the `npm test` preload), a process that names no database, secrets file or uploads folder
 * gets private ones in a throw-away temp directory, removed when the process exits.
 *
 * The process's `TMPDIR` moves there as well, so the scratch directories the suites create (`gf-phase4-*`,
 * `gvr-*`, …) no longer pile up in the shared temp folder (audit R2, F-R2-11).
 *
 * `isolate({ force: true })` is the preload's variant: it replaces the three values unconditionally.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let tempDir = null;

function privateDir() {
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-'));
    fs.mkdirSync(path.join(tempDir, 'data'));
    // Every `fs.mkdtempSync(os.tmpdir())` a suite makes lands in the private directory too, and goes with it.
    fs.mkdirSync(path.join(tempDir, 'tmp'));
    process.env.TMPDIR = path.join(tempDir, 'tmp');
    process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* already gone */ } });
  }
  return tempDir;
}

function isolate({ force = false } = {}) {
  if (!force && !process.env.NODE_TEST_CONTEXT) return;
  if (force) delete process.env.PERSISTENT_DB;
  if (force || (!process.env.DB_PATH && !process.env.PERSISTENT_DB)) {
    process.env.DB_PATH = path.join(privateDir(), 'data', 'guestflow.db');
  }
  if (force || !process.env.GUESTFLOW_LOCAL_ENV) process.env.GUESTFLOW_LOCAL_ENV = path.join(privateDir(), 'env.local');
  if (force || !process.env.GUESTFLOW_UPLOADS_DIR) process.env.GUESTFLOW_UPLOADS_DIR = path.join(privateDir(), 'uploads');
}

module.exports = { isolate };
