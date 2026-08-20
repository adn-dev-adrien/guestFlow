const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createPreUpdateBackup, rotateBackups, listBackups, backupFileName } = require('../utils/dbBackup');

// specs/self-update-and-releases.md §3.D rule 26.
//
// The rule this pins was paid for in production on 2026-08-19: the pre-deploy backup was a plain
// `cp` of the main database file, the database runs in WAL mode, and the last transactions were
// still in the `-wal` sidecar. The backup came out silently stale and a deletion the user had just
// confirmed was missing from it. `backup()` reads through the WAL; `cp` does not.

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-backup-'));
}

function seedWalDatabase(dir) {
  const dbFile = path.join(dir, 'guestflow.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, name TEXT)');
  const insert = db.prepare('INSERT INTO reservations (name) VALUES (?)');
  for (let i = 0; i < 25; i += 1) insert.run(`client ${i}`);
  return { db, dbFile };
}

test('the pre-update backup captures transactions still living in the WAL', () => {
  const dir = tmpDir();
  const { db, dbFile } = seedWalDatabase(dir);
  const backupsDir = path.join(dir, 'backups');

  return createPreUpdateBackup({ backupsDir, targetVersion: '1.1.0', database: db }).then((dest) => {
    const restored = new Database(dest, { readonly: true });
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, 25);
    restored.close();

    // The naive alternative, side by side: a copy of the main file alone, taken at the same instant.
    const walSize = fs.existsSync(`${dbFile}-wal`) ? fs.statSync(`${dbFile}-wal`).size : 0;
    if (walSize > 0) {
      const naive = path.join(dir, 'naive-copy.db');
      fs.copyFileSync(dbFile, naive);
      const copied = new Database(naive, { readonly: true });
      const rows = copied.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'reservations'").get().n;
      const count = rows ? copied.prepare('SELECT COUNT(*) AS n FROM reservations').get().n : 0;
      copied.close();
      assert.ok(count < 25, `a plain cp misses WAL-resident rows (saw ${count}/25)`);
    }

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('the backup filename carries the target version and a sortable timestamp', () => {
  const name = backupFileName('1.2.3', new Date('2026-08-20T09:32:11.000Z'));
  assert.equal(name, 'guestflow-pre-v1.2.3-20260820-093211.db');
});

test('a backup failure propagates so the update can abort', async () => {
  const dir = tmpDir();
  const brokenDatabase = { backup: async () => { throw new Error('disk full'); } };
  await assert.rejects(
    createPreUpdateBackup({ backupsDir: path.join(dir, 'backups'), targetVersion: '1.1.0', database: brokenDatabase }),
    /disk full/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rotation keeps the newest backups and never throws on a missing directory', () => {
  const dir = tmpDir();
  const backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const names = [
    'guestflow-pre-v1.0.0-20260101-000000.db',
    'guestflow-pre-v1.1.0-20260201-000000.db',
    'guestflow-pre-v1.2.0-20260301-000000.db',
    'guestflow-pre-v1.3.0-20260401-000000.db',
    'guestflow-pre-v1.4.0-20260501-000000.db',
    'guestflow-pre-v1.5.0-20260601-000000.db',
    'unrelated.db',
  ];
  for (const name of names) fs.writeFileSync(path.join(backupsDir, name), 'x');

  const deleted = rotateBackups(backupsDir, 3);
  const left = fs.readdirSync(backupsDir).sort();
  assert.deepEqual(deleted, [
    'guestflow-pre-v1.2.0-20260301-000000.db',
    'guestflow-pre-v1.1.0-20260201-000000.db',
    'guestflow-pre-v1.0.0-20260101-000000.db',
  ]);
  assert.deepEqual(left, [
    'guestflow-pre-v1.3.0-20260401-000000.db',
    'guestflow-pre-v1.4.0-20260501-000000.db',
    'guestflow-pre-v1.5.0-20260601-000000.db',
    'unrelated.db',
  ], 'files that are not pre-update backups are left alone');

  assert.deepEqual(rotateBackups(path.join(dir, 'nope'), 3), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listBackups reports newest first with size and date', () => {
  const dir = tmpDir();
  const backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(path.join(backupsDir, 'guestflow-pre-v1.0.0-20260101-000000.db'), 'a');
  fs.writeFileSync(path.join(backupsDir, 'guestflow-pre-v1.1.0-20260201-000000.db'), 'bb');
  const listed = listBackups(backupsDir);
  assert.equal(listed[0].name, 'guestflow-pre-v1.1.0-20260201-000000.db');
  assert.equal(listed[0].size, 2);
  assert.ok(listed[0].createdAt);
  assert.deepEqual(listBackups(path.join(dir, 'nope')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
