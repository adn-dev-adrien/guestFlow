// specs/pricing-components.md §3 rules 85 and 86; specs/self-update-and-releases.md rules 31 and 57 — the previous release (4.0.x) running on a
// database PR C migrated. The statements below are the previous release's, copied from `server/src/utils/paymentPollRunner.js`,
// `models/emailLogModel.js` and `models/reservationsModel.js` (writeSoldOptions) at e27229aa. Rebuilt payment_links / email_log:
// the old readers see every old row, never a sale's row, and never crash. Rebuilt line tables: the old arrival-SAS upsert has no conflict
// target and throws, which the schema floor blocks at the updater.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPricingSalesMigration } = require('../utils/pricingSalesMigration');
const { isBelowSchemaFloor, readSchemaFloor, BELOW_FLOOR_MESSAGE } = require('../utils/schemaFloor');
const { oldDatabase, seed } = require('./pricingSalesFixtures');

function migratedWithAStandaloneSale() {
  const db = oldDatabase();
  seed(db);
  runPricingSalesMigration(db);
  db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status, paidAt, basketJson) VALUES (NULL, 'standalone:7', 'complement', 900, 'paid', '2026-11-12', ?)")
    .run(JSON.stringify({ source: 'standalone-sale', saleRef: 'standalone:7', lines: [] }));
  db.prepare("INSERT INTO email_log (templateId, reservationId, saleRef, status, renderedSubject, renderedBody) VALUES (2, NULL, 'standalone:7', 'sent', 's', 'b')").run();
  return db;
}

test('rule 86: the previous poller finds every old link and never a sale link', () => {
  const db = migratedWithAStandaloneSale();
  const owners = [10, 11];
  const earlier = db.prepare(`SELECT 1 FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(',')}) AND type IN ('balance', 'full') AND status = 'paid' AND id <> ? LIMIT 1`).get(...owners, 2);
  assert.ok(earlier, 'the paid link of stay 10 is still found');
  const open = db.prepare("SELECT id FROM payment_links WHERE status = 'open' AND reservationId IN (10, 11)").all();
  assert.deepEqual(open, [{ id: 2 }]);
  assert.equal(db.prepare('SELECT basketJson FROM payment_links WHERE id = 2').get().basketJson, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE reservationId IS NULL AND reservationId IN (10, 11)").get().n, 0);
});

test('rule 86: the previous mailer writes and lists its log; a sale row is invisible to its history', () => {
  const db = migratedWithAStandaloneSale();
  const insert = db.prepare('INSERT INTO email_log (templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail) VALUES (?, ?, datetime(\'now\'), ?, ?, ?, ?, ?)');
  insert.run(1, 10, 'sent', '', 's', 'b', 'a@example.test');
  const history = db.prepare('SELECT l.id, l.reservationId FROM email_log l JOIN reservations r ON r.id = l.reservationId ORDER BY l.id').all();
  assert.deepEqual(history.map((r) => r.reservationId), [10, 11, 10], 'only reservation rows, in order');
  assert.ok(db.prepare("SELECT 1 FROM email_log WHERE templateId = ? AND reservationId = ? AND status IN ('sent') LIMIT 1").get(1, 10));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 4, 'the sale row exists but no join reads it');
});

test('rule 85 and rule 57: the previous arrival-SAS upsert breaks on the rebuilt table; the floor refuses the downgrade', () => {
  const db = migratedWithAStandaloneSale();
  assert.throws(() => db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (10, 2, 1) ON CONFLICT(reservationId, optionId) DO UPDATE SET quantity = excluded.quantity`).run(), /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/);
  assert.equal(readSchemaFloor(db), '4.1.0');
  assert.equal(isBelowSchemaFloor(db, '4.0.9'), true, 'the updater refuses a release older than the floor');
  assert.equal(isBelowSchemaFloor(db, '4.1.0'), false);
  assert.equal(isBelowSchemaFloor(db, '4.2.0'), false);
  assert.match(BELOW_FLOOR_MESSAGE, /plus ancienne que la base de données/);
});

test('rule 85: the previous release\'s plain writers (delete then insert, no upsert) run unchanged on the rebuilt tables', () => {
  const db = migratedWithAStandaloneSale();
  db.prepare('DELETE FROM reservation_options WHERE reservationId = 10').run();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (10, 2, 1, 20, 1, 'per_stay', 20)").run();
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, totalPrice) VALUES (11, 5, 1, 9)").run();
  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 10').get();
  assert.ok(row.lineId > 0 && row.source === 'fiche');
});
