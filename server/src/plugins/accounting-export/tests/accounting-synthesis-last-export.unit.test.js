// specs/accounting-synthesis.md §3 rule 16 — the last CSV download, stored beside the plugin's settings: one row,
// rewritten at each download, never an operator setting, unreadable = none.
// specs/accountant-accounting-export.md §3 rule 38. The clock is pinned for the whole file: the dates are the « now »
// handed to the stamp.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 12) });
const Database = require('better-sqlite3');

const { readLastCsvExport, storeLastCsvExport, LAST_CSV_EXPORT_KEY, DECLARED, createAccountSettings } = require('../settings');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT, updated_at TEXT, PRIMARY KEY (plugin_id, key))');
  return db;
}

test('rule 16 — stored at each download, the latest wins, local time to the minute', () => {
  const db = freshDb();
  assert.equal(readLastCsvExport(db), null);
  storeLastCsvExport(db, '2026-10', new Date(2026, 10, 2, 9, 5));
  assert.deepEqual(readLastCsvExport(db), { at: '2026-11-02T09:05', month: '2026-10' });
  storeLastCsvExport(db, '2026-09', new Date(2026, 10, 3, 18, 40));
  assert.deepEqual(readLastCsvExport(db), { at: '2026-11-03T18:40', month: '2026-09' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plugin_settings').get().n, 1);
});

test('rule 16 — not an operator setting: never declared, never counted as a customised one', () => {
  assert.equal(DECLARED.some((d) => d.key === LAST_CSV_EXPORT_KEY), false);
  const db = freshDb();
  storeLastCsvExport(db, '2026-10');
  assert.equal(createAccountSettings(db).customisedCount(), 0);
});

test('rule 16 — an unreadable stamp reads as none; a database without the table neither throws nor stamps', () => {
  const db = freshDb();
  db.prepare("INSERT INTO plugin_settings (plugin_id, key, value) VALUES ('accounting-export', ?, ?)").run(LAST_CSV_EXPORT_KEY, '{not json');
  assert.equal(readLastCsvExport(db), null);
  db.prepare('UPDATE plugin_settings SET value = ?').run(JSON.stringify({ at: 'hier', month: '2026-10' }));
  assert.equal(readLastCsvExport(db), null);
  const bare = new Database(':memory:');
  assert.doesNotThrow(() => storeLastCsvExport(bare, '2026-10'));
  assert.equal(readLastCsvExport(bare), null);
});
