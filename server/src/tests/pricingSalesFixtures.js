// Shared by the PR C schema suites (pricing-sales-migration, pricing-sales-migration-rollback): the schema as the previous release
// left it, a populated state, and the helpers that read a table in its physical order.
const Database = require('better-sqlite3');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');

const OLD_DDL = `
  CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, countsAsDirect INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, showsPlanningCard INTEGER DEFAULT 0, isCancellationInsurance INTEGER DEFAULT 0);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, priceType TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', platform TEXT, createdAt TEXT, finalPrice REAL NOT NULL DEFAULT 0,
    touristTaxTotal REAL DEFAULT 0, arrivalExtrasBaseline TEXT,
    depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT, depositAmount REAL DEFAULT 0, depositPaidCash INTEGER DEFAULT 0,
    balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceAmount REAL DEFAULT 0, balancePaidCash INTEGER DEFAULT 0,
    accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL, touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, cardOccurrences TEXT, cardPersons REAL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, optionId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_reservation_options_reservationId ON reservation_options(reservationId);
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sessions TEXT,
    PRIMARY KEY (reservationId, resourceId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')), inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, eventType TEXT NOT NULL DEFAULT 'update', changedFields TEXT NOT NULL DEFAULT '[]', createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE reservation_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, refundDate TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'transfer',
    totalTtc REAL NOT NULL DEFAULT 0, reason TEXT DEFAULT '', createdAt TEXT DEFAULT (datetime('now')), afterCancellation INTEGER
  );
  CREATE TABLE reservation_refund_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, refundId INTEGER NOT NULL, lineKey TEXT, label TEXT NOT NULL, bucket TEXT NOT NULL,
    quantity REAL, unitPrice REAL, amountTtc REAL NOT NULL, vatRate REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE cancellation_compensations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, origin TEXT NOT NULL DEFAULT 'platform', receivedAmount REAL, receivedDate TEXT
  );
  CREATE TABLE payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'full', amountCents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open', paidAt TEXT, createdAt TEXT DEFAULT (datetime('now')), cancelReason TEXT, basketJson TEXT,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement')), CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  );
  CREATE INDEX idx_payment_links_reservation ON payment_links(reservationId);
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL, sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT '',
    CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
  );
  CREATE INDEX idx_email_log_reservation ON email_log(reservationId);
  CREATE TABLE guest_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, status TEXT NOT NULL, linesJson TEXT NOT NULL);
`;

function oldDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(OLD_DDL);
  return db;
}

// Rows inserted out of article order on purpose: the physical order is what the unsorted readers see.
function seed(db) {
  db.exec(`
    INSERT INTO platforms (name, countsAsDirect) VALUES ('Booking.com', 0), ('Site', 1);
    INSERT INTO options (id, title, priceType) VALUES (1, 'Petit-déjeuner', 'per_person'), (2, 'Bois', 'per_stay'), (3, 'Bain', 'per_hour');
    INSERT INTO resources (id, name, priceType) VALUES (5, 'Spa', 'per_stay'), (6, 'Sauna', 'per_stay');
    INSERT INTO reservations (id, kind, platform, createdAt, finalPrice) VALUES (10, 'reservation', 'direct', '2026-01-05 10:00:00', 400), (11, 'reservation', 'Booking.com', '2026-02-05 10:00:00', 300);
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, cardOccurrences) VALUES
      (10, 3, 1, 15, 1, 'per_hour', 15, 0, 0, NULL), (10, 1, 2, 10, 2, 'per_person', 20, 0, 0, '[{"date":"2026-01-06"}]'), (11, 2, 1, 20, 1, 'per_stay', 35, 0, 1, NULL), (10, 2, 1, 20, 1, 'per_stay', 35, 0, 1, NULL);
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement) VALUES (10, 6, 1, 30, 1, 'per_stay', 30, 0), (10, 5, 1, 40, 1, 'per_stay', 40, 1);
    INSERT INTO payment_links (reservationId, type, amountCents, status) VALUES (10, 'full', 40000, 'paid'), (11, 'balance', 1000, 'open');
    INSERT INTO email_log (templateId, reservationId, status, renderedSubject, renderedBody, recipientEmail) VALUES (1, 10, 'sent', 's1', 'b1', 'a@example.test'), (1, 11, 'failed', 's2', 'b2', 'b@example.test');
  `);
  runPricingLinesMigration(db);
}

const rowsInOrder = (db, table) => db.prepare(`SELECT rowid AS _rowid, * FROM ${table} ORDER BY rowid`).all();
const schemaHash = (db) => JSON.stringify(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all());

module.exports = { oldDatabase, seed, rowsInOrder, schemaHash };
