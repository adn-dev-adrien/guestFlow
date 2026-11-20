// specs/pricing-components.md §3 rule 115 (stabilisation loop t9, D9-4, 2026-11-16) — `refund_obligations.noteCents` is added and backfilled in
// ONE transaction: the settled `lineLowered` rows of a table that predates the column are stamped whole, and a failure in the backfill leaves
// no column behind, so the next boot runs both again. Before, the ALTER committed alone and a stop before the UPDATE left those rows at 0 for
// good. A second run changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');

function preColumnDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE refund_obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, origin TEXT NOT NULL,
    paymentLinkId INTEGER, lineRef TEXT, amountCents INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'open',
    createdAt TEXT DEFAULT (datetime('now')), settledAt TEXT, settledBy TEXT)`);
  const ins = db.prepare('INSERT INTO refund_obligations (reservationId, origin, amountCents, status, settledBy) VALUES (1, ?, ?, ?, ?)');
  ins.run('lineLowered', 3000, 'settled', 'refund:1');
  ins.run('lineLowered', 1200, 'settled', 'operator');
  ins.run('lineLowered', 500, 'open', null);
  ins.run('lineLowered', 700, 'cancelled', 'system');
  ins.run('basket', 900, 'settled', 'operator');
  return db;
}
const hasColumn = (db) => db.prepare('PRAGMA table_info(refund_obligations)').all().some((c) => c.name === 'noteCents');
const stamps = (db) => db.prepare('SELECT noteCents FROM refund_obligations ORDER BY id').all().map((r) => r.noteCents);

test('D9-4 — the column arrives with its backfill, once', () => {
  const db = preColumnDb();
  runPricingLinesMigration(db);
  assert.ok(hasColumn(db));
  assert.deepEqual(stamps(db), [3000, 1200, 0, 0, 0]);
  db.prepare('UPDATE refund_obligations SET noteCents = 0 WHERE id = 2').run();
  runPricingLinesMigration(db);
  assert.deepEqual(stamps(db), [3000, 0, 0, 0, 0], 'a second run re-stamps nothing');
});

test('D9-4 — a failed backfill leaves no column: the next run does both', () => {
  const db = preColumnDb();
  db.exec(`CREATE TRIGGER fail_backfill BEFORE UPDATE ON refund_obligations BEGIN SELECT RAISE(ABORT, 'injected'); END`);
  assert.throws(() => runPricingLinesMigration(db), /injected|no such column/);
  assert.equal(hasColumn(db), false);
  db.exec('DROP TRIGGER IF EXISTS fail_backfill');
  runPricingLinesMigration(db);
  assert.deepEqual(stamps(db), [3000, 1200, 0, 0, 0]);
});
