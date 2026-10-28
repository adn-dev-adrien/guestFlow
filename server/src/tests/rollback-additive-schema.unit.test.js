// specs/self-update-and-releases.md rule 39 (amends rule 31) — an automatic rollback runs the previous
// release on the migrated database, so a migration may add, never rename or drop. Two guards:
//   1. every column the v3.18.0 schema holds is still there on a current install (generic: a future
//      rename or drop of ANY core column fails here);
//   2. the payment-link rename of rule 6 of specs/plugins-phase-3a-online-payment.md is additive —
//      v3.18.0's own SQL runs on the migrated table, and both name sets stay in step.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const floor = require('./fixtures/rollback-floor-v3.18.0-schema.json');
const { migratePaymentLinksToProviders, syncLegacyQontoColumns } = require('../utils/paymentLinksProviderMigration');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');

test('rule 39 - every column of the v3.18.0 schema survives on a current install', () => {
  const lost = [];
  for (const [table, columns] of Object.entries(floor)) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (have.length === 0) lost.push(`${table} (table)`);
    for (const column of columns) if (!have.includes(column)) lost.push(`${table}.${column}`);
  }
  assert.deepEqual(lost, []);
});

// payment_links exactly as production holds it before the provider-neutral migration (v3.12 -> v3.18).
function v318Db() {
  const old = new Database(':memory:');
  old.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL,
      qontoPaymentLinkId TEXT, url TEXT NOT NULL DEFAULT '', amountCents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR', status TEXT NOT NULL DEFAULT 'open', qontoPaymentId TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')), paidAt TEXT, expiresAt TEXT, lastPolledAt TEXT,
      CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
      CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
    );
  `);
  old.prepare("INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, qontoPaymentId, status, amountCents) VALUES (1, 'deposit', 'L1', 'P1', 'paid', 5000)").run();
  old.prepare("INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, status, amountCents) VALUES (1, 'balance', 'L2', 'open', 9000)").run();
  return old;
}

function migrate(d) {
  migratePaymentLinksToProviders(d);
  migrateInstallmentsSchema(d);
  syncLegacyQontoColumns(d);
}

// The SQL of v3.18.0's paymentLinksModel, verbatim.
const V318_SELECT = `SELECT id, reservationId, type, qontoPaymentLinkId, url, amountCents, currency,
    status, qontoPaymentId, createdAt, paidAt, expiresAt, lastPolledAt FROM payment_links ORDER BY id`;
const V318_INSERT = `INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, url, amountCents, currency, status, expiresAt)
    VALUES (@reservationId, @type, @qontoPaymentLinkId, @url, @amountCents, @currency, @status, @expiresAt)`;
const V318_MARK_PAID = `UPDATE payment_links SET status = 'paid', qontoPaymentId = COALESCE(?, qontoPaymentId),
    paidAt = COALESCE(?, datetime('now')) WHERE id = ? AND status IN ('open', 'expired')`;

test('rule 39 - the migrated table keeps the legacy columns, values copied both ways', () => {
  const d = v318Db();
  migrate(d);
  const rows = d.prepare('SELECT id, qontoPaymentLinkId, providerLinkId, qontoPaymentId, providerPaymentId, provider FROM payment_links ORDER BY id').all();
  assert.deepEqual(rows, [
    { id: 1, qontoPaymentLinkId: 'L1', providerLinkId: 'L1', qontoPaymentId: 'P1', providerPaymentId: 'P1', provider: 'qonto' },
    { id: 2, qontoPaymentLinkId: 'L2', providerLinkId: 'L2', qontoPaymentId: null, providerPaymentId: null, provider: 'qonto' },
  ]);
});

test('rule 39 - v3.18.0 SQL still runs on the migrated table and what it writes is visible to current code', () => {
  const d = v318Db();
  migrate(d);
  assert.equal(d.prepare(V318_SELECT).all().length, 2);
  const info = d.prepare(V318_INSERT).run({ reservationId: 2, type: 'full', qontoPaymentLinkId: 'L3', url: 'u', amountCents: 100, currency: 'EUR', status: 'open', expiresAt: null });
  assert.equal(d.prepare('SELECT providerLinkId FROM payment_links WHERE id = ?').get(info.lastInsertRowid).providerLinkId, 'L3');
  d.prepare(V318_MARK_PAID).run('P3', null, info.lastInsertRowid);
  assert.equal(d.prepare('SELECT providerPaymentId FROM payment_links WHERE id = ?').get(info.lastInsertRowid).providerPaymentId, 'P3');
});

test('rule 39 - what current code writes is visible to v3.18.0 SQL', () => {
  const d = v318Db();
  migrate(d);
  d.prepare("INSERT INTO payment_links (reservationId, type, provider, providerLinkId) VALUES (3, 'deposit', 'qonto', 'L4')").run();
  d.prepare("UPDATE payment_links SET status = 'paid', providerPaymentId = 'P2' WHERE id = 2").run();
  const byId = Object.fromEntries(d.prepare(V318_SELECT).all().map((r) => [r.id, r]));
  assert.equal(byId[3].qontoPaymentLinkId, 'L4');
  assert.equal(byId[2].qontoPaymentId, 'P2');
});

test('rule 39 - rows written by v3.18.0 while it ran on the migrated schema are picked up by the next boot', () => {
  const d = v318Db();
  migrate(d);
  d.exec('DROP TRIGGER trg_payment_links_legacy_insert');
  d.prepare(V318_INSERT).run({ reservationId: 4, type: 'deposit', qontoPaymentLinkId: 'L5', url: '', amountCents: 1, currency: 'EUR', status: 'open', expiresAt: null });
  assert.equal(d.prepare('SELECT providerLinkId FROM payment_links WHERE qontoPaymentLinkId = ?').get('L5').providerLinkId, null);
  migrate(d);
  assert.equal(d.prepare('SELECT providerLinkId FROM payment_links WHERE qontoPaymentLinkId = ?').get('L5').providerLinkId, 'L5');
});

test('rule 39 - the migration is idempotent and a second run writes nothing', () => {
  const d = v318Db();
  migrate(d);
  const before = d.prepare('SELECT * FROM payment_links ORDER BY id').all();
  const changes = d.total_changes;
  migrate(d);
  assert.deepEqual(d.prepare('SELECT * FROM payment_links ORDER BY id').all(), before);
  assert.equal(d.total_changes, changes);
});

test('rule 39 - a table already renamed by an earlier inte gets the legacy columns back', () => {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation');
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL,
      providerLinkId TEXT, url TEXT NOT NULL DEFAULT '', amountCents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR', status TEXT NOT NULL DEFAULT 'open', providerPaymentId TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')), paidAt TEXT, expiresAt TEXT, lastPolledAt TEXT,
      provider TEXT NOT NULL DEFAULT 'qonto', remoteCancelPendingAt TEXT, cancelReason TEXT,
      CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
      CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
    );
  `);
  d.prepare("INSERT INTO payment_links (reservationId, type, providerLinkId, providerPaymentId) VALUES (1, 'deposit', 'L9', 'P9')").run();
  migrate(d);
  const row = d.prepare('SELECT qontoPaymentLinkId, qontoPaymentId FROM payment_links').get();
  assert.deepEqual(row, { qontoPaymentLinkId: 'L9', qontoPaymentId: 'P9' });
});
