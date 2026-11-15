/**
 * The four tables of the plugin (specs/gift-vouchers.md §5), in one idempotent migration. No core column and no
 * foreign key into the core: a voucher outlives a deleted reservation and a deactivated plugin keeps its rows (rule 4).
 * `publicTokenEncrypted` keeps the voucher link (rule 21) re-sendable, like `guest_stay_links.tokenEncrypted`.
 * The ledger is append-only (rule 31): the triggers refuse an update and a delete.
 */

const { KINDS } = require('./voucherRules');

const list = (values) => values.map((v) => `'${v}'`).join(', ');

const TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS gift_voucher_orders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    publicTokenHash      TEXT UNIQUE,
    publicTokenEncrypted TEXT,
    amountCents          INTEGER NOT NULL CHECK (amountCents > 0),
    recipientName        TEXT NOT NULL DEFAULT '',
    senderName           TEXT NOT NULL DEFAULT '',
    message              TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    language             TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en')),
    termsVersionId       INTEGER,
    termsAcceptedAt      TEXT,
    visitorHash          TEXT,
    source               TEXT NOT NULL CHECK (source IN ('site', 'manual')),
    paymentMethod        TEXT,
    linkId               INTEGER,
    state                TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'issued')),
    createdAt            TEXT NOT NULL,
    createdBy            TEXT NOT NULL DEFAULT 'public'
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_orders_state ON gift_voucher_orders(state, createdAt);

  CREATE TABLE IF NOT EXISTS gift_vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId       INTEGER NOT NULL UNIQUE,
    number        TEXT NOT NULL UNIQUE,
    codeHash      TEXT NOT NULL UNIQUE,
    codeEncrypted TEXT NOT NULL,
    amountCents   INTEGER NOT NULL CHECK (amountCents > 0),
    issuedAt      TEXT NOT NULL,
    expiresOn     TEXT NOT NULL,
    cancelledAt   TEXT,
    mailSentAt    TEXT,
    mailError     TEXT
  );

  CREATE TABLE IF NOT EXISTS gift_voucher_movements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId      INTEGER NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN (${list(KINDS)})),
    amountCents    INTEGER NOT NULL DEFAULT 0,
    reservationId  INTEGER,
    devisId        INTEGER,
    actor          TEXT NOT NULL,
    note           TEXT,
    idempotencyKey TEXT NOT NULL UNIQUE,
    createdAt      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_movements_voucher ON gift_voucher_movements(voucherId, id);
  CREATE TRIGGER IF NOT EXISTS gift_voucher_movements_no_update BEFORE UPDATE ON gift_voucher_movements
    BEGIN SELECT RAISE(ABORT, 'gift_voucher_movements is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS gift_voucher_movements_no_delete BEFORE DELETE ON gift_voucher_movements
    BEGIN SELECT RAISE(ABORT, 'gift_voucher_movements is append-only'); END;

  CREATE TABLE IF NOT EXISTS gift_voucher_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visitorHash TEXT NOT NULL,
    outcome     TEXT NOT NULL CHECK (outcome IN ('usable', 'expired', 'exhausted', 'unknown', 'mistyped')),
    createdAt   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_checks_visitor ON gift_voucher_checks(visitorHash, createdAt);
  CREATE INDEX IF NOT EXISTS idx_gift_voucher_checks_at ON gift_voucher_checks(createdAt);
`;

const TABLES = Object.freeze(['gift_voucher_orders', 'gift_vouchers', 'gift_voucher_movements', 'gift_voucher_checks']);

const MIGRATIONS = Object.freeze([
  { name: 'gift_vouchers_tables_v1', up: (db) => db.exec(TABLES_SQL) },
]);

module.exports = { MIGRATIONS, TABLES };
