// specs/pricing/pricing-components.md rule 97 (loop t1 B-1, migration) — a `standalone_sale_obligations` table created before the `lineLowered` origin is rebuilt once
// with the wider CHECK: its rows and ids are kept, a second run changes nothing.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runPricingSalesMigration } = require('../utils/pricingSalesMigration');

test('B-1 migration — the old CHECK is widened, the rows stay, a `lineLowered` row is accepted', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE migrations (name TEXT PRIMARY KEY);
    CREATE TABLE standalone_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, soldAt TEXT NOT NULL);
    CREATE TABLE standalone_sale_obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, saleId INTEGER NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('linkSurplus')),
      paymentLinkId INTEGER UNIQUE, amountCents INTEGER NOT NULL CHECK (amountCents > 0), reason TEXT, createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')), settledAt TEXT, settledBy TEXT,
      FOREIGN KEY (saleId) REFERENCES standalone_sales(id) ON DELETE CASCADE);
    CREATE INDEX idx_standalone_sale_obligations_sale ON standalone_sale_obligations(saleId, status);
    INSERT INTO standalone_sales (id, soldAt) VALUES (1, datetime('now'));
    INSERT INTO standalone_sale_obligations (id, saleId, origin, paymentLinkId, amountCents) VALUES (5, 1, 'linkSurplus', 9, 300);`);
  assert.throws(() => db.prepare("INSERT INTO standalone_sale_obligations (saleId, origin, amountCents) VALUES (1, 'lineLowered', 100)").run());
  assert.equal(runPricingSalesMigration(db).documentObligations, 1);
  assert.equal(runPricingSalesMigration(db).documentObligations, 0);
  assert.deepEqual(db.prepare('SELECT id, origin, paymentLinkId, amountCents FROM standalone_sale_obligations').all(), [{ id: 5, origin: 'linkSurplus', paymentLinkId: 9, amountCents: 300 }]);
  db.prepare("INSERT INTO standalone_sale_obligations (saleId, origin, amountCents) VALUES (1, 'lineLowered', 100)").run();
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_standalone_sale_obligations_sale'").get(), 'the index is carried');
});
