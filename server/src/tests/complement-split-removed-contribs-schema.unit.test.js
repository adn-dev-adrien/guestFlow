// specs/accounting-books-the-money-collected.md rules 16-17 + specs/self-update-and-releases.md rule 39 — the two columns of
// a booked entry and the trigger that clears a split live in schema.sql (a fresh install), reach an upgraded database once
// each, are nullable, and an older release's writes on the migrated table run untouched.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const db = require('../database');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const COLUMNS = ['complementPaidSplit', 'removedLineContribs'];
const TRIGGER = 'reservations_clear_complement_paid_split';
const columnsOf = (database) => database.prepare('PRAGMA table_info(reservations)').all();

test('a fresh install has the two nullable columns and the trigger', () => {
  for (const name of COLUMNS) {
    const column = columnsOf(db).find((c) => c.name === name);
    assert.ok(column, name);
    assert.equal(column.notnull, 0);
    assert.equal(column.dflt_value, null);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(TRIGGER));
});

test('un-ticking a complement clears its split, whatever statement does it; a re-save of the flag keeps it', () => {
  db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  const id = db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, complementPaid, complementPaidSplit) VALUES (1, 1, ?, ?, 1, '{}')").run(addDaysToIsoDate(todayIso(), 30), addDaysToIsoDate(todayIso(), 32)).lastInsertRowid;
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = ?').run(id);
  assert.equal(db.prepare('SELECT complementPaidSplit AS s FROM reservations WHERE id = ?').get(id).s, '{}');
  db.prepare('UPDATE reservations SET complementPaid = 0 WHERE id = ?').run(id);
  assert.equal(db.prepare('SELECT complementPaidSplit AS s FROM reservations WHERE id = ?').get(id).s, null);
});

test('an upgraded database ends up with the same columns and trigger, none duplicated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-'));
  const file = path.join(dir, 'old.db');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8')
    .replace(' complementPaidSplit TEXT, removedLineContribs TEXT,', '')
    .replace(/CREATE TRIGGER IF NOT EXISTS reservations_clear_complement_paid_split[\s\S]*?END;\n/g, '');
  assert.ok(!schema.includes(' complementPaidSplit TEXT'));
  const old = new Database(file);
  old.exec(schema);
  old.close();
  const boot = `require(${JSON.stringify(path.join(__dirname, '..', 'database'))});`;
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, ['-e', boot], { env: { ...process.env, DB_PATH: file }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const upgraded = new Database(file, { readonly: true });
  for (const name of COLUMNS) assert.equal(columnsOf(upgraded).filter((c) => c.name === name).length, 1, name);
  assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(TRIGGER).n, 1);
  upgraded.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
