/**
 * The plugin-owned tables of the bank reconciliation (specs/qonto-bank-reconciliation.md §5), created by
 * the migration `reconciliation_v1`. No core table is touched (plugin rule 6).
 */

const TABLES = ['bank_transactions', 'bank_reconciliation_lines', 'bank_reconciliation_fiche_writes',
  'bank_reconciliation_discards', 'bank_transactions_outside'];

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

module.exports = { TABLES, up, upV2 };
