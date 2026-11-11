/**
 * SQLite copies the hosting needs without stopping anyone (specs/hosting-h1-fleet-runtime.md rules
 * 10, 13, 14): the online backup API of better-sqlite3 for a consistent copy of a live database, and
 * the check a restored copy must pass.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function backupTo(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  return target;
}

// Rule 13: `PRAGMA integrity_check` and the number of reservations. → { ok, reservations, detail }
function verify(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    const ok = integrity.length === 1 && integrity[0] === 'ok';
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservations'").get();
    const reservations = hasTable ? db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n : 0;
    return { ok, reservations, detail: ok ? '' : integrity.slice(0, 3).join(' ; ') };
  } catch (err) {
    return { ok: false, reservations: null, detail: err.message };
  } finally {
    if (db) db.close();
  }
}

// A database is three files while it runs: a restore replaces all of them.
function removeDatabaseFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

module.exports = { backupTo, verify, removeDatabaseFiles };
