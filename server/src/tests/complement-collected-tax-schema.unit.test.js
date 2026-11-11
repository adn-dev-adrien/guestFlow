// specs/reservation-save-keeps-pricing.md rule 4 + specs/migrations-baseline.md — `complementCollectedTax` and
// its three triggers live in schema.sql (a fresh install) and reach an upgraded database too, once each.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const db = require('../database');

const TRIGGERS = [
  'reservations_clear_complement_collected_tax',
  'reservations_stamp_complement_collected_tax',
  'reservations_stamp_complement_collected_tax_insert',
];
const triggersOf = (database) => database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'reservations_%complement_collected_tax%' ORDER BY name").all().map((r) => r.name);

test('a fresh install has the column and exactly the three triggers', () => {
  assert.ok(db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'complementCollectedTax'));
  assert.deepEqual(triggersOf(db), TRIGGERS);
});

function insertStay(extra) {
  db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  const columns = ['propertyId', 'clientId', 'startDate', 'endDate', 'complementPaid', 'touristTaxTotal', ...Object.keys(extra)];
  const values = [1, 1, '2026-08-10', '2026-08-13', 1, 5, ...Object.values(extra)];
  const id = db.prepare(`INSERT INTO reservations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values).lastInsertRowid;
  return db.prepare('SELECT complementCollectedTax AS tax FROM reservations WHERE id = ?').get(id).tax;
}

test('an insert already collected is stamped with its tax, and an explicit value is kept', () => {
  assert.equal(insertStay({}), 5);
  assert.equal(insertStay({ complementCollectedTax: 3.3 }), 3.3);
});

test('an upgraded database ends up with the same column and the same triggers, none duplicated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cct-'));
  const file = path.join(dir, 'old.db');
  // The baseline as it was before this change: no column, no trigger.
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8')
    .replace(' complementCollectedTax REAL,', '')
    .replace(/CREATE TRIGGER IF NOT EXISTS reservations_(stamp|clear)_complement_collected_tax[\s\S]*?END;\n/g, '');
  assert.ok(!schema.includes('complementCollectedTax'));
  const old = new Database(file);
  old.exec(schema);
  old.close();
  const probe = "const db = require('./src/database'); console.log(JSON.stringify({ column: db.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'complementCollectedTax'), triggers: db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'reservations_%complement_collected_tax%' ORDER BY name\").all().map((r) => r.name) })); process.exit(0);";
  const run = () => JSON.parse(spawnSync(process.execPath, ['-e', probe], { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, DB_PATH: file }, encoding: 'utf8' }).stdout.trim().split('\n').pop());
  const first = run();
  assert.deepEqual(first, { column: true, triggers: TRIGGERS });
  assert.deepEqual(run(), first, 'a second boot adds nothing');
});
