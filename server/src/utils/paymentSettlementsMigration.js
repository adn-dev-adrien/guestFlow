/**
 * Schema of the split payments (specs/mixed-method-payments.md §5). Idempotent and additive: two new
 * tables, and the four per-reservation aggregates every reader of the stay's money takes from the row it
 * already loads (the installments' pattern). Existing payments have no settlement and read as before.
 */

const SETTLEMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS payment_settlements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId  INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    targetKind     TEXT NOT NULL CHECK (targetKind IN ('bucket','arrivalGroup','midStayNote','installment')),
    targetKey      TEXT NOT NULL,
    paidDate       TEXT NOT NULL,
    dueCents       INTEGER NOT NULL CHECK (dueCents > 0),
    shortfallCents INTEGER NOT NULL DEFAULT 0 CHECK (shortfallCents >= 0),
    shortfallKind  TEXT CHECK (shortfallKind IN ('due','waived')),
    parts          TEXT NOT NULL DEFAULT '[]',
    createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt      TEXT,
    CHECK ((shortfallCents = 0) = (shortfallKind IS NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_payment_settlements_target ON payment_settlements(reservationId, targetKind, targetKey);
  CREATE TABLE IF NOT EXISTS payment_tenders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    settlementId INTEGER NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    method       TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other','prepaid')),
    amountCents  INTEGER NOT NULL CHECK (amountCents > 0),
    internal     INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash')),
    source       TEXT,
    ref          TEXT,
    label        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_payment_tenders_settlement ON payment_tenders(settlementId);
`;

// SDK 2.33.0 — the tender lines of a plugin's prepaid instrument (specs/mixed-method-payments.md rules 60-63): `method` gains
// `'prepaid'` and the line carries the plugin's `source`, its own `ref` and the `label` it was given. SQLite cannot widen a CHECK
// in place, so a table written before is rebuilt inside one transaction (create new, copy every row and value, swap). Idempotent:
// a table whose CHECK already allows `'prepaid'` is left alone. Returns the number of rows carried over, or null.
const TENDERS_REBUILT_DDL = `
  CREATE TABLE payment_tenders__new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    settlementId INTEGER NOT NULL REFERENCES payment_settlements(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    method       TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other','prepaid')),
    amountCents  INTEGER NOT NULL CHECK (amountCents > 0),
    internal     INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash')),
    source       TEXT,
    ref          TEXT,
    label        TEXT
  )`;

function tendersAllowPrepaid(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payment_tenders'").get();
  return !row || String(row.sql).includes("'prepaid'");
}

function allowPrepaidTenders(db) {
  if (tendersAllowPrepaid(db)) return null;
  let copied = 0;
  db.transaction(() => {
    const existing = db.prepare('PRAGMA table_info(payment_tenders)').all().map((c) => c.name);
    const carried = ['id', 'settlementId', 'position', 'method', 'amountCents', 'internal', 'source', 'ref', 'label'].filter((c) => existing.includes(c));
    db.exec('DROP TABLE IF EXISTS payment_tenders__new');
    db.exec(TENDERS_REBUILT_DDL);
    copied = db.prepare(`INSERT INTO payment_tenders__new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM payment_tenders`).run().changes;
    db.exec('DROP TABLE payment_tenders');
    db.exec('ALTER TABLE payment_tenders__new RENAME TO payment_tenders');
    db.exec('CREATE INDEX IF NOT EXISTS idx_payment_tenders_settlement ON payment_tenders(settlementId)');
  })();
  return copied;
}

const AGGREGATE_COLUMNS = ['splitOffBooksAmount', 'splitWaivedAmount', 'splitWaivedCashAmount', 'splitShortfallDue'];

function migratePaymentSettlementsSchema(db) {
  const hasReservations = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservations'").get();
  if (!hasReservations) return;
  const hadTenders = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_tenders'").get();
  db.transaction(() => {
    db.exec(SETTLEMENTS_DDL);
    const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
    for (const column of AGGREGATE_COLUMNS) {
      if (!columns.includes(column)) db.exec(`ALTER TABLE reservations ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
    }
  })();
  if (hadTenders) allowPrepaidTenders(db);
}

module.exports = {
  migratePaymentSettlementsSchema, allowPrepaidTenders, tendersAllowPrepaid, AGGREGATE_COLUMNS,
};
