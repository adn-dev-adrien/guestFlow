// specs/payments/mollie-rolling-reserve-and-incoming-payments.md §5 — `reconciliation_v3b` reaches the final Mollie schema from any state,
// and the bare-key rewrite of rule 8 reads exactly the links that have a split. Throwaway in-memory databases.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { up, upV2, upV3, upV3b } = require('../reconciliation/schema');

// A fixed instant stored as inert data in a throwaway database: no behaviour depends on today.
const AT = '2020-01-02 10:00:00'; // date-literal-ok: inert stored value of a throwaway database
const DAY = '2020-01-02'; // date-literal-ok: inert stored value of a throwaway database
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function freshDb() {
  const db = new Database(':memory:');
  up(db);
  upV2(db);
  db.exec(`CREATE TABLE payment_links (id INTEGER PRIMARY KEY, reservationId INTEGER, type TEXT, status TEXT, paidAt TEXT, amountCents INTEGER, installmentId INTEGER, basketJson TEXT);
    CREATE TABLE reservation_installments (id INTEGER PRIMARY KEY, reservationId INTEGER, number INTEGER);`);
  return db;
}

/** What the first draft of `reconciliation_v3` left on a development database. */
function firstDraft(db) {
  db.exec(`
    CREATE TABLE payment_link_splits (
      paymentLinkId TEXT PRIMARY KEY, reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
      grossCents INTEGER NOT NULL, immediateCents INTEGER NOT NULL, reserveCents INTEGER NOT NULL,
      ratePercent REAL NOT NULL, holdDays INTEGER NOT NULL, paidAt TEXT NOT NULL, molliePaymentId TEXT, refundedCents INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    CREATE TABLE mollie_settlements (id TEXT PRIMARY KEY, reference TEXT NOT NULL, settledAt TEXT, amountCents INTEGER NOT NULL DEFAULT 0,
      costsCents INTEGER NOT NULL DEFAULT 0, reserveHeldCents INTEGER NOT NULL DEFAULT 0, reserveReleasedCents INTEGER NOT NULL DEFAULT 0, fetchedAt TEXT NOT NULL);
    CREATE TABLE mollie_settlement_payments (settlementId TEXT NOT NULL, molliePaymentId TEXT NOT NULL, amountCents INTEGER NOT NULL, paidAt TEXT,
      description TEXT, paymentLinkId TEXT, PRIMARY KEY (settlementId, molliePaymentId));
    ALTER TABLE bank_transactions ADD COLUMN qontoReference TEXT;
    INSERT INTO payment_link_splits VALUES ('7', 40, 'balance', 10000, 8000, 2000, 20, 90, '${AT}', 'tr_7', 0, '${DAY}');
    INSERT INTO mollie_settlements VALUES ('stl_1', '19274230.2610.01', NULL, 100, 0, 0, 0, '${DAY}');
    INSERT INTO mollie_settlement_payments VALUES ('stl_1', 'tr_7', 100, NULL, 'x', '7');`);
}

test('v3b — a database that ran the first draft of v3 reaches the final shape: splits kept, re-readable settlement tables rebuilt', () => {
  const db = freshDb();
  firstDraft(db);
  upV3b(db);
  assert.ok(columns(db, 'mollie_settlements').includes('source'));
  assert.deepEqual(['kind', 'splitId', 'grossCents', 'reserveCents', 'feeCents'].filter((c) => !columns(db, 'mollie_settlement_payments').includes(c)), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mollie_settlements').get().n, 0, 'only what Mollie can say again is dropped');
  assert.deepEqual(db.prepare('SELECT sourceType, sourceKey, reservationId, grossCents, molliePaymentId FROM mollie_payment_splits').all(),
    [{ sourceType: 'link', sourceKey: '7', reservationId: 40, grossCents: 10000, molliePaymentId: 'tr_7' }]);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'payment_link_splits'").get(), undefined);
  ['mollie_balance_transactions', 'mollie_settlement_failures'].forEach((t) => assert.ok(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(t), t));
});

test('v3b — a database that ran the second draft (settlements without `source`, payments without `kind`) is rebuilt too', () => {
  const db = freshDb();
  db.exec(`
    CREATE TABLE mollie_settlements (id TEXT PRIMARY KEY, reference TEXT NOT NULL, settledAt TEXT, amountCents INTEGER NOT NULL DEFAULT 0,
      costsCents INTEGER NOT NULL DEFAULT 0, reserveHeldCents INTEGER NOT NULL DEFAULT 0, reserveReleasedCents INTEGER NOT NULL DEFAULT 0, fetchedAt TEXT NOT NULL);
    CREATE TABLE mollie_settlement_payments (settlementId TEXT NOT NULL, molliePaymentId TEXT NOT NULL, amountCents INTEGER NOT NULL, paidAt TEXT,
      description TEXT, splitId TEXT, PRIMARY KEY (settlementId, molliePaymentId));`);
  upV3(db);
  upV3b(db);
  assert.ok(columns(db, 'mollie_settlements').includes('source'));
  assert.ok(columns(db, 'mollie_settlement_payments').includes('kind'));
  db.prepare("INSERT INTO mollie_settlement_payments (settlementId, molliePaymentId, amountCents, kind) VALUES ('s', 'p', 1, 'immediate'), ('s', 'p', 2, 'release')").run();
});

test('v3b — a database already on the final shape is untouched, and a rerun changes nothing', () => {
  const db = freshDb();
  upV3(db);
  db.prepare(`INSERT INTO mollie_settlements (id, reference, fetchedAt, source) VALUES ('stl_k', '19274230.2611.01', '${DAY}', 'balance')`).run();
  upV3b(db);
  upV3b(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mollie_settlements').get().n, 1, 'nothing re-readable is dropped from a final shape');
});

test('v3b — a database with no Mollie table at all (v3 never ran) gets them all', () => {
  const db = freshDb();
  upV3b(db);
  assert.ok(columns(db, 'mollie_payment_splits').includes('sourceType'));
});

test('rule 8 — the bare keys of paid links move onto #immediat; a complement moves on whichever row the ledger drew it', () => {
  const db = freshDb();
  db.exec(`INSERT INTO payment_links (id, reservationId, type, status, paidAt, amountCents) VALUES
      (1, 10, 'balance', 'paid', '${AT}', 1000),
      (2, 11, 'complement', 'paid', '${AT}', 1000),
      (3, 12, 'deposit', 'paid', NULL, 1000),
      (4, 13, 'deposit', 'paid', '${AT}', 0);
    INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt) VALUES
      ('t', 10, 'balance', 800, 'x'), ('t', 11, 'checkoutComplement', 800, 'x'), ('t', 12, 'deposit', 800, 'x'), ('t', 13, 'deposit', 800, 'x');`);
  upV3(db);
  upV3b(db);
  const keys = db.prepare('SELECT reservationId, ledgerKey FROM bank_reconciliation_lines ORDER BY reservationId').all().map((r) => `${r.reservationId}:${r.ledgerKey}`);
  assert.deepEqual(keys, ['10:balance#immediat', '11:checkoutComplement#immediat', '12:deposit', '13:deposit'],
    'only the links the splits model splits (paid, dated, above zero) are rewritten');
});

test('rule 8 — a discard whose #immediat twin already exists is dropped, not left behind by the primary key', () => {
  const db = freshDb();
  db.exec(`INSERT INTO payment_links (id, reservationId, type, status, paidAt, amountCents) VALUES (1, 10, 'balance', 'paid', '${AT}', 1000);
    INSERT INTO bank_reconciliation_discards VALUES ('t1', 10, 'balance', 'x'), ('t1', 10, 'balance#immediat', 'x'), ('t2', 10, 'balance', 'x');`);
  upV3b(db);
  assert.deepEqual(db.prepare('SELECT transactionId, ledgerKey FROM bank_reconciliation_discards ORDER BY transactionId').all(),
    [{ transactionId: 't1', ledgerKey: 'balance#immediat' }, { transactionId: 't2', ledgerKey: 'balance#immediat' }]);
});
