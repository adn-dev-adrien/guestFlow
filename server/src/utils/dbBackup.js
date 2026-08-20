/**
 * WAL-safe database snapshots (specs/self-update-and-releases.md §3.D rule 26).
 *
 * `cp guestflow.db backup.db` is NOT a backup: the database runs in `journal_mode=WAL`, so the most
 * recent transactions live in the `-wal` sidecar until a checkpoint happens. Copying the main file
 * alone produces a silently stale snapshot — exactly what happened in production on 2026-08-19,
 * where a deletion the user had just confirmed was missing from the backup taken right after.
 *
 * better-sqlite3's `backup()` runs SQLite's online backup API, which reads through the WAL and
 * yields a consistent file.
 */

const fs = require('fs');
const path = require('path');
const db = require('../database');

const BACKUP_PREFIX = 'guestflow-pre-v';
const DEFAULT_KEEP = 5;

/** `2026-08-20T09:32:11.123Z` → `20260820-093211`, safe in a filename. */
function timestampSlug(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function backupFileName(targetVersion, date = new Date()) {
  return `${BACKUP_PREFIX}${targetVersion}-${timestampSlug(date)}.db`;
}

/**
 * Snapshot the live database into `backupsDir`. Resolves with the absolute path of the file.
 * Throws on failure — a failed pre-update backup aborts the update (rule 26).
 */
async function createPreUpdateBackup({ backupsDir, targetVersion, database = db, now = new Date() }) {
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const dest = path.join(backupsDir, backupFileName(targetVersion, now));
  await database.backup(dest);
  return dest;
}

/**
 * Keep the `keep` most recent pre-update backups, delete the rest. Returns the deleted filenames.
 * Never throws: losing an old backup must not fail an update.
 */
function rotateBackups(backupsDir, keep = DEFAULT_KEEP) {
  let entries;
  try {
    entries = fs.readdirSync(backupsDir).filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db'));
  } catch {
    return [];
  }
  // The timestamp slug sorts chronologically as a string, so a plain descending sort is enough.
  const doomed = entries.sort().reverse().slice(Math.max(0, keep));
  const deleted = [];
  for (const name of doomed) {
    try {
      fs.rmSync(path.join(backupsDir, name), { force: true });
      deleted.push(name);
    } catch {
      // A backup we cannot delete is not a reason to fail the update.
    }
  }
  return deleted;
}

/** The pre-update backups on disk, newest first, with their size and date. */
function listBackups(backupsDir) {
  try {
    return fs.readdirSync(backupsDir)
      .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db'))
      .sort()
      .reverse()
      .map((name) => {
        const stat = fs.statSync(path.join(backupsDir, name));
        return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

module.exports = {
  BACKUP_PREFIX,
  DEFAULT_KEEP,
  timestampSlug,
  backupFileName,
  createPreUpdateBackup,
  rotateBackups,
  listBackups,
};
