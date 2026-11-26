// specs/pricing/pricing-components.md §3 rules 85, 86, 90.2; specs/hosting/self-update-and-releases.md rules 31 and 57 (end review R1-1, R1-2) — the previous
// release (4.1.0) running on a database PR C migrated. The statements below are v4.1.0's, copied from `server/src/utils/paymentPollRunner.js`,
// `utils/paymentLinkLifecycle.js`, `models/bookingLinesModel.js` (deleteCustomOptions) and `models/reservationsModel.js` (the arrival-SAS upsert)
// at the tag v4.1.0 (7df728ad).
//   - The automatic rollback of a 4.2.0 that fails its verification lands on a database 4.1.0 runs: the only step 4.1.0 cannot run on (T10, the
//     true lines) waits for the verification, so its arrival-SAS upsert still works there.
//   - The schema floor guards FUTURE installs only (the updater refuses a target below it); it never stops the helper's rollback nor a manual
//     repoint of `current`.
//   - A departure charge line is guarded by a trigger: v4.1.0's fiche save (DELETE + INSERT of the custom lines) is refused loudly instead of
//     billing the charge a second time inside `finalPrice`.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPricingSalesMigration, runTrueLinesWhenVerified, DEPARTURE_GUARD_MESSAGE } = require('../utils/pricingSalesMigration');
const { syncDepartureChargeLines } = require('../utils/departureChargeLines');
const { awaitingVerification } = require('../utils/updateVerification');
const { isBelowSchemaFloor, readSchemaFloor, BELOW_FLOOR_MESSAGE } = require('../utils/schemaFloor');
const { oldDatabase, seed } = require('./pricingSalesFixtures');

function migrated({ deferTrueLines = false } = {}) {
  const db = oldDatabase();
  seed(db);
  // v4.1.0's hourly-resources plugin had already given the custom lines their key.
  db.exec('ALTER TABLE reservation_custom_options ADD COLUMN sasLineKey TEXT');
  runPricingSalesMigration(db, { deferTrueLines });
  db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status, paidAt, basketJson) VALUES (NULL, 'standalone:7', 'complement', 900, 'paid', '2026-11-12', ?)") // date-literal-ok — migration or backfill fixture: historical values the code under test copies, never compares with today
    .run(JSON.stringify({ source: 'standalone-sale', saleRef: 'standalone:7', lines: [] }));
  db.prepare("INSERT INTO email_log (templateId, reservationId, saleRef, status, renderedSubject, renderedBody) VALUES (2, NULL, 'standalone:7', 'sent', 's', 'b')").run();
  return db;
}

// v4.1.0 `models/reservationsModel.js` (writeSoldOptions, the arrival SAS).
const OLD_ARRIVAL_UPSERT = `INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (10, 2, 1)
  ON CONFLICT(reservationId, optionId) DO UPDATE SET quantity = excluded.quantity`;
// v4.1.0 `models/bookingLinesModel.js` deleteCustomOptions, the first half of every fiche save.
const OLD_FICHE_DELETE = 'DELETE FROM reservation_custom_options WHERE reservationId = ?';

test('rule 86: the previous poller finds every old link and never a sale link', () => {
  const db = migrated();
  const owners = [10, 11];
  const earlier = db.prepare(`SELECT 1 FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(',')}) AND type IN ('balance', 'full') AND status = 'paid' AND id <> ? LIMIT 1`).get(...owners, 2);
  assert.ok(earlier, 'the paid link of stay 10 is still found');
  const open = db.prepare("SELECT id FROM payment_links WHERE status = 'open' AND reservationId IN (10, 11)").all();
  assert.deepEqual(open, [{ id: 2 }]);
  assert.equal(db.prepare('SELECT basketJson FROM payment_links WHERE id = 2').get().basketJson, null);
});

test('rule 86: the previous mailer writes and lists its log; a sale row is invisible to its history', () => {
  const db = migrated();
  const insert = db.prepare('INSERT INTO email_log (templateId, reservationId, sentAt, status, errorMessage, renderedSubject, renderedBody, recipientEmail) VALUES (?, ?, datetime(\'now\'), ?, ?, ?, ?, ?)');
  insert.run(1, 10, 'sent', '', 's', 'b', 'a@example.test');
  const history = db.prepare('SELECT l.id, l.reservationId FROM email_log l JOIN reservations r ON r.id = l.reservationId ORDER BY l.id').all();
  assert.deepEqual(history.map((r) => r.reservationId), [10, 11, 10], 'only reservation rows, in order');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 4, 'the sale row exists but no join reads it');
});

test('rule 31 (R1-2): booted as an unverified update, T10 waits — the rollback lands on a database v4.1.0\'s arrival-SAS upsert runs on', () => {
  const db = migrated({ deferTrueLines: true });
  assert.doesNotThrow(() => db.prepare(OLD_ARRIVAL_UPSERT).run(), 'the article key is still there');
  assert.equal(readSchemaFloor(db), null, 'no floor before T10');
  assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: () => true }), { state: 'awaiting' });
  assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: () => false }), { state: 'ran', tables: 2 });
  assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: () => false }), { state: 'done' });
  assert.throws(() => db.prepare(OLD_ARRIVAL_UPSERT).run(), /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/, 'once verified, v4.1.0 can no longer run there');
});

test('rule 31: the status file decides — the swap in flight towards this version waits (a rollback too), anything else runs', () => {
  const swap = { phase: 'restarting', targetVersion: '4.2.0', errorCode: null };
  assert.equal(awaitingVerification({ status: swap, version: '4.2.0' }), true);
  assert.equal(awaitingVerification({ status: { ...swap, phase: 'done' }, version: '4.2.0' }), false);
  assert.equal(awaitingVerification({ status: { ...swap, phase: 'swapping', errorCode: 'HEALTHCHECK_TIMEOUT' }, version: '4.2.0' }), true, 'the helper is rolling it back');
  assert.equal(awaitingVerification({ status: swap, version: '4.1.0' }), false);
  assert.equal(awaitingVerification({ status: { phase: 'idle' }, version: '4.2.0' }), false);
});

test('rule 57 (R1-2): the floor refuses a FUTURE install below it; it is no guard of the helper\'s rollback', () => {
  const db = migrated();
  assert.equal(readSchemaFloor(db), '4.2.0');
  assert.equal(isBelowSchemaFloor(db, '4.1.0'), true, 'the updater refuses to install 4.1.0 on this database');
  assert.equal(isBelowSchemaFloor(db, '4.2.0'), false);
  assert.match(BELOW_FLOOR_MESSAGE, /plus ancienne que la base de données/);
});

test('rule 90.2 (R1-1): v4.1.0\'s fiche save cannot delete a departure charge line — it fails loudly instead of billing it twice', () => {
  const db = migrated();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sasLineKey) VALUES (10, 'Serviette', 8, 'departure:label:Serviette')").run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount) VALUES (10, 'Panier', 25)").run();
  assert.throws(() => db.prepare(OLD_FICHE_DELETE).run(10), new RegExp(DEPARTURE_GUARD_MESSAGE.slice(0, 30)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 10').get().n, 2, 'nothing deleted');
  assert.doesNotThrow(() => db.prepare(OLD_FICHE_DELETE).run(11), 'a stay with no departure line saves as before');
});

test('rule 90.2: 4.2.0 removes its own departure line under the permit, and deleting the stay still cascades', () => {
  const db = migrated();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sasLineKey) VALUES (10, 'Serviette', 8, 'departure:label:Serviette')").run();
  syncDepartureChargeLines(db, 10, '[]');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_custom_options WHERE sasLineKey LIKE 'departure:%'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM departure_line_deletes').get().n, 0, 'the permit does not outlive the delete');
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sasLineKey) VALUES (11, 'Plomb', 30, 'departure:ext:seal')").run();
  db.prepare('DELETE FROM reservations WHERE id = 11').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 11').get().n, 0);
});

test('rule 86: the previous lifecycle pass would take an open sale link for an orphan stay — a manual downgrade after 4.2.0 sold outside a stay is unsupported; the current pass guards it', () => {
  const db = migrated();
  db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status, basketJson) VALUES (NULL, 'standalone:8', 'complement', 500, 'open', ?)")
    .run(JSON.stringify({ source: 'standalone-sale', ref: 'standalone:8' }));
  // v4.1.0's statement less its join on the converted devis (a column the fixture does not hold): the stay-less sale link is what it lists.
  const previous = db.prepare(`SELECT l.id FROM payment_links l LEFT JOIN reservations r ON r.id = l.reservationId
    WHERE l.status = 'open' AND (r.id IS NULL OR r.kind IN ('cancelled', 'superseded')) ORDER BY l.id`).all();
  assert.ok(previous.length > 0, 'v4.1.0 lists it as an orphan');
  const current = db.prepare(`SELECT l.id FROM payment_links l LEFT JOIN reservations r ON r.id = l.reservationId
    WHERE l.status = 'open' AND l.saleRef IS NULL AND (r.id IS NULL OR r.kind IN ('cancelled', 'superseded')) ORDER BY l.id`).all();
  assert.deepEqual(current, [], 'the current pass leaves it');
});
