/**
 * The `hourly-resources` plugin's migrations (specs/plugins-phase-3c-hourly-resources.md rules 7, 16,
 * 25 and §5).
 *
 * `resource_bookings` left the core baseline: on an existing database it is already there and
 * `CREATE TABLE IF NOT EXISTS` keeps every row; on a new one it appears at install.
 *
 * The evening supplements the arrival SAS wrote before this phase are custom lines like any other.
 * They are tagged with the plugin's key, so the dialog stops taking them for its own and a re-commit
 * replaces them instead of keeping a copy.
 */

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const hasColumn = (db, table, column) => hasTable(db, table)
  && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

const SUPPLEMENT_SUFFIX = ' — supplément soirée';

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resourceId INTEGER NOT NULL,
      reservationId INTEGER,
      clientId INTEGER,
      clientName TEXT,
      clientPhone TEXT,
      propertyId INTEGER,
      date TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      notes TEXT DEFAULT '',
      totalPrice REAL DEFAULT 0,
      paid INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE SET NULL,
      FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE SET NULL,
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resource_bookings_date ON resource_bookings(date);
    CREATE INDEX IF NOT EXISTS idx_resource_bookings_propertyId ON resource_bookings(propertyId);
    CREATE INDEX IF NOT EXISTS idx_resource_bookings_reservationId ON resource_bookings(reservationId);
    CREATE INDEX IF NOT EXISTS idx_resource_bookings_resourceId ON resource_bookings(resourceId);
  `);
  // The unique slot index is skipped on a legacy table that already holds duplicates: db hygiene
  // reports them, and refusing the install would lock the operator out of the plugin.
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_bookings_slot ON resource_bookings(resourceId, date, startTime, endTime)');
  } catch { /* duplicates already stored */ }
}

// A SAS-made custom line named after a `per_hour` resource the stay carries is that resource's
// supplement. One stay, one line per resource: anything else stays an ordinary custom line.
function tagEveningSupplements(db) {
  if (!hasColumn(db, 'reservation_custom_options', 'sasLineKey')) return;
  const rows = db.prepare(`
    SELECT rco.id, rr.resourceId
      FROM reservation_custom_options rco
      JOIN reservation_resources rr ON rr.reservationId = rco.reservationId
      JOIN resources r ON r.id = rr.resourceId AND r.priceType = 'per_hour'
     WHERE COALESCE(rco.sasArrivalOrigin, 0) = 1
       AND rco.sasLineKey IS NULL
       AND rco.description = r.name || ?
  `).all(SUPPLEMENT_SUFFIX);
  const tag = db.prepare('UPDATE reservation_custom_options SET sasLineKey = ? WHERE id = ?');
  rows.forEach((row) => tag.run(`hourly-resources:evening:${row.resourceId}`, row.id));
}

// Rule 17 — what an erasure empties besides the table: the slot settings of the resources and the
// sessions of the stays. The free minutes stay (they are a price), and so do the sessions of a stay
// whose line explains its amount by them — every line is kept, so every session is kept with it.
// One list for the reset and for the warning that announces it: nothing is erased unannounced.
const HOURLY_COLUMN_RESETS = [
  ['isComplex', '0'], ['showsPlanningCard', '0'], ['hourlyEveningStart', 'NULL'], ['hourlyEveningRate', '0'],
  ['hourlyExternalDayRate', '0'], ['hourlyExternalEveningRate', '0'], ['heatUpMinutes', '0'],
  ['heatRetentionMinutes', '0'], ['turnoverMinutes', '0'],
];

function presentResets(db) {
  if (!hasTable(db, 'resources')) return [];
  const columns = new Set(db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name));
  return HOURLY_COLUMN_RESETS.filter(([column]) => columns.has(column));
}

function resetHourlyColumns(db) {
  const sets = presentResets(db).map(([column, value]) => `${column} = ${value}`);
  if (sets.length > 0) db.exec(`UPDATE resources SET ${sets.join(', ')}`);
}

// The resources the reset would change: one setting at least away from its reset value.
function countHourlySettings(db) {
  const differs = presentResets(db).map(([column, value]) => (value === 'NULL' ? `${column} IS NOT NULL` : `COALESCE(${column}, ${value}) != ${value}`));
  if (differs.length === 0) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM resources WHERE ${differs.join(' OR ')}`).get().n;
}

// specs/resource-booking-pricing-and-invoicing.md §5 — offered time, the payment (the fiches' tender lines), the arrival,
// the billing address of a guest with no client record, and the Qonto invoice with its attachment. Every column is
// nullable or defaulted: an existing booking keeps its price (`offeredMinutes = 0`).
const BOOKING_COLUMNS_V2 = [
  ['offeredMinutes', 'INTEGER NOT NULL DEFAULT 0'],
  ['paymentTenders', 'TEXT'],
  ['paidAt', 'TEXT'],
  ['paymentRecordedAt', 'TEXT'],
  ['arrivedAt', 'TEXT'],
  ['billingStreet', 'TEXT'],
  ['billingPostcode', 'TEXT'],
  ['billingCity', 'TEXT'],
  ['billingCountry', 'TEXT'],
  ['qontoClientId', 'TEXT'],
  ['qontoInvoiceId', 'TEXT'],
  ['invoiceNumber', 'TEXT'],
  ['invoiceIssuedAt', 'TEXT'],
  ['invoiceVatRate', 'REAL'],
  ['invoiceTotal', 'REAL'],
  ['invoiceMarkedPaid', 'INTEGER NOT NULL DEFAULT 0'],
  ['invoiceCancelledAt', 'TEXT'],
  ['attachmentState', 'TEXT'],
  ['attachmentTransactionId', 'TEXT'],
  ['attachmentId', 'TEXT'],
  ['attachmentAttempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['attachmentLastError', 'TEXT'],
];

// A booking ticked « Payé » before this spec keeps its tick: it gets a payment day (its last change) and no method.
// `paymentRecordedAt` stays empty, so it never reaches the journal (A4).
function bookingsV2(db) {
  if (!hasTable(db, 'resource_bookings')) return;
  BOOKING_COLUMNS_V2.forEach(([column, type]) => {
    if (!hasColumn(db, 'resource_bookings', column)) db.exec(`ALTER TABLE resource_bookings ADD COLUMN ${column} ${type}`);
  });
  if (!hasColumn(db, 'resource_bookings', 'paid')) return;
  const when = ['updatedAt', 'createdAt'].filter((c) => hasColumn(db, 'resource_bookings', c));
  const day = when.length ? `date(COALESCE(${when.join(', ')}, 'now'))` : "date('now')";
  db.exec(`UPDATE resource_bookings SET paidAt = ${day} WHERE paid = 1 AND paidAt IS NULL`);
}

// specs/resource-booking-pricing-and-invoicing.md rules 34-36 — the VAT rate is frozen with the payment (`paidVatRate`,
// NULL = not subject), and an invoice whose « marquer payée » Qonto did not take is retried (`invoiceMarkPending`).
// A booking paid before this migration gets the rate in force now — the rate its sale was journaled with until then;
// an invoiced one keeps the rate its invoice states.
const BOOKING_COLUMNS_V3 = [
  ['paidVatRate', 'REAL'],
  ['invoiceMarkPending', 'INTEGER NOT NULL DEFAULT 0'],
];

function bookingsV3(db, rateOf) {
  if (!hasTable(db, 'resource_bookings')) return;
  BOOKING_COLUMNS_V3.forEach(([column, type]) => {
    if (!hasColumn(db, 'resource_bookings', column)) db.exec(`ALTER TABLE resource_bookings ADD COLUMN ${column} ${type}`);
  });
  const rows = db.prepare('SELECT id, reservationId, date, invoiceVatRate, qontoInvoiceId FROM resource_bookings WHERE paidAt IS NOT NULL').all();
  const freeze = db.prepare('UPDATE resource_bookings SET paidVatRate = ? WHERE id = ?');
  rows.forEach((row) => {
    const rate = row.qontoInvoiceId && row.invoiceVatRate !== null ? row.invoiceVatRate : rateOf(db, row);
    freeze.run(rate === undefined ? null : rate, row.id);
  });
}

// specs/resource-booking-pricing-and-invoicing.md rule 50 — the identity (name and billing address) a booking's Qonto
// client was created with: a later invoice reuses that client only for the same identity. NULL on a booking invoiced
// before: its Qonto client is not reused, the next invoice creates one with what the record holds.
const BOOKING_COLUMNS_V4 = [
  ['qontoClientIdentity', 'TEXT'],
];

function bookingsV4(db) {
  if (!hasTable(db, 'resource_bookings')) return;
  BOOKING_COLUMNS_V4.forEach(([column, type]) => {
    if (!hasColumn(db, 'resource_bookings', column)) db.exec(`ALTER TABLE resource_bookings ADD COLUMN ${column} ${type}`);
  });
}

/** @param {(db, row: { reservationId, date }) => number|null} rateOf the rate in force for a booking (rule 5) */
function migrationsFor(rateOf) {
  return [
    { name: 'tables_v1', up: createTables },
    { name: 'tag_evening_supplements_v1', up: tagEveningSupplements },
    { name: 'resource_bookings_v2', up: bookingsV2 },
    { name: 'resource_bookings_v3', up: (db) => bookingsV3(db, rateOf) },
    { name: 'resource_bookings_v4', up: bookingsV4 },
  ];
}

module.exports = {
  migrationsFor, BOOKING_COLUMNS_V2, BOOKING_COLUMNS_V3, BOOKING_COLUMNS_V4, bookingsV2, bookingsV3, bookingsV4, createTables, hasColumn, tagEveningSupplements, resetHourlyColumns, countHourlySettings, hasTable, SUPPLEMENT_SUFFIX,
};
