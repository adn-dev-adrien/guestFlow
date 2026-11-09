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
    method       TEXT NOT NULL CHECK (method IN ('card','cash','cheque','transfer','holidayVoucher','other')),
    amountCents  INTEGER NOT NULL CHECK (amountCents > 0),
    internal     INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1) AND (internal = 0 OR method = 'cash'))
  );
  CREATE INDEX IF NOT EXISTS idx_payment_tenders_settlement ON payment_tenders(settlementId);
`;

const AGGREGATE_COLUMNS = ['splitOffBooksAmount', 'splitWaivedAmount', 'splitWaivedCashAmount', 'splitShortfallDue'];

function migratePaymentSettlementsSchema(db) {
  const hasReservations = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservations'").get();
  if (!hasReservations) return;
  db.transaction(() => {
    db.exec(SETTLEMENTS_DDL);
    const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
    for (const column of AGGREGATE_COLUMNS) {
      if (!columns.includes(column)) db.exec(`ALTER TABLE reservations ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
    }
  })();
}

module.exports = { migratePaymentSettlementsSchema, AGGREGATE_COLUMNS };
