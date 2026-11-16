/**
 * The plugin-owned tables of the bank reconciliation (specs/qonto-bank-reconciliation.md §5), created by
 * the migration `reconciliation_v1`. No core table is touched (plugin rule 6).
 */

const TABLES = ['bank_transactions', 'bank_reconciliation_lines', 'bank_reconciliation_fiche_writes',
  'bank_reconciliation_discards', 'bank_transactions_outside', 'mollie_payment_splits', 'mollie_settlements',
  'mollie_settlement_payments', 'mollie_balance_transactions'];

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id TEXT PRIMARY KEY,
      bankAccountId TEXT NOT NULL,
      amountCents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      settledAt TEXT, emittedAt TEXT, updatedAt TEXT,
      operationType TEXT, label TEXT, counterpartyName TEXT, reference TEXT, note TEXT,
      source TEXT NOT NULL DEFAULT 'qonto',
      fetchedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_settled ON bank_transactions (settledAt);
    CREATE TABLE IF NOT EXISTS bank_reconciliation_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transactionId TEXT NOT NULL, reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
      amountCents INTEGER NOT NULL, createdAt TEXT NOT NULL, createdBy INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_lines_tx ON bank_reconciliation_lines (transactionId);
    CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_lines_res ON bank_reconciliation_lines (reservationId);
    CREATE TABLE IF NOT EXISTS bank_reconciliation_fiche_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
      transactionIds TEXT NOT NULL,
      priorJson TEXT NOT NULL,
      writtenJson TEXT NOT NULL,
      createdAt TEXT NOT NULL, createdBy INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_writes_res ON bank_reconciliation_fiche_writes (reservationId, ledgerKey);
    CREATE TABLE IF NOT EXISTS bank_reconciliation_discards (
      transactionId TEXT NOT NULL, reservationId INTEGER NOT NULL, ledgerKey TEXT NOT NULL,
      createdAt TEXT NOT NULL, PRIMARY KEY (transactionId, reservationId, ledgerKey)
    );
    CREATE TABLE IF NOT EXISTS bank_transactions_outside (
      transactionId TEXT PRIMARY KEY, createdAt TEXT NOT NULL, createdBy INTEGER
    );
  `);
}

/** `reconciliation_v2` — who confirmed a line and with which others (specs/reconciliation-assisted-matching.md §5). */
function upV2(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(bank_reconciliation_lines)').all().map((c) => c.name));
  if (!columns.has('auto')) db.exec('ALTER TABLE bank_reconciliation_lines ADD COLUMN auto INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('groupId')) db.exec('ALTER TABLE bank_reconciliation_lines ADD COLUMN groupId TEXT');
}

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

/**
 * `reconciliation_v3` (specs/mollie-rolling-reserve-and-incoming-payments.md §5) — the split of a Mollie payment (a link, a
 * Qonto invoice or a card payment recorded on site: `sourceType` + `sourceKey`), the
 * settlements read from Mollie, the Qonto transaction id, and the reconciliation lines of a paid link moved onto its
 * immediate tranche (rule 8). Idempotent: a rerun finds nothing to rewrite.
 */
function upV3(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mollie_payment_splits (
      sourceType TEXT NOT NULL, sourceKey TEXT NOT NULL,
      reservationId INTEGER, ledgerKey TEXT,
      grossCents INTEGER NOT NULL, immediateCents INTEGER NOT NULL, reserveCents INTEGER NOT NULL,
      ratePercent REAL NOT NULL, holdDays INTEGER NOT NULL,
      paidAt TEXT NOT NULL, molliePaymentId TEXT, refundedCents INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (sourceType, sourceKey)
    );
    CREATE INDEX IF NOT EXISTS idx_mollie_payment_splits_res ON mollie_payment_splits (reservationId);
    CREATE TABLE IF NOT EXISTS mollie_settlements (
      id TEXT PRIMARY KEY, reference TEXT NOT NULL, settledAt TEXT,
      amountCents INTEGER NOT NULL DEFAULT 0, costsCents INTEGER NOT NULL DEFAULT 0,
      reserveHeldCents INTEGER NOT NULL DEFAULT 0, reserveReleasedCents INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'payments',
      fetchedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mollie_settlements_ref ON mollie_settlements (reference);
    CREATE TABLE IF NOT EXISTS mollie_settlement_payments (
      settlementId TEXT NOT NULL, molliePaymentId TEXT NOT NULL,
      amountCents INTEGER NOT NULL, paidAt TEXT, description TEXT, splitId TEXT,
      kind TEXT NOT NULL DEFAULT 'immediate', grossCents INTEGER, reserveCents INTEGER, feeCents INTEGER,
      PRIMARY KEY (settlementId, molliePaymentId, kind)
    );
    CREATE TABLE IF NOT EXISTS mollie_balance_transactions (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, createdAt TEXT NOT NULL,
      resultCents INTEGER NOT NULL, initialCents INTEGER NOT NULL, deductionsCents INTEGER NOT NULL DEFAULT 0,
      settlementId TEXT, paymentId TEXT, description TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mollie_balance_transactions_at ON mollie_balance_transactions (createdAt);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(bank_transactions)').all().map((c) => c.name));
  if (!columns.has('qontoReference')) db.exec('ALTER TABLE bank_transactions ADD COLUMN qontoReference TEXT');
  if (!hasTable(db, 'payment_links')) return;
  const { linkLedgerKey } = require('./molliePaymentSplits');
  const numbers = hasTable(db, 'reservation_installments')
    ? new Map(db.prepare('SELECT id, number FROM reservation_installments').all().map((i) => [Number(i.id), Number(i.number)]))
    : new Map();
  const hasBasket = db.prepare('PRAGMA table_info(payment_links)').all().some((c) => c.name === 'basketJson');
  const hasInstallmentId = db.prepare('PRAGMA table_info(payment_links)').all().some((c) => c.name === 'installmentId');
  const links = db.prepare(`SELECT id, reservationId, type${hasBasket ? ', basketJson' : ''}${hasInstallmentId ? ', installmentId' : ''}
    FROM payment_links WHERE status = 'paid'`).all();
  const rewrite = ['bank_reconciliation_lines', 'bank_reconciliation_discards']
    .map((table) => db.prepare(`UPDATE OR IGNORE ${table} SET ledgerKey = ledgerKey || '#immediat' WHERE reservationId = ? AND ledgerKey = ?`));
  db.transaction(() => {
    links.forEach((link) => {
      const key = linkLedgerKey(link, (id) => numbers.get(Number(id)) ?? null);
      if (key) rewrite.forEach((statement) => statement.run(Number(link.reservationId), key));
    });
  })();
}

module.exports = { TABLES, up, upV2, upV3 };
