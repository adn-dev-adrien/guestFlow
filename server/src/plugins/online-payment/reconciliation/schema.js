/**
 * The plugin-owned tables of the bank reconciliation (specs/qonto-bank-reconciliation.md §5), created by
 * the migration `reconciliation_v1`. No core table is touched (plugin rule 6).
 */

const TABLES = ['bank_transactions', 'bank_reconciliation_lines', 'bank_reconciliation_fiche_writes',
  'bank_reconciliation_discards', 'bank_transactions_outside', 'mollie_payment_splits', 'mollie_settlements',
  'mollie_settlement_payments', 'mollie_balance_transactions', 'mollie_settlement_failures'];

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
const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

// The Mollie tables of specs/mollie-rolling-reserve-and-incoming-payments.md §5, in their final shape.
const MOLLIE_SETTLEMENTS_SQL = `
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
  );`;

const MOLLIE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS mollie_payment_splits (
    sourceType TEXT NOT NULL, sourceKey TEXT NOT NULL,
    reservationId INTEGER, ledgerKey TEXT,
    grossCents INTEGER NOT NULL, immediateCents INTEGER NOT NULL, reserveCents INTEGER NOT NULL,
    ratePercent REAL NOT NULL, holdDays INTEGER NOT NULL,
    paidAt TEXT NOT NULL, molliePaymentId TEXT, refundedCents INTEGER NOT NULL DEFAULT 0, refundCheckedAt TEXT,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (sourceType, sourceKey)
  );
  CREATE INDEX IF NOT EXISTS idx_mollie_payment_splits_res ON mollie_payment_splits (reservationId);
  ${MOLLIE_SETTLEMENTS_SQL}
  CREATE TABLE IF NOT EXISTS mollie_balance_transactions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, createdAt TEXT NOT NULL,
    resultCents INTEGER NOT NULL, initialCents INTEGER NOT NULL, deductionsCents INTEGER NOT NULL DEFAULT 0,
    settlementId TEXT, paymentId TEXT, description TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mollie_balance_transactions_at ON mollie_balance_transactions (createdAt);
  CREATE TABLE IF NOT EXISTS mollie_settlement_failures (
    reference TEXT PRIMARY KEY, failedAt TEXT NOT NULL, retryAt TEXT NOT NULL, message TEXT NOT NULL
  );`;

/**
 * The bare ledger keys a paid link's reconciliation lines may carry before rule 8: the row of its type — and, for a
 * complement, the row the ledger draws when it is deferred to the check-out.
 */
function bareKeysOf(link, numbers) {
  const { linkLedgerKey } = require('./molliePaymentSplits');
  const key = linkLedgerKey(link, (id) => numbers.get(Number(id)) ?? null);
  if (!key) return [];
  return key === 'complement' ? ['complement', 'checkoutComplement'] : [key];
}

/**
 * Rule 8 — the reconciliation lines and discards of a paid link move onto its `#immediat` tranche. Reads exactly the links
 * the splits model splits (`PAID_LINK_FILTER`). A discard whose target already exists is dropped (the primary key would
 * refuse the move); a line has no such key and always moves. Idempotent: a rerun finds nothing to rewrite.
 */
function rewriteLinkKeys(db) {
  if (!hasTable(db, 'payment_links')) return;
  const { PAID_LINK_FILTER } = require('./molliePaymentSplits');
  const numbers = hasTable(db, 'reservation_installments')
    ? new Map(db.prepare('SELECT id, number FROM reservation_installments').all().map((i) => [Number(i.id), Number(i.number)]))
    : new Map();
  const have = columnsOf(db, 'payment_links');
  const links = db.prepare(`SELECT l.id, l.reservationId, l.type${have.has('basketJson') ? ', l.basketJson' : ''}${have.has('installmentId') ? ', l.installmentId' : ''}
    FROM payment_links l WHERE ${PAID_LINK_FILTER}`).all();
  const moveLines = db.prepare("UPDATE bank_reconciliation_lines SET ledgerKey = ledgerKey || '#immediat' WHERE reservationId = ? AND ledgerKey = ?");
  const dropShadowed = db.prepare(`DELETE FROM bank_reconciliation_discards WHERE reservationId = ? AND ledgerKey = ? AND EXISTS (
    SELECT 1 FROM bank_reconciliation_discards d WHERE d.transactionId = bank_reconciliation_discards.transactionId
      AND d.reservationId = bank_reconciliation_discards.reservationId AND d.ledgerKey = bank_reconciliation_discards.ledgerKey || '#immediat')`);
  const moveDiscards = db.prepare("UPDATE bank_reconciliation_discards SET ledgerKey = ledgerKey || '#immediat' WHERE reservationId = ? AND ledgerKey = ?");
  db.transaction(() => {
    links.forEach((link) => {
      bareKeysOf(link, numbers).forEach((key) => {
        moveLines.run(Number(link.reservationId), key);
        dropShadowed.run(Number(link.reservationId), key);
        moveDiscards.run(Number(link.reservationId), key);
      });
    });
  })();
}

/**
 * `reconciliation_v3` (specs/mollie-rolling-reserve-and-incoming-payments.md §5) — the split of a Mollie payment (a link, a
 * Qonto invoice or a card payment recorded on site: `sourceType` + `sourceKey`), the
 * settlements read from Mollie, the Qonto transaction id, and the reconciliation lines of a paid link moved onto its
 * immediate tranche (rule 8). Idempotent: a rerun finds nothing to rewrite.
 */
function upV3(db) {
  db.exec(MOLLIE_TABLES_SQL);
  if (!columnsOf(db, 'bank_transactions').has('qontoReference')) db.exec('ALTER TABLE bank_transactions ADD COLUMN qontoReference TEXT');
  rewriteLinkKeys(db);
}

/**
 * `reconciliation_v3b` — reaches the final Mollie schema from ANY state. Development and shadow databases ran drafts of
 * `reconciliation_v3` that the migration ledger never re-runs: the first draft kept `payment_link_splits` and settlement
 * payments keyed by `paymentLinkId`; the second had `mollie_payment_splits` but settlements without `source` and
 * payments without `kind`. The two settlement tables hold only what Mollie can say again, so a draft shape is dropped
 * and re-created (the next read fills it); the splits are copied from the first draft's table. Everything else is
 * `IF NOT EXISTS` / a column check. A database already on the final shape is untouched.
 */
function upV3b(db) {
  const settlementShape = hasTable(db, 'mollie_settlements') && columnsOf(db, 'mollie_settlements').has('source');
  const paymentShape = hasTable(db, 'mollie_settlement_payments') && columnsOf(db, 'mollie_settlement_payments').has('kind');
  if ((hasTable(db, 'mollie_settlements') && !settlementShape) || (hasTable(db, 'mollie_settlement_payments') && !paymentShape)) {
    db.exec('DROP TABLE IF EXISTS mollie_settlement_payments; DROP TABLE IF EXISTS mollie_settlements;');
  }
  db.exec(MOLLIE_TABLES_SQL);
  const bank = columnsOf(db, 'bank_transactions');
  if (bank.size > 0 && !bank.has('qontoReference')) db.exec('ALTER TABLE bank_transactions ADD COLUMN qontoReference TEXT');
  if (!columnsOf(db, 'mollie_payment_splits').has('refundCheckedAt')) db.exec('ALTER TABLE mollie_payment_splits ADD COLUMN refundCheckedAt TEXT');
  if (hasTable(db, 'payment_link_splits')) {
    db.exec(`INSERT OR IGNORE INTO mollie_payment_splits
      (sourceType, sourceKey, reservationId, ledgerKey, grossCents, immediateCents, reserveCents, ratePercent, holdDays, paidAt, molliePaymentId, refundedCents, createdAt)
      SELECT 'link', paymentLinkId, reservationId, ledgerKey, grossCents, immediateCents, reserveCents, ratePercent, holdDays, paidAt, molliePaymentId, refundedCents, createdAt
      FROM payment_link_splits;
      DROP TABLE payment_link_splits;`);
  }
  rewriteLinkKeys(db);
}

module.exports = { TABLES, up, upV2, upV3, upV3b };
