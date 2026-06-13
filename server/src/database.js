const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH env var lets CI/CD point to a persistent location outside the deployment folder.
// PERSISTENT_DB is used by deployment scripts. Falls back to the traditional location so existing dev setups are unaffected.
const dbPath = process.env.DB_PATH || process.env.PERSISTENT_DB || path.join(__dirname, '..', 'guestflow.db');
const db = new Database(dbPath);
// Exposed so index.js can surface it in the single boot banner without a second computation.
db.dbPath = dbPath;

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- CLIENTS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    streetNumber TEXT DEFAULT '',
    street TEXT DEFAULT '',
    postalCode TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  )
`);

// ---------- PROPERTIES (logements) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nameArticle TEXT DEFAULT 'au',
    photo TEXT DEFAULT '',
    maxAdults INTEGER DEFAULT 2,
    maxChildren INTEGER DEFAULT 0,
    maxBabies INTEGER DEFAULT 0,
    basePriceIncludedGuests INTEGER DEFAULT 0,
    extraGuestPrice REAL DEFAULT 0,
    singleBeds INTEGER DEFAULT 0,
    doubleBeds INTEGER DEFAULT 0,
    depositPercent REAL DEFAULT 30,
    depositDaysBefore INTEGER DEFAULT 30,
    balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00',
    defaultCheckOut TEXT DEFAULT '10:00',
    cleaningHours REAL DEFAULT 3,
    defaultCautionAmount REAL DEFAULT 500,
    touristTaxPerDayPerPerson REAL DEFAULT 0,
    touristTaxDepartmentPercentage REAL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  )
`);

// ---------- PRICING MODEL ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    label TEXT DEFAULT 'Standard',
    pricePerNight REAL NOT NULL DEFAULT 100,
    pricingMode TEXT NOT NULL DEFAULT 'fixed',
    progressiveTiers TEXT NOT NULL DEFAULT '[]',
    dateRanges TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '#1976d2',
    startDate TEXT,
    endDate TEXT,
    minNights INTEGER DEFAULT 1,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);

// ---------- DOCUMENTS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    name TEXT NOT NULL,
    filePath TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);

// ---------- OPTIONS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    price REAL NOT NULL DEFAULT 0,
    optionProgressiveTiers TEXT NOT NULL DEFAULT '[]',
    autoOptionType TEXT,
    autoEnabled INTEGER NOT NULL DEFAULT 0,
    autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
    autoFullNightThreshold TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

// priceType: per_stay, per_person, per_night, per_person_per_night, per_hour, per_participant_progressive

db.exec(`
  CREATE TABLE IF NOT EXISTS property_options (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  )
`);

// Per-property option PRICE overrides (specs/per-property-option-prices.md). Mirrors
// `property_resource_prices`: a row sets the effective unit price of `optionId` for `propertyId`;
// no row → the option's base `options.price`. Independent of `property_options` (a global option
// can carry overrides) and of `property_option_defaults` (the offered/free flag).
db.exec(`
  CREATE TABLE IF NOT EXISTS property_option_prices (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_property_option_prices_option ON property_option_prices(optionId)');

// Per-property option DEFAULTS (specs/weekly-bed-linen-tracking.md §3.7, 2026-06-03 follow-up).
// Decoupled from `property_options` (which is the availability filter): a row's presence here
// means "this option is added by default on every NEW reservation for this property"; `offered`
// is the second binary flag ("bed linen is included in the property price → free for the
// guest"). The two tables answer different questions and are independent.
db.exec(`
  CREATE TABLE IF NOT EXISTS property_option_defaults (
    propertyId INTEGER NOT NULL,
    optionId   INTEGER NOT NULL,
    offered    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
  )
`);

// ---------- RESERVATIONS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    clientId INTEGER NOT NULL,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    adults INTEGER DEFAULT 1,
    children INTEGER DEFAULT 0,
    teens INTEGER DEFAULT 0,
    babies INTEGER DEFAULT 0,
    singleBeds INTEGER,
    doubleBeds INTEGER,
    babyBeds INTEGER,
    checkInTime TEXT DEFAULT '15:00',
    checkOutTime TEXT DEFAULT '10:00',
    platform TEXT DEFAULT 'direct',
    totalPrice REAL,
    touristTaxRate REAL DEFAULT 0,
    touristTaxTotal REAL DEFAULT 0,
    discountPercent REAL DEFAULT 0,
    customPrice REAL,
    finalPrice REAL,
    depositAmount REAL DEFAULT 0,
    depositDueDate TEXT,
    depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0,
    balanceDueDate TEXT,
    balancePaid INTEGER DEFAULT 0,
    sourceType TEXT NOT NULL DEFAULT 'manual',
    sourcePlatformKey TEXT,
    sourceIcalSourceId INTEGER,
    sourceIcalEventUid TEXT,
    icalSyncLocked INTEGER NOT NULL DEFAULT 0,
    extraGuestSurchargeOffered INTEGER NOT NULL DEFAULT 0,
    blocksPreviousNight INTEGER NOT NULL DEFAULT 0,
    blocksNextNight INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
  )
`);

// ---------- RESERVATION OPTIONS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, optionId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  )
`);

// ---------- RESOURCES ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    propertyId INTEGER,
    note TEXT DEFAULT '',
    minimumUsageMinutes INTEGER NOT NULL DEFAULT 0,
    openDays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    turnoverMinutes INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
  )
`);

// Resource ↔ property applicability pivot (mirrors property_options). Empty = global (all logements).
db.exec(`
  CREATE TABLE IF NOT EXISTS resource_properties (
    resourceId INTEGER NOT NULL,
    propertyId INTEGER NOT NULL,
    PRIMARY KEY (resourceId, propertyId),
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_resource_properties_resourceId ON resource_properties(resourceId)');

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_resources (
    reservationId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, resourceId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS property_resource_prices (
    propertyId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    freeMinutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  )
`);

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
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_nights (
    reservationId INTEGER NOT NULL,
    date TEXT NOT NULL,
    seasonLabel TEXT DEFAULT 'Standard',
    pricingMode TEXT DEFAULT 'fixed',
    price REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, date),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    eventType TEXT NOT NULL DEFAULT 'update',
    changedFields TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  )
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    platformKey TEXT NOT NULL,
    platformLabel TEXT NOT NULL,
    platformColor TEXT NOT NULL DEFAULT '#757575',
    isActive INTEGER NOT NULL DEFAULT 1,
    collectsTouristTax INTEGER NOT NULL DEFAULT 1,
    lastSyncAt TEXT,
    lastSyncStatus TEXT,
    lastSyncMessage TEXT,
    lastImportedCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ical_import_events (
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
    reservationId INTEGER NOT NULL,
    eventHash TEXT NOT NULL,
    startDate TEXT NOT NULL DEFAULT '',
    endDate TEXT NOT NULL DEFAULT '',
    summaryNormalized TEXT NOT NULL DEFAULT '',
    lastSeenAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (sourceId, eventUid),
    FOREIGN KEY (sourceId) REFERENCES ical_sources(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  )
`);

// spec: ical-sync-override-locked-dates.md §5 — pending date-drift approvals.
// The sync engine records one pending row per locked reservation when the source platform
// shifts its dates; the Dashboard alert lets the user approve or reject. Acknowledged rows
// are kept for audit (no auto-cleanup in v1).
db.exec(`
  CREATE TABLE IF NOT EXISTS ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL,
    previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL,
    newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  )
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ical_drift_unack
    ON ical_date_drift_alerts(acknowledgedAt)
    WHERE acknowledgedAt IS NULL
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ical_drift_unack_reservation
    ON ical_date_drift_alerts(reservationId)
    WHERE acknowledgedAt IS NULL
`);

// spec: ical-cancellation-approval.md §5 — pending cancellation approvals.
// When the iCal sync detects that a reservation's UID has fallen out of every source
// feed, the engine stops auto-deleting and records one pending row here for the Dashboard
// alert. Acknowledged rows are kept for audit. The third partial index supports the
// auto-resolve lookup by (sourceId, eventUid) at O(log n).
db.exec(`
  CREATE TABLE IF NOT EXISTS ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  )
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack
    ON ical_cancellation_alerts(acknowledgedAt)
    WHERE acknowledgedAt IS NULL
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_reservation
    ON ical_cancellation_alerts(reservationId)
    WHERE acknowledgedAt IS NULL
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ical_cancel_unack_event
    ON ical_cancellation_alerts(sourceId, eventUid)
    WHERE acknowledgedAt IS NULL
`);

// ---------- MIGRATIONS ----------
// ALTER TABLE migrations are skipped when SKIP_MIGRATIONS=true.
// CREATE TABLE IF NOT EXISTS statements above always run — they are safe and idempotent.
// To apply schema changes: set SKIP_MIGRATIONS=false (or omit it) and restart the server once.
if (process.env.SKIP_MIGRATIONS !== 'true') {
const cols = db.prepare("PRAGMA table_info(reservations)").all().map(c => c.name);
if (!cols.includes('cautionAmount')) {
  db.exec("ALTER TABLE reservations ADD COLUMN cautionAmount REAL DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN cautionReceived INTEGER DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN cautionReceivedDate TEXT");
  db.exec("ALTER TABLE reservations ADD COLUMN cautionReturned INTEGER DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN cautionReturnedDate TEXT");
}
if (!cols.includes('singleBeds')) {
  db.exec("ALTER TABLE reservations ADD COLUMN singleBeds INTEGER");
}
if (!cols.includes('doubleBeds')) {
  db.exec("ALTER TABLE reservations ADD COLUMN doubleBeds INTEGER");
}
if (!cols.includes('babyBeds')) {
  db.exec("ALTER TABLE reservations ADD COLUMN babyBeds INTEGER");
}
if (!cols.includes('teens')) {
  db.exec("ALTER TABLE reservations ADD COLUMN teens INTEGER DEFAULT 0");
}
if (!cols.includes('sourceType')) {
  db.exec("ALTER TABLE reservations ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'manual'");
}
if (!cols.includes('customPrice')) {
  db.exec('ALTER TABLE reservations ADD COLUMN customPrice REAL');
}
if (!cols.includes('sourcePlatformKey')) {
  db.exec("ALTER TABLE reservations ADD COLUMN sourcePlatformKey TEXT");
}
if (!cols.includes('sourceIcalSourceId')) {
  db.exec("ALTER TABLE reservations ADD COLUMN sourceIcalSourceId INTEGER");
}
if (!cols.includes('sourceIcalEventUid')) {
  db.exec("ALTER TABLE reservations ADD COLUMN sourceIcalEventUid TEXT");
}
if (!cols.includes('icalSyncLocked')) {
  db.exec("ALTER TABLE reservations ADD COLUMN icalSyncLocked INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('icalOriginalSummary')) {
  // Authoritative original iCal guest name (set at import, never changed when the user renames the
  // client). Backed-fill best-effort from the legacy `Résumé:` line in notes. Not shown on the frontend.
  db.exec("ALTER TABLE reservations ADD COLUMN icalOriginalSummary TEXT");
  const { extractSummaryFromIcalReservationNotes } = require('./utils/icalParser');
  const setSummary = db.prepare('UPDATE reservations SET icalOriginalSummary = ? WHERE id = ?');
  for (const r of db.prepare("SELECT id, notes FROM reservations WHERE sourceType = 'ical' AND icalOriginalSummary IS NULL").all()) {
    const original = extractSummaryFromIcalReservationNotes(r.notes);
    if (original) setSummary.run(original, r.id);
  }
}
if (!cols.includes('depositPaidDate')) {
  // Real encaissement date for the deposit. Recorded when the deposit is marked paid (defaults to today,
  // editable). Backfilled once from depositDueDate for rows already marked paid, so legacy data has a
  // sensible accounting date. Drives the monthly accounting export (spec accountant-accounting-export.md).
  db.exec("ALTER TABLE reservations ADD COLUMN depositPaidDate TEXT");
  db.exec("UPDATE reservations SET depositPaidDate = depositDueDate WHERE depositPaid = 1 AND depositPaidDate IS NULL");
}
if (!cols.includes('balancePaidDate')) {
  db.exec("ALTER TABLE reservations ADD COLUMN balancePaidDate TEXT");
  db.exec("UPDATE reservations SET balancePaidDate = balanceDueDate WHERE balancePaid = 1 AND balancePaidDate IS NULL");
}
if (!cols.includes('complementAmount')) {
  // Third payment slot — "Complément à percevoir". Surfaces the silent gap when the total stay TTC
  // grows after the deposit + balance were marked paid (e.g. options added after the fact). Auto-
  // derived by the pricing engine as max(0, totalStayPrice − depositAmount − balanceAmount) while
  // unpaid; frozen once `complementPaid = 1`, like deposit/balance. Typically settled at end of stay
  // for on-site extras. Drives a 3rd encaissement type in the monthly accounting export.
  db.exec("ALTER TABLE reservations ADD COLUMN complementAmount REAL NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN complementPaid INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN complementPaidDate TEXT");
  // Backfill the stored complement for reservations whose deposit + balance no longer match the
  // total stay TTC — so the gap is immediately visible on the form for existing rows.
  db.exec(`
    UPDATE reservations
    SET complementAmount = ROUND(
      MAX(0, COALESCE(finalPrice, 0) + COALESCE(touristTaxTotal, 0) - COALESCE(depositAmount, 0) - COALESCE(balanceAmount, 0)),
      2
    )
    WHERE depositPaid = 1 AND balancePaid = 1
  `);
}
if (!cols.includes('depositDisabled')) {
  // Per-reservation opt-out of the standard deposit/balance split. When 1, the pricing engine
  // collapses depositAmount to 0 and lets the balance absorb the whole pre-arrival total — so
  // the monthly accounting export emits a single journal entry for the reservation instead of
  // two. Use case: bookings where the platform (Airbnb, Booking…) collects the deposit on the
  // owner's behalf and it never appears on the owner's accounts. See
  // specs/disable-deposit-per-reservation.md.
  db.exec("ALTER TABLE reservations ADD COLUMN depositDisabled INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('depositAmountOverride')) {
  // Operator-set manual deposit amount (specs/editable-deposit-amount.md). NULL = automatic
  // (deposit = preArrival × depositPercent%). When set, the pricing engine freezes the deposit at
  // this value and lets the balance absorb the rest of the pre-arrival total on every recompute —
  // so adding options later grows the solde, never the acompte. Nullable; existing rows keep NULL
  // and behave exactly as before. The resolved figure stays in `depositAmount`; this column is only
  // the frozen input re-fed to the engine.
  db.exec("ALTER TABLE reservations ADD COLUMN depositAmountOverride REAL");
}
if (!cols.includes('clientGrossAmount')) {
  // For platform-sourced reservations, the gross amount the guest actually paid the platform (TTC).
  // The owner's net (= finalPrice) stays in finalPrice; commission is derived (gross - finalPrice).
  // Always NULL for direct bookings. Drives the platform columns of the accounting CSV (PR 3).
  db.exec("ALTER TABLE reservations ADD COLUMN clientGrossAmount REAL");
}
if (!cols.includes('extraGuestSurchargeOffered')) {
  db.exec("ALTER TABLE reservations ADD COLUMN extraGuestSurchargeOffered INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('requestOrigin')) {
  // Origin marker for rows created by the public API booking-request endpoint
  // (specs/public-api.md). NULL for everything created by the admin UI / internal flows;
  // 'public' for a draft devis submitted by a visitor through the WordPress proxy. Additive
  // and nullable — existing rows keep NULL and behave exactly as before.
  db.exec("ALTER TABLE reservations ADD COLUMN requestOrigin TEXT");
}
if (!cols.includes('breakfastTime')) {
  // Per-reservation desired breakfast hour (HH:MM); NULL = use the breakfast option's default.
  // specs/breakfast-time.md. Reported + sorted on the Planning breakfast card.
  db.exec("ALTER TABLE reservations ADD COLUMN breakfastTime TEXT");
}
if (!cols.includes('blocksPreviousNight')) {
  db.exec("ALTER TABLE reservations ADD COLUMN blocksPreviousNight INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('blocksNextNight')) {
  db.exec("ALTER TABLE reservations ADD COLUMN blocksNextNight INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('touristTaxRate')) {
  db.exec("ALTER TABLE reservations ADD COLUMN touristTaxRate REAL DEFAULT 0");
}
if (!cols.includes('touristTaxTotal')) {
  db.exec("ALTER TABLE reservations ADD COLUMN touristTaxTotal REAL DEFAULT 0");
}
// Per-item routing to Complément (spec force-item-to-complement.md).
// Tourist tax forced-to-complément flag + per-bucket TTC contribution snapshots for the
// accommodation portion and the tourist tax, captured at each `*Paid` 0→1 flip in
// reservationsController.updatePayment. NULL means "no snapshot yet" → the accounting engine
// falls back to the legacy pro-rating logic so existing reservations keep their current numbers.
if (!cols.includes('touristTaxInComplement')) {
  db.exec("ALTER TABLE reservations ADD COLUMN touristTaxInComplement INTEGER NOT NULL DEFAULT 0");
}
if (!cols.includes('accommodationAcompteContribTtc')) {
  db.exec("ALTER TABLE reservations ADD COLUMN accommodationAcompteContribTtc REAL DEFAULT NULL");
}
if (!cols.includes('accommodationSoldeContribTtc')) {
  db.exec("ALTER TABLE reservations ADD COLUMN accommodationSoldeContribTtc REAL DEFAULT NULL");
}
if (!cols.includes('touristTaxAcompteContribTtc')) {
  db.exec("ALTER TABLE reservations ADD COLUMN touristTaxAcompteContribTtc REAL DEFAULT NULL");
}
if (!cols.includes('touristTaxSoldeContribTtc')) {
  db.exec("ALTER TABLE reservations ADD COLUMN touristTaxSoldeContribTtc REAL DEFAULT NULL");
}
const propCols = db.prepare("PRAGMA table_info(properties)").all().map(c => c.name);
if (!propCols.includes('defaultCautionAmount')) {
  db.exec("ALTER TABLE properties ADD COLUMN defaultCautionAmount REAL DEFAULT 500");
}
if (!propCols.includes('singleBeds')) {
  db.exec("ALTER TABLE properties ADD COLUMN singleBeds INTEGER DEFAULT 0");
}
if (!propCols.includes('doubleBeds')) {
  db.exec("ALTER TABLE properties ADD COLUMN doubleBeds INTEGER DEFAULT 0");
}
if (!propCols.includes('touristTaxPerDayPerPerson')) {
  db.exec("ALTER TABLE properties ADD COLUMN touristTaxPerDayPerPerson REAL DEFAULT 0");
}
if (!propCols.includes('touristTaxMode')) {
  db.exec("ALTER TABLE properties ADD COLUMN touristTaxMode TEXT DEFAULT 'per_day_per_person'");
}
if (!propCols.includes('touristTaxPercentage')) {
  db.exec("ALTER TABLE properties ADD COLUMN touristTaxPercentage REAL DEFAULT 0");
}
if (!propCols.includes('touristTaxDepartmentPercentage')) {
  db.exec("ALTER TABLE properties ADD COLUMN touristTaxDepartmentPercentage REAL DEFAULT 0");
}
if (!propCols.includes('touristTaxFixedAmount')) {
  db.exec("ALTER TABLE properties ADD COLUMN touristTaxFixedAmount REAL DEFAULT 0");
}
if (!propCols.includes('basePriceIncludedGuests')) {
  db.exec("ALTER TABLE properties ADD COLUMN basePriceIncludedGuests INTEGER DEFAULT 0");
}
if (!propCols.includes('extraGuestPrice')) {
  db.exec("ALTER TABLE properties ADD COLUMN extraGuestPrice REAL DEFAULT 0");
}
// French grammatical article for the property name, used to build "votre séjour <article> <name>"
// in client emails (specs/email-automation.md §3 rule 13). One of: 'au', 'à la', "à l'", 'aux'.
if (!propCols.includes('nameArticle')) {
  db.exec("ALTER TABLE properties ADD COLUMN nameArticle TEXT DEFAULT 'au'");
}

const pricingRuleCols = db.prepare("PRAGMA table_info(pricing_rules)").all().map(c => c.name);
if (!pricingRuleCols.includes('pricingMode')) {
  db.exec("ALTER TABLE pricing_rules ADD COLUMN pricingMode TEXT NOT NULL DEFAULT 'fixed'");
}
if (!pricingRuleCols.includes('progressiveTiers')) {
  db.exec("ALTER TABLE pricing_rules ADD COLUMN progressiveTiers TEXT NOT NULL DEFAULT '[]'");
}
if (!pricingRuleCols.includes('dateRanges')) {
  db.exec("ALTER TABLE pricing_rules ADD COLUMN dateRanges TEXT NOT NULL DEFAULT '[]'");
}
if (!pricingRuleCols.includes('color')) {
  db.exec("ALTER TABLE pricing_rules ADD COLUMN color TEXT NOT NULL DEFAULT '#1976d2'");
}

const clientCols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
if (!clientCols.includes('streetNumber')) {
  db.exec("ALTER TABLE clients ADD COLUMN streetNumber TEXT DEFAULT ''");
}
if (!clientCols.includes('street')) {
  db.exec("ALTER TABLE clients ADD COLUMN street TEXT DEFAULT ''");
}
if (!clientCols.includes('postalCode')) {
  db.exec("ALTER TABLE clients ADD COLUMN postalCode TEXT DEFAULT ''");
}
if (!clientCols.includes('city')) {
  db.exec("ALTER TABLE clients ADD COLUMN city TEXT DEFAULT ''");
}
// Single-phone migration (Bloc 1 — Clients): collapse the legacy multi-number `phoneNumbers` JSON
// column into the scalar `phone` (keep the first listed number), then drop it. Idempotent.
require('./utils/clientPhoneMigration').migrateClientPhonesToSingle(db);

const resourceCols = db.prepare("PRAGMA table_info(resources)").all().map(c => c.name);
if (resourceCols.length > 0 && !resourceCols.includes('updatedAt')) {
  db.exec("ALTER TABLE resources ADD COLUMN updatedAt TEXT DEFAULT (datetime('now'))");
}
if (resourceCols.length > 0 && !resourceCols.includes('priceType')) {
  db.exec("ALTER TABLE resources ADD COLUMN priceType TEXT NOT NULL DEFAULT 'per_stay'");
}
// Applicability pivot migration (Bloc 1 — Resources): move `resources.propertyIds` JSON into the
// `resource_properties` pivot (empty stays global), then drop the column. Idempotent.
require('./utils/resourcePropertyMigration').migrateResourcePropertiesFromJson(db);

if (!cols.includes('checkInReady')) {
  db.exec("ALTER TABLE reservations ADD COLUMN checkInReady INTEGER DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN checkInDone INTEGER DEFAULT 0");
  db.exec("ALTER TABLE reservations ADD COLUMN checkOutDone INTEGER DEFAULT 0");
}

const reservationOptionCols = db.prepare("PRAGMA table_info(reservation_options)").all().map(c => c.name);
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('unitPrice')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN unitPrice REAL NOT NULL DEFAULT 0");
}
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('billedUnits')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN billedUnits REAL NOT NULL DEFAULT 0");
}
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('priceType')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN priceType TEXT NOT NULL DEFAULT 'per_stay'");
}
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('offered')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
}
// Per-item routing to Complément (spec force-item-to-complement.md).
// `inComplement` is the manual override: when 1, the line lives 100 % in the complément entry.
// `acompteContribTtc` / `soldeContribTtc` are snapshots taken on `depositPaid` / `balancePaid`
// 0→1 flips so the accounting attribution stays exact even if the line price grows afterwards.
// NULL = "no snapshot yet" (legacy reservations + un-flipped payments).
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('inComplement')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0");
}
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('acompteContribTtc')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN acompteContribTtc REAL DEFAULT NULL");
}
if (reservationOptionCols.length > 0 && !reservationOptionCols.includes('soldeContribTtc')) {
  db.exec("ALTER TABLE reservation_options ADD COLUMN soldeContribTtc REAL DEFAULT NULL");
}

const reservationResourceCols = db.prepare("PRAGMA table_info(reservation_resources)").all().map(c => c.name);
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('billedUnits')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN billedUnits REAL NOT NULL DEFAULT 0");
}
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('priceType')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN priceType TEXT NOT NULL DEFAULT 'per_stay'");
}
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('offered')) {
  try {
    db.exec("ALTER TABLE reservation_resources ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
  } catch (error) {
    if (!String(error?.message || '').includes('duplicate column name')) {
      throw error;
    }
  }
}
// Per-item routing to Complément (spec force-item-to-complement.md) — see reservation_options block.
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('inComplement')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0");
}
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('acompteContribTtc')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN acompteContribTtc REAL DEFAULT NULL");
}
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('soldeContribTtc')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN soldeContribTtc REAL DEFAULT NULL");
}

const reservationCustomOptionCols = db.prepare("PRAGMA table_info(reservation_custom_options)").all().map(c => c.name);
if (reservationCustomOptionCols.length > 0 && !reservationCustomOptionCols.includes('offered')) {
  db.exec("ALTER TABLE reservation_custom_options ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
}
// Per-item routing to Complément (spec force-item-to-complement.md) — see reservation_options block.
if (reservationCustomOptionCols.length > 0 && !reservationCustomOptionCols.includes('inComplement')) {
  db.exec("ALTER TABLE reservation_custom_options ADD COLUMN inComplement INTEGER NOT NULL DEFAULT 0");
}
if (reservationCustomOptionCols.length > 0 && !reservationCustomOptionCols.includes('acompteContribTtc')) {
  db.exec("ALTER TABLE reservation_custom_options ADD COLUMN acompteContribTtc REAL DEFAULT NULL");
}
if (reservationCustomOptionCols.length > 0 && !reservationCustomOptionCols.includes('soldeContribTtc')) {
  db.exec("ALTER TABLE reservation_custom_options ADD COLUMN soldeContribTtc REAL DEFAULT NULL");
}

const devisCols = db.prepare("PRAGMA table_info(devis)").all().map(c => c.name);
if (devisCols.length > 0 && !devisCols.includes('customPrice')) {
  db.exec('ALTER TABLE devis ADD COLUMN customPrice REAL');
}

const devisCustomOptionCols = db.prepare("PRAGMA table_info(devis_custom_options)").all().map(c => c.name);
if (devisCustomOptionCols.length > 0 && !devisCustomOptionCols.includes('offered')) {
  db.exec("ALTER TABLE devis_custom_options ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
}

const optionCols = db.prepare("PRAGMA table_info(options)").all().map(c => c.name);
const tryAddOptionColumn = (columnName, sql) => {
  if (optionCols.length > 0 && !optionCols.includes(columnName)) {
    try {
      db.exec(sql);
    } catch (error) {
      if (!String(error?.message || '').includes('duplicate column name')) {
        throw error;
      }
    }
  }
};
tryAddOptionColumn('autoOptionType', "ALTER TABLE options ADD COLUMN autoOptionType TEXT");
tryAddOptionColumn('autoEnabled', "ALTER TABLE options ADD COLUMN autoEnabled INTEGER NOT NULL DEFAULT 0");
tryAddOptionColumn('autoPricingMode', "ALTER TABLE options ADD COLUMN autoPricingMode TEXT NOT NULL DEFAULT 'fixed'");
tryAddOptionColumn('autoFullNightThreshold', "ALTER TABLE options ADD COLUMN autoFullNightThreshold TEXT");
tryAddOptionColumn('optionProgressiveTiers', "ALTER TABLE options ADD COLUMN optionProgressiveTiers TEXT NOT NULL DEFAULT '[]'");
// 2026-06-02 — bed-linen tracking (specs/weekly-bed-linen-tracking.md). Flags an option as
// counting towards the weekly laundry batch on the Planning page. Pure metadata, no pricing
// impact — the laundry endpoint joins reservation_options to this column to know which
// reservations consumed sheets.
tryAddOptionColumn('countsAsBedLinen', "ALTER TABLE options ADD COLUMN countsAsBedLinen INTEGER NOT NULL DEFAULT 0");
// 2026-06-02 — bathroom-linen tracking (specs/weekly-bed-linen-tracking.md §3.5). Same shape as
// `countsAsBedLinen` but counts large + medium + small towels per guest (adults + teens +
// children — babies excluded). Per-type per-person multipliers live on dedicated columns below.
tryAddOptionColumn('countsAsBathroomLinen', "ALTER TABLE options ADD COLUMN countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0");

// 2026-06-02 — fine-grained linen configuration (specs/weekly-bed-linen-tracking.md §3.5.ter).
// Bed-linen option: which bed types are brought to the laundry (per-option toggles, default ON to
// match the previous always-include-all behaviour). The aggregation gates each bed-type sum on
// these flags so an operator can untick e.g. "Bébé" if their laundry service doesn't handle it.
tryAddOptionColumn('linenIncludesSingle', "ALTER TABLE options ADD COLUMN linenIncludesSingle INTEGER NOT NULL DEFAULT 1");
tryAddOptionColumn('linenIncludesDouble', "ALTER TABLE options ADD COLUMN linenIncludesDouble INTEGER NOT NULL DEFAULT 1");
tryAddOptionColumn('linenIncludesBaby',   "ALTER TABLE options ADD COLUMN linenIncludesBaby INTEGER NOT NULL DEFAULT 1");
// Bathroom-linen option: per-person count of each towel size (defaults preserve the previous
// 1 large + 0 medium + 1 small per person semantic). A zero on any size hides that line in the
// PlanningPage card (rule 13.bis).
tryAddOptionColumn('towelLargePerPerson',  "ALTER TABLE options ADD COLUMN towelLargePerPerson INTEGER NOT NULL DEFAULT 1");
tryAddOptionColumn('towelMediumPerPerson', "ALTER TABLE options ADD COLUMN towelMediumPerPerson INTEGER NOT NULL DEFAULT 0");
tryAddOptionColumn('towelSmallPerPerson',  "ALTER TABLE options ADD COLUMN towelSmallPerPerson INTEGER NOT NULL DEFAULT 1");

// 2026-06-06 — bilingual devis PDF (specs/devis-english-language.md). English title for each
// option, used by the PDF renderer when the devis carries pdfLanguage='en'. Empty falls back
// to the FR title. Description is intentionally NOT translated: the option's description is
// not printed in the devis PDF (only the title), so a `descriptionEn` would be dead weight.
tryAddOptionColumn('titleEn', "ALTER TABLE options ADD COLUMN titleEn TEXT NOT NULL DEFAULT ''");

// 2026-06-08 — breakfast time (specs/breakfast-time.md). Default breakfast hour (HH:MM) carried by
// the breakfast option (autoOptionType='breakfast'); other options carry it harmlessly. Overridable
// per reservation via reservations.breakfastTime (migration below). Existing rows get '09:00'.
tryAddOptionColumn('breakfastTime', "ALTER TABLE options ADD COLUMN breakfastTime TEXT DEFAULT '09:00'");

const devisOptionCols = db.prepare("PRAGMA table_info(devis_options)").all().map(c => c.name);
if (devisOptionCols.length > 0 && !devisOptionCols.includes('offered')) {
  db.exec("ALTER TABLE devis_options ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
}

const devisResourceCols = db.prepare("PRAGMA table_info(devis_resources)").all().map(c => c.name);
if (devisResourceCols.length > 0 && !devisResourceCols.includes('offered')) {
  try {
    db.exec("ALTER TABLE devis_resources ADD COLUMN offered INTEGER NOT NULL DEFAULT 0");
  } catch (error) {
    if (!String(error?.message || '').includes('duplicate column name')) {
      throw error;
    }
  }
}

// ---------- RESOURCES COMPLEX COLUMNS ----------
const resourceComplexCols = db.prepare("PRAGMA table_info(resources)").all().map(c => c.name);
const tryAddResourceColumn = (col, sql) => {
  if (resourceComplexCols.length > 0 && !resourceComplexCols.includes(col)) {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
  }
};
tryAddResourceColumn('isComplex', 'ALTER TABLE resources ADD COLUMN isComplex INTEGER NOT NULL DEFAULT 0');
tryAddResourceColumn('slotDuration', 'ALTER TABLE resources ADD COLUMN slotDuration INTEGER NOT NULL DEFAULT 60');
tryAddResourceColumn('openTime', "ALTER TABLE resources ADD COLUMN openTime TEXT NOT NULL DEFAULT '08:00'");
tryAddResourceColumn('closeTime', "ALTER TABLE resources ADD COLUMN closeTime TEXT NOT NULL DEFAULT '22:00'");
tryAddResourceColumn('closedDays', "ALTER TABLE resources ADD COLUMN closedDays TEXT NOT NULL DEFAULT '[]'");
tryAddResourceColumn('openDays', "ALTER TABLE resources ADD COLUMN openDays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]'");
tryAddResourceColumn('turnoverMinutes', 'ALTER TABLE resources ADD COLUMN turnoverMinutes INTEGER NOT NULL DEFAULT 0');
tryAddResourceColumn('minimumUsageMinutes', 'ALTER TABLE resources ADD COLUMN minimumUsageMinutes INTEGER NOT NULL DEFAULT 0');

// 2026-06-06 — bilingual devis PDF (specs/devis-english-language.md). English name surfaced
// by the PDF when the devis carries pdfLanguage='en'. Empty fallback to FR `name`.
tryAddResourceColumn('nameEn', "ALTER TABLE resources ADD COLUMN nameEn TEXT NOT NULL DEFAULT ''");

db.exec('CREATE INDEX IF NOT EXISTS idx_property_resource_prices_resource ON property_resource_prices(resourceId)');
const propertyResourcePriceCols = db.prepare("PRAGMA table_info(property_resource_prices)").all().map(c => c.name);
if (propertyResourcePriceCols.length > 0 && !propertyResourcePriceCols.includes('freeMinutes')) {
  db.exec('ALTER TABLE property_resource_prices ADD COLUMN freeMinutes INTEGER NOT NULL DEFAULT 0');
}

const icalSourceCols = db.prepare("PRAGMA table_info(ical_sources)").all().map(c => c.name);
if (icalSourceCols.length > 0 && !icalSourceCols.includes('platformColor')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN platformColor TEXT NOT NULL DEFAULT '#757575'");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('isActive')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('lastSyncAt')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN lastSyncAt TEXT");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('lastSyncStatus')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN lastSyncStatus TEXT");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('lastSyncMessage')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN lastSyncMessage TEXT");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('lastImportedCount')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN lastImportedCount INTEGER NOT NULL DEFAULT 0");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('updatedAt')) {
  db.exec("ALTER TABLE ical_sources ADD COLUMN updatedAt TEXT DEFAULT (datetime('now'))");
}
if (icalSourceCols.length > 0 && !icalSourceCols.includes('collectsTouristTax')) {
  // Per-platform tourist-tax collection flag. Defaults to 1 (= the platform collects the tax on the
  // owner's behalf, which matches the legacy hardcoded "non-direct → offered" rule). Set to 0 when
  // the owner has to collect+pay the tax themselves (e.g. some Booking arrangements).
  db.exec("ALTER TABLE ical_sources ADD COLUMN collectsTouristTax INTEGER NOT NULL DEFAULT 1");
}

const icalImportEventCols = db.prepare("PRAGMA table_info(ical_import_events)").all().map(c => c.name);
if (icalImportEventCols.length > 0 && !icalImportEventCols.includes('startDate')) {
  db.exec("ALTER TABLE ical_import_events ADD COLUMN startDate TEXT NOT NULL DEFAULT ''");
}
if (icalImportEventCols.length > 0 && !icalImportEventCols.includes('endDate')) {
  db.exec("ALTER TABLE ical_import_events ADD COLUMN endDate TEXT NOT NULL DEFAULT ''");
}
if (icalImportEventCols.length > 0 && !icalImportEventCols.includes('summaryNormalized')) {
  db.exec("ALTER TABLE ical_import_events ADD COLUMN summaryNormalized TEXT NOT NULL DEFAULT ''");
}
if (icalImportEventCols.length > 0) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ical_import_events_fallback
    ON ical_import_events (sourceId, startDate, endDate, summaryNormalized)
  `);

  // Backfill dates for legacy mapping rows so fallback matching can work immediately.
  db.exec(`
    UPDATE ical_import_events
    SET startDate = COALESCE((SELECT startDate FROM reservations WHERE reservations.id = ical_import_events.reservationId), '')
    WHERE startDate IS NULL OR startDate = ''
  `);
  db.exec(`
    UPDATE ical_import_events
    SET endDate = COALESCE((SELECT endDate FROM reservations WHERE reservations.id = ical_import_events.reservationId), '')
    WHERE endDate IS NULL OR endDate = ''
  `);
}
} // end SKIP_MIGRATIONS guard

// ---------- CALENDAR NOTES ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    UNIQUE(propertyId, date)
  )
`);

// ---------- SCHOOL HOLIDAYS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS school_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    zoneA_start TEXT,
    zoneA_end TEXT,
    zoneB_start TEXT,
    zoneB_end TEXT,
    zoneC_start TEXT,
    zoneC_end TEXT
  )
`);

// Auto-sync columns (see specs/school-holidays.md §5)
const schCols = db.prepare("PRAGMA table_info(school_holidays)").all().map(c => c.name);
const tryAddSchCol = (col, sql) => {
  if (!schCols.includes(col)) {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
  }
};
tryAddSchCol('externalRef', "ALTER TABLE school_holidays ADD COLUMN externalRef TEXT");
tryAddSchCol('isLocked', "ALTER TABLE school_holidays ADD COLUMN isLocked INTEGER NOT NULL DEFAULT 0");
tryAddSchCol('lastSyncedAt', "ALTER TABLE school_holidays ADD COLUMN lastSyncedAt TEXT");

// Singleton: school holidays sync state + user-editable config.
db.exec(`
  CREATE TABLE IF NOT EXISTS school_holidays_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    syncIntervalDays INTEGER NOT NULL DEFAULT 60,
    syncHorizonMonths INTEGER NOT NULL DEFAULT 24,
    lastSyncAt TEXT,
    lastSyncStatus TEXT DEFAULT 'never',
    lastSyncMessage TEXT DEFAULT '',
    lastImportedCount INTEGER DEFAULT 0,
    updatedAt TEXT DEFAULT (datetime('now'))
  )
`);
db.prepare('INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1)').run();

// ---------- ESTABLISHMENT CLOSURES ----------
// Global (propertyId IS NULL) or per-property (propertyId NOT NULL) closure periods.
// Used to block reservations and visualize unavailable ranges on the calendar.
db.exec(`
  CREATE TABLE IF NOT EXISTS establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);

// ---------- LAUNDRY TRIP SKIPS ----------
// specs/skip-laundry-trip.md §5. Global per-date skip — when the operator marks a laundry
// trip as not made, the simulation engine (utils/linenInventory.js) defers that day's
// drop-off + pick-up to the next non-skipped trip. Additive table, starts empty, no
// migration. Date format YYYY-MM-DD (10 chars) enforced via CHECK so a malformed insert
// fails at the DB boundary.
db.exec(`
  CREATE TABLE IF NOT EXISTS laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---------- APP SETTINGS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    googleCalendarId TEXT DEFAULT '',
    googleServiceAccountEmail TEXT DEFAULT '',
    googleServiceAccountPrivateKey TEXT DEFAULT '',
    companyName TEXT DEFAULT '',
    companyAddress TEXT DEFAULT '',
    companyEmail TEXT DEFAULT '',
    companyPhone TEXT DEFAULT '',
    companySiret TEXT DEFAULT '',
    companyTva TEXT DEFAULT '',
    companyIban TEXT DEFAULT '',
    companyBic TEXT DEFAULT '',
    companyBankName TEXT DEFAULT '',
    quoteFooterText TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  )
`);
db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();

// ---------- USERS (auth) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    mustChangePassword INTEGER NOT NULL DEFAULT 0,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  )
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email)');

// ----- USERS: identity columns + role join table migration (specs/admin-account-management.md) -----
// 1. Idempotent ADD COLUMN for the 4 new identity fields + lastLoginAt (created tomorrow on first login).
const usersCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const tryAddUsersCol = (col, sql) => {
  if (!usersCols.includes(col)) {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
  }
};
tryAddUsersCol('firstName',   "ALTER TABLE users ADD COLUMN firstName TEXT NOT NULL DEFAULT ''");
tryAddUsersCol('lastName',    "ALTER TABLE users ADD COLUMN lastName TEXT NOT NULL DEFAULT ''");
tryAddUsersCol('companyName', "ALTER TABLE users ADD COLUMN companyName TEXT NOT NULL DEFAULT ''");
tryAddUsersCol('notes',       "ALTER TABLE users ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
tryAddUsersCol('lastLoginAt', 'ALTER TABLE users ADD COLUMN lastLoginAt TEXT');
// 2026-06-02 — stamped by `updateUser` when the email is changed. Compared to `lastLoginAt` to know
// if the operator has logged in with the new address at least once (drives the persistent
// "vérifier votre nouvelle adresse" banner; clears the banner once `lastLoginAt > emailChangedAt`).
tryAddUsersCol('emailChangedAt', 'ALTER TABLE users ADD COLUMN emailChangedAt TEXT');

// 2. Join table for multi-role. FK cascade so hardDelete on users wipes the rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_roles (
    userId INTEGER NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (userId, role),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 3. Seed the default admin on first launch (before backfilling roles, so the seed's row is also
// migrated to user_roles in step 4). The default password only unlocks the "set your password" screen
// (mustChangePassword = 1) — see specs/security-auth-encryption.md.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } = require('./constants/authDefaults');
  const { hashPassword } = require('./utils/passwordHash');
  // Insert with whatever set of columns currently exists. On a fresh install the legacy `role`
  // column is still present (CREATE TABLE above defines it); we write 'admin' there and step 4
  // moves it into the join table before step 5 drops the column.
  const hasRole = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role');
  if (hasRole) {
    db.prepare("INSERT INTO users (email, passwordHash, role, mustChangePassword) VALUES (?, ?, 'admin', 1)")
      .run(DEFAULT_ADMIN_EMAIL, hashPassword(DEFAULT_ADMIN_PASSWORD));
  } else {
    db.prepare('INSERT INTO users (email, passwordHash, mustChangePassword) VALUES (?, ?, 1)')
      .run(DEFAULT_ADMIN_EMAIL, hashPassword(DEFAULT_ADMIN_PASSWORD));
    const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get(DEFAULT_ADMIN_EMAIL).id;
    db.prepare('INSERT OR IGNORE INTO user_roles (userId, role) VALUES (?, ?)').run(adminId, 'admin');
  }
  console.log('[seed:admin] default admin created — change the password on first login');
}

// 4. Backfill user_roles from users.role for legacy installs. One-shot guard: only runs if the join
// table is empty AND the legacy column is still present.
{
  const stillHasRole = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role');
  const joinEmpty = db.prepare('SELECT COUNT(*) AS n FROM user_roles').get().n === 0;
  if (stillHasRole && joinEmpty) {
    db.exec(`
      INSERT INTO user_roles (userId, role)
      SELECT id, role FROM users WHERE role IS NOT NULL AND trim(role) <> ''
    `);
  }
}

// 5. Drop the legacy single-role column (better-sqlite3 v11 supports ALTER TABLE DROP COLUMN
// natively — confirmed by utils/clientPhoneMigration.js and utils/resourcePropertyMigration.js).
{
  const stillHasRole = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role');
  if (stillHasRole) {
    db.exec('ALTER TABLE users DROP COLUMN role');
  }
}

// Migrate app_settings company columns
const appSettingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
const tryAddAppSettingsCol = (col, sql) => {
  if (!appSettingsCols.includes(col)) {
    try { db.exec(sql); } catch (e) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
  }
};
tryAddAppSettingsCol('companyName', "ALTER TABLE app_settings ADD COLUMN companyName TEXT DEFAULT ''");
tryAddAppSettingsCol('companyAddress', "ALTER TABLE app_settings ADD COLUMN companyAddress TEXT DEFAULT ''");
tryAddAppSettingsCol('companyEmail', "ALTER TABLE app_settings ADD COLUMN companyEmail TEXT DEFAULT ''");
tryAddAppSettingsCol('companyPhone', "ALTER TABLE app_settings ADD COLUMN companyPhone TEXT DEFAULT ''");
tryAddAppSettingsCol('companySiret', "ALTER TABLE app_settings ADD COLUMN companySiret TEXT DEFAULT ''");
tryAddAppSettingsCol('companyTva', "ALTER TABLE app_settings ADD COLUMN companyTva TEXT DEFAULT ''");
tryAddAppSettingsCol('companyIban', "ALTER TABLE app_settings ADD COLUMN companyIban TEXT DEFAULT ''");
tryAddAppSettingsCol('companyBic', "ALTER TABLE app_settings ADD COLUMN companyBic TEXT DEFAULT ''");
tryAddAppSettingsCol('companyBankName', "ALTER TABLE app_settings ADD COLUMN companyBankName TEXT DEFAULT ''");
tryAddAppSettingsCol('quoteFooterText', "ALTER TABLE app_settings ADD COLUMN quoteFooterText TEXT DEFAULT ''");
// 2026-06-06 — English-language footer for the bilingual devis PDF
// (specs/devis-english-language.md §3 rule 11). Optional — empty defaults to the static
// English text in devisPdfLabels.
tryAddAppSettingsCol('quoteFooterTextEn', "ALTER TABLE app_settings ADD COLUMN quoteFooterTextEn TEXT DEFAULT ''");

// Global VAT rate (single-rate model — specs/single-vat-rate.md §5). The previous 2-rate model
// (accommodation 10 % / standard 20 %) was collapsed because every revenue stream on GuestFlow
// is invoiced under the reduced 10 % rate. Backfill (further down) seeds `vatRate` from the
// legacy `vatRateAccommodation` (which prod has at 10 %), then DROP the two legacy columns.
tryAddAppSettingsCol('vatRateAccommodation', "ALTER TABLE app_settings ADD COLUMN vatRateAccommodation REAL DEFAULT 10");
tryAddAppSettingsCol('vatRateStandard', "ALTER TABLE app_settings ADD COLUMN vatRateStandard REAL DEFAULT 20");
tryAddAppSettingsCol('vatRate', "ALTER TABLE app_settings ADD COLUMN vatRate REAL NOT NULL DEFAULT 10");
// SMTP for the account-management password-by-email flow (specs/admin-account-management.md).
// Password stored encrypted (AES-256-GCM via utils/encryption.js) — never logged or returned in cleartext.
tryAddAppSettingsCol('smtpHost',              "ALTER TABLE app_settings ADD COLUMN smtpHost TEXT DEFAULT ''");
tryAddAppSettingsCol('smtpPort',              "ALTER TABLE app_settings ADD COLUMN smtpPort INTEGER DEFAULT 587");
tryAddAppSettingsCol('smtpSecure',            "ALTER TABLE app_settings ADD COLUMN smtpSecure INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('smtpUsername',          "ALTER TABLE app_settings ADD COLUMN smtpUsername TEXT DEFAULT ''");
tryAddAppSettingsCol('smtpPasswordEncrypted', "ALTER TABLE app_settings ADD COLUMN smtpPasswordEncrypted TEXT DEFAULT ''");
tryAddAppSettingsCol('smtpFromEmail',         "ALTER TABLE app_settings ADD COLUMN smtpFromEmail TEXT DEFAULT ''");
tryAddAppSettingsCol('smtpFromName',          "ALTER TABLE app_settings ADD COLUMN smtpFromName TEXT DEFAULT 'GuestFlow'");
tryAddAppSettingsCol('publicUrl',             "ALTER TABLE app_settings ADD COLUMN publicUrl TEXT DEFAULT ''");
// 2026-06-11 — booking notifications (specs/site-booking-notifications.md §5). Master switch
// (default ON) + the address notifications are sent TO. Sender stays smtpFromEmail; an empty
// recipient falls back to smtpFromEmail. The email link reuses the existing `publicUrl`.
tryAddAppSettingsCol('notificationsEnabled',      "ALTER TABLE app_settings ADD COLUMN notificationsEnabled INTEGER NOT NULL DEFAULT 1");
tryAddAppSettingsCol('notificationRecipientEmail', "ALTER TABLE app_settings ADD COLUMN notificationRecipientEmail TEXT DEFAULT ''");
// Per-channel switch for the new-iCal-reservation email (specs/site-booking-notifications.md §3 rule 9b).
// ON by default (= prior behaviour); OFF stops only the platform-reservation email.
tryAddAppSettingsCol('notifyIcalReservationEnabled', "ALTER TABLE app_settings ADD COLUMN notifyIcalReservationEnabled INTEGER NOT NULL DEFAULT 1");
// 2026-06-02 — bed-linen tracking (specs/weekly-bed-linen-tracking.md). Day of week (0=Sun..6=Sat)
// when Adrien drops the dirty linen at the laundry. Drives the LaundryDayCard on PlanningPage.
// Default 2 (Tuesday) reflects current practice.
tryAddAppSettingsCol('laundryWeekday',        "ALTER TABLE app_settings ADD COLUMN laundryWeekday INTEGER NOT NULL DEFAULT 2");
// Linen inventory & shortage tracking (specs/linen-inventory-shortage-tracking.md §5).
// 6 integer columns ≥ 0, default 0 (= "type not tracked"). Stock is global across all
// properties — the simulation aggregates demand against these single numbers.
tryAddAppSettingsCol('bedLinenStockSingle', "ALTER TABLE app_settings ADD COLUMN bedLinenStockSingle INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('bedLinenStockDouble', "ALTER TABLE app_settings ADD COLUMN bedLinenStockDouble INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('bedLinenStockBaby',   "ALTER TABLE app_settings ADD COLUMN bedLinenStockBaby   INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('towelStockLarge',     "ALTER TABLE app_settings ADD COLUMN towelStockLarge     INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('towelStockMedium',    "ALTER TABLE app_settings ADD COLUMN towelStockMedium    INTEGER NOT NULL DEFAULT 0");
tryAddAppSettingsCol('towelStockSmall',     "ALTER TABLE app_settings ADD COLUMN towelStockSmall     INTEGER NOT NULL DEFAULT 0");
// Online payments — all reminder/deadline durations are operator-configurable (no hard-coded delay).
// Offsets are stored as a JSON array of day-deltas relative to the relevant due date (negative = before,
// 0 = the due day, positive = after). See specs/online-payments-qonto.md §3.1 + §5.
tryAddAppSettingsCol('paymentDepositReminderOffsets',  "ALTER TABLE app_settings ADD COLUMN paymentDepositReminderOffsets  TEXT DEFAULT '[-5,0]'");
tryAddAppSettingsCol('paymentDepositAbandonOffset',    "ALTER TABLE app_settings ADD COLUMN paymentDepositAbandonOffset    INTEGER NOT NULL DEFAULT 1");
tryAddAppSettingsCol('paymentDepositLinkExpiryDays',   "ALTER TABLE app_settings ADD COLUMN paymentDepositLinkExpiryDays   INTEGER NOT NULL DEFAULT 1");
tryAddAppSettingsCol('paymentBalanceReminderOffsets',  "ALTER TABLE app_settings ADD COLUMN paymentBalanceReminderOffsets  TEXT DEFAULT '[-10,-5,0]'");
tryAddAppSettingsCol('paymentBalanceAbandonOffset',    "ALTER TABLE app_settings ADD COLUMN paymentBalanceAbandonOffset    INTEGER NOT NULL DEFAULT 1");
tryAddAppSettingsCol('paymentBalanceLinkExpiryDays',   "ALTER TABLE app_settings ADD COLUMN paymentBalanceLinkExpiryDays   INTEGER NOT NULL DEFAULT 1");
// (The last-minute threshold + full-payment due date are NOT stored here — they derive from the
// property's own "Acompte & solde" settings, i.e. balanceDaysBefore. See specs/online-payments-qonto.md
// §3.7. Older prod DBs may carry orphan paymentLastMinuteDays / paymentFullPaymentDueDaysBefore
// columns from PR #178; they are unused and harmless.)
// Qonto connection (specs/online-payments-qonto.md §3.1). The OAuth client id/secret live in
// .env.local; these columns hold the per-connection OAuth tokens (AES-256-GCM, masked on read) +
// non-secret provider-connection metadata.
tryAddAppSettingsCol('qontoAccessTokenEncrypted',  "ALTER TABLE app_settings ADD COLUMN qontoAccessTokenEncrypted  TEXT DEFAULT ''");
tryAddAppSettingsCol('qontoRefreshTokenEncrypted', "ALTER TABLE app_settings ADD COLUMN qontoRefreshTokenEncrypted TEXT DEFAULT ''");
tryAddAppSettingsCol('qontoTokenExpiresAt',        "ALTER TABLE app_settings ADD COLUMN qontoTokenExpiresAt        TEXT DEFAULT ''");
tryAddAppSettingsCol('qontoConnectionId',          "ALTER TABLE app_settings ADD COLUMN qontoConnectionId          TEXT DEFAULT ''");
tryAddAppSettingsCol('qontoConnectionStatus',      "ALTER TABLE app_settings ADD COLUMN qontoConnectionStatus      TEXT DEFAULT 'not_connected'");
tryAddAppSettingsCol('qontoConnectedAt',           "ALTER TABLE app_settings ADD COLUMN qontoConnectedAt           TEXT DEFAULT ''");
// Admin-only escape hatch for legitimate corrections on past reservations (typo in dates,
// wrong property assigned). OFF by default; the existing server-side lock keeps holding.
// See specs/admin-unlock-past-reservations.md (Approved 2026-06-01).
tryAddAppSettingsCol('allowEditPastReservations', "ALTER TABLE app_settings ADD COLUMN allowEditPastReservations INTEGER NOT NULL DEFAULT 0");
if (!appSettingsCols.includes('vatRateAccommodation')) {
  const propColsNow = db.prepare("PRAGMA table_info(properties)").all().map(c => c.name);
  let acc = 10;
  let std = 20;
  if (propColsNow.includes('vatPercentageAccommodation') && propColsNow.includes('vatPercentageOptions')) {
    const anyProp = db.prepare("SELECT vatPercentageAccommodation AS acc, vatPercentageOptions AS std FROM properties ORDER BY id LIMIT 1").get();
    if (anyProp) {
      acc = anyProp.acc != null ? anyProp.acc : 10;
      std = anyProp.std != null ? anyProp.std : 20;
    }
  }
  db.prepare("UPDATE app_settings SET vatRateAccommodation = ?, vatRateStandard = ? WHERE id = 1").run(acc, std);
}
// Drop the retired per-property VAT columns — the engine reads only the globals from app_settings.
{
  const propColsForDrop = db.prepare("PRAGMA table_info(properties)").all().map(c => c.name);
  for (const col of ['vatPercentageAccommodation', 'vatPercentageOptions', 'vatPercentageResources']) {
    if (propColsForDrop.includes(col)) {
      db.exec(`ALTER TABLE properties DROP COLUMN ${col}`);
    }
  }
}

// Single-rate VAT migration (specs/single-vat-rate.md §5). Seeds `vatRate` from the legacy
// accommodation column ONCE (prod has 10 % there → no behavioural surprise), then DROPS the
// two legacy columns. Idempotent: re-runs are no-ops because the legacy columns are absent
// after the first pass. SQLite ≥ 3.35 (well below our Pi version) supports DROP COLUMN.
{
  const cols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
  if (cols.includes('vatRate') && cols.includes('vatRateAccommodation')) {
    db.prepare("UPDATE app_settings SET vatRate = COALESCE(vatRateAccommodation, 10) WHERE id = 1").run();
  }
  if (cols.includes('vatRateAccommodation')) {
    db.exec('ALTER TABLE app_settings DROP COLUMN vatRateAccommodation');
  }
  if (cols.includes('vatRateStandard')) {
    db.exec('ALTER TABLE app_settings DROP COLUMN vatRateStandard');
  }
}

// ---------- DEVIS ↔ RESERVATION FUSION ----------
// Devis are unified into `reservations` (kind='devis'); their lines live in the reservation_* children.
// Fresh installs never create devis_* tables. Existing installs are migrated ONCE (after an automatic
// backup) and the legacy devis_* tables are dropped. See specs/devis-reservation-fusion.md.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const rcols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!rcols.includes('kind')) db.exec("ALTER TABLE reservations ADD COLUMN kind TEXT NOT NULL DEFAULT 'reservation'");
  if (!rcols.includes('devisNumber')) db.exec('ALTER TABLE reservations ADD COLUMN devisNumber TEXT');
  if (!rcols.includes('devisStatus')) db.exec('ALTER TABLE reservations ADD COLUMN devisStatus TEXT');
  if (!rcols.includes('validUntil')) db.exec('ALTER TABLE reservations ADD COLUMN validUntil TEXT');
  if (!rcols.includes('convertedReservationId')) db.exec('ALTER TABLE reservations ADD COLUMN convertedReservationId INTEGER');
  // 2026-06-06 — bilingual devis PDF (specs/devis-english-language.md). 'fr' (default) | 'en'.
  // Existing devis backfill to 'fr' via the DEFAULT clause; the PDF endpoint reads this column.
  if (!rcols.includes('pdfLanguage')) db.exec("ALTER TABLE reservations ADD COLUMN pdfLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_devisNumber ON reservations(devisNumber) WHERE devisNumber IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_reservations_kind ON reservations(kind)');

  const { migrateDevisIntoReservations, tableExists } = require('./utils/devisFusionMigration');
  if (tableExists(db, 'devis')) {
    try {
      const backupPath = `${dbPath}.pre-devis-fusion-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
      console.log('[Fusion] Pre-migration backup written to', backupPath);
      const result = migrateDevisIntoReservations(db);
      console.log('[Fusion] devis → reservations:', JSON.stringify(result));
    } catch (err) {
      console.error('[Fusion] Devis fusion failed — DB left unchanged (restore the .bak if needed):', err.message);
      throw err;
    }
  }
}

// Seed school holidays if table is empty
const holidayCount = db.prepare('SELECT COUNT(*) as c FROM school_holidays').get().c;
if (holidayCount === 0) {
  const insert = db.prepare('INSERT INTO school_holidays (label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const seed = [
    ['Toussaint 2024', '2024-10-19', '2024-11-03', '2024-10-19', '2024-11-03', '2024-10-19', '2024-11-03'],
    ['Noël 2024', '2024-12-21', '2025-01-05', '2024-12-21', '2025-01-05', '2024-12-21', '2025-01-05'],
    ['Hiver 2025', '2025-02-22', '2025-03-09', '2025-02-08', '2025-02-23', '2025-02-15', '2025-03-02'],
    ['Printemps 2025', '2025-04-19', '2025-05-04', '2025-04-05', '2025-04-21', '2025-04-12', '2025-04-27'],
    ['Été 2025', '2025-07-05', '2025-08-31', '2025-07-05', '2025-08-31', '2025-07-05', '2025-08-31'],
    ['Toussaint 2025', '2025-10-18', '2025-11-02', '2025-10-18', '2025-11-02', '2025-10-18', '2025-11-02'],
    ['Noël 2025', '2025-12-20', '2026-01-04', '2025-12-20', '2026-01-04', '2025-12-20', '2026-01-04'],
    ['Hiver 2026', '2026-02-07', '2026-02-22', '2026-02-21', '2026-03-08', '2026-02-14', '2026-03-01'],
    ['Printemps 2026', '2026-04-04', '2026-04-19', '2026-04-18', '2026-05-03', '2026-04-11', '2026-04-26'],
    ['Été 2026', '2026-07-04', '2026-08-31', '2026-07-04', '2026-08-31', '2026-07-04', '2026-08-31'],
    ['Toussaint 2026', '2026-10-17', '2026-11-01', '2026-10-17', '2026-11-01', '2026-10-17', '2026-11-01'],
    ['Noël 2026', '2026-12-19', '2027-01-03', '2026-12-19', '2027-01-03', '2026-12-19', '2027-01-03'],
    ['Hiver 2027', '2027-02-13', '2027-02-28', '2027-02-06', '2027-02-21', '2027-02-20', '2027-03-07'],
    ['Printemps 2027', '2027-04-10', '2027-04-25', '2027-04-03', '2027-04-18', '2027-04-17', '2027-05-02'],
    ['Été 2027', '2027-07-03', '2027-08-31', '2027-07-03', '2027-08-31', '2027-07-03', '2027-08-31'],
  ];
  for (const row of seed) insert.run(...row);
}

// Seed default resource: baby bed (global = no resource_properties rows).
const babyBed = db.prepare(`
  SELECT r.id FROM resources r
  WHERE lower(r.name) = lower('Lit bébé')
    AND NOT EXISTS (SELECT 1 FROM resource_properties rp WHERE rp.resourceId = r.id)
`).get();
if (!babyBed) {
  db.prepare('INSERT INTO resources (name, nameEn, quantity, price, note) VALUES (?, ?, ?, ?, ?)')
    .run('Lit bébé', 'Baby bed', 1, 0, 'Ressource par défaut');
}
// 2026-06-06 — backfill the EN translation on prod servers that seeded "Lit bébé" before
// the nameEn column existed. Idempotent: only touches the row when the column is empty.
try {
  db.prepare("UPDATE resources SET nameEn = 'Baby bed' WHERE LOWER(name) = LOWER('Lit bébé') AND (nameEn IS NULL OR nameEn = '')").run();
} catch (e) {
  // nameEn column not yet present (very early boot path) — silent; the next boot will catch up.
}

// Migration: add missing columns to options table if they don't exist.
// Silent on steady-state boots (all columns already there). Logs a single summary line on the
// boots that actually add columns — the operator only hears from us when something changed.
function migrateOptionsColumns() {
  const NEEDED = [
    ['autoOptionType',          'TEXT'],
    ['autoEnabled',             'INTEGER NOT NULL DEFAULT 0'],
    ['autoPricingMode',         "TEXT NOT NULL DEFAULT 'fixed'"],
    ['autoFullNightThreshold',  'TEXT'],
    ['optionProgressiveTiers',  "TEXT NOT NULL DEFAULT '[]'"],
  ];
  const existing = new Set(db.prepare('PRAGMA table_info(options)').all().map((c) => c.name));
  const added = [];
  for (const [name, type] of NEEDED) {
    if (existing.has(name)) continue;
    try {
      db.exec(`ALTER TABLE options ADD COLUMN ${name} ${type}`);
      added.push(name);
    } catch (e) {
      // Race with a parallel boot that already added the column — harmless, swallow.
      if (!/duplicate column name/i.test(String(e?.message || ''))) {
        console.error(`[migration:options-columns] failed adding ${name}: ${e.message}`);
        throw e;
      }
    }
  }
  if (added.length > 0) {
    console.log(`[migration:options-columns] added ${added.length} column(s): ${added.join(', ')}`);
  }
}

migrateOptionsColumns();

function ensureDefaultTimedOptionsForProperty(propertyId) {
  const pid = Number(propertyId);
  if (!Number.isFinite(pid) || pid <= 0) return;

  // English titles surfaced in the EN devis PDF (specs/devis-english-language.md §3 rule 6).
  // The PDF appends the extra-hour suffix at render time; `titleEn` here is the bare name.
  const defaults = [
    {
      autoOptionType: 'early_check_in',
      title: 'Arrivée anticipée',
      titleEn: 'Early check-in',
      description: "Option automatique si arrivée avant l'heure par défaut",
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '10:00',
    },
    {
      autoOptionType: 'late_check_out',
      title: 'Départ tardif',
      titleEn: 'Late check-out',
      description: "Option automatique si départ après l'heure par défaut",
      autoEnabled: 1,
      autoPricingMode: 'proportional',
      autoFullNightThreshold: '17:00',
    },
  ];

  // Whether the EN title column exists at this exact moment (the column migration above adds
  // it; this guard keeps the seeder safe on minimal test schemas that don't have it).
  const optionCols = db.prepare("PRAGMA table_info(options)").all().map((c) => c.name);
  const hasTitleEn = optionCols.includes('titleEn');

  const findScopedByType = db.prepare(`
    SELECT o.id, o.price, o.autoEnabled, o.autoPricingMode, o.autoFullNightThreshold${hasTitleEn ? ', o.titleEn' : ''}
    FROM options o
    INNER JOIN property_options po ON po.optionId = o.id
    WHERE po.propertyId = ? AND o.autoOptionType = ?
    LIMIT 1
  `);
  const findGlobalByType = db.prepare(`
    SELECT o.id, o.price, o.autoEnabled, o.autoPricingMode, o.autoFullNightThreshold${hasTitleEn ? ', o.titleEn' : ''}
    FROM options o
    WHERE o.autoOptionType = ?
      AND NOT EXISTS (SELECT 1 FROM property_options po WHERE po.optionId = o.id)
    LIMIT 1
  `);
  const insertOption = db.prepare(hasTitleEn
    ? `INSERT INTO options (title, description, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, titleEn)
       VALUES (?, ?, 'per_stay', 0, ?, ?, ?, ?, ?)`
    : `INSERT INTO options (title, description, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
       VALUES (?, ?, 'per_stay', 0, ?, ?, ?, ?)`);
  const insertLink = db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const upgradeLegacyTimedOption = db.prepare(`
    UPDATE options
    SET
      autoEnabled = 1,
      autoPricingMode = 'proportional',
      autoFullNightThreshold = COALESCE(NULLIF(autoFullNightThreshold, ''), ?)
    WHERE id = ?
  `);
  // Backfill the EN title on legacy rows that already exist without it. Idempotent: only
  // touches rows where `titleEn` is currently empty.
  const backfillTitleEn = hasTitleEn
    ? db.prepare("UPDATE options SET titleEn = ? WHERE id = ? AND (titleEn IS NULL OR titleEn = '')")
    : null;

  const tx = db.transaction(() => {
    for (const def of defaults) {
      const existing = findScopedByType.get(pid, def.autoOptionType);
      const globalExisting = existing ? null : findGlobalByType.get(def.autoOptionType);
      const candidate = existing || globalExisting;

      if (candidate) {
        const isLegacyDisabledFixedZero = Number(candidate.autoEnabled || 0) !== 1
          && String(candidate.autoPricingMode || 'fixed') === 'fixed'
          && Number(candidate.price || 0) === 0;
        if (isLegacyDisabledFixedZero) {
          upgradeLegacyTimedOption.run(def.autoFullNightThreshold, Number(candidate.id));
        }
        // Backfill the EN title on every existing typed row regardless of the legacy upgrade.
        if (backfillTitleEn && (!candidate.titleEn || candidate.titleEn === '')) {
          backfillTitleEn.run(def.titleEn, Number(candidate.id));
        }
        continue;
      }

      const created = hasTitleEn
        ? insertOption.run(
            def.title,
            def.description,
            def.autoOptionType,
            Number(def.autoEnabled || 0),
            def.autoPricingMode || 'fixed',
            def.autoFullNightThreshold,
            def.titleEn,
          )
        : insertOption.run(
            def.title,
            def.description,
            def.autoOptionType,
            Number(def.autoEnabled || 0),
            def.autoPricingMode || 'fixed',
            def.autoFullNightThreshold,
          );
      insertLink.run(pid, Number(created.lastInsertRowid));
    }
  });

  tx();
}

// ---------- ICAL EXPORT TOKENS ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS ical_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
  )
`);

// Verify ical_tokens columns
const icalTokenCols = db.prepare("PRAGMA table_info(ical_tokens)").all().map(c => c.name);
if (icalTokenCols.length > 0 && !icalTokenCols.includes('updatedAt')) {
  db.exec("ALTER TABLE ical_tokens ADD COLUMN updatedAt TEXT DEFAULT (datetime('now'))");
}


// Migrate app_settings columns if needed
(function migrateAppSettings() {
  const asCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
  if (asCols.length === 0) return; // table doesn't exist yet
  if (!asCols.includes('quoteValidityDays')) {
    db.exec("ALTER TABLE app_settings ADD COLUMN quoteValidityDays INTEGER DEFAULT 30");
  }
  if (!asCols.includes('companyLogoPath')) {
    db.exec("ALTER TABLE app_settings ADD COLUMN companyLogoPath TEXT DEFAULT ''");
  }
})();

function generateDevisNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${year}-${month}-`;
  const existing = db.prepare(
    "SELECT devisNumber FROM reservations WHERE kind = 'devis' AND devisNumber LIKE ? ORDER BY devisNumber DESC LIMIT 1"
  ).get(`${prefix}%`);
  let increment = 1;
  if (existing) {
    const parts = existing.devisNumber.split('-');
    increment = parseInt(parts[2] || '0', 10) + 1;
  }
  return `${prefix}${String(increment).padStart(3, '0')}`;
}

db.generateDevisNumber = generateDevisNumber;

// Initialize default timed options for existing properties when schema supports it.
// Silent when the schema isn't ready or the property table is empty; surfaces a count line
// only on boots that actually initialised. Real errors bubble up via console.error.
try {
  const optionColumns = db.prepare('PRAGMA table_info(options)').all().map((col) => col.name);
  const requiredTimedColumns = ['autoOptionType', 'autoEnabled', 'autoPricingMode', 'autoFullNightThreshold'];
  const hasTimedColumns = requiredTimedColumns.every((name) => optionColumns.includes(name));
  if (hasTimedColumns) {
    const propertyIds = db.prepare('SELECT id FROM properties').all().map((row) => Number(row.id));
    propertyIds.forEach((propertyId) => ensureDefaultTimedOptionsForProperty(propertyId));
    if (propertyIds.length > 0) {
      console.log(`[seed:timed-options] checked ${propertyIds.length} property(ies)`);
    }
  }
} catch (error) {
  console.error(`[seed:timed-options] failed: ${error.message}`);
}

db.ensureDefaultTimedOptionsForProperty = ensureDefaultTimedOptionsForProperty;

// ---------- Default "Linge de lit" auto-option (specs/weekly-bed-linen-tracking.md) ----------
// Unlike early_check_in / late_check_out (which are seeded per-property and linked through
// property_options), the bed-linen option is a GLOBAL toggleable option Adrien adds manually
// to a reservation. It also carries `countsAsBedLinen = 1` so it drives the LaundryDayCard
// out of the box.
//
// Non-destructive rules — both must hold for the seed to insert:
//   1. No option already carries `autoOptionType = 'bed_linen'` (idempotency across boots).
//   2. No option already carries `countsAsBedLinen = 1` (some prod servers have an existing
//      manual "Linge de lit" option Adrien already adopted by ticking the new flag — we must
//      NOT add a duplicate alongside it).
//
// If only the manual option exists (countsAsBedLinen=1 without the autoOptionType marker), the
// seed is skipped on purpose: the operator's customised option keeps priority. They can later
// either: rename it to keep working as-is, or delete it + run `npm run reset-admin`-style
// cleanup (out of scope here — manual edit suffices). Documented in the spec.
// ---------- PLATFORM COMMISSION ACCOUNTING ----------
// specs/accounting-platform-commission-and-no-deposit.md §3.1.
// Single source of truth for the per-platform commission config (deduped across all iCal sources).
// `direct` is auto-seeded (never used at export time, kept visible in the UI for consistency).
// New platforms appear automatically on the dedicated page after their first iCal source is created
// (the propertyIcalModel calls platformsModel.upsertByName on every successful create/update).
db.exec(`
  CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT,
    hasVatOnCommission INTEGER NOT NULL DEFAULT 0
  )
`);
// Drop the legacy `commissionRatePercent` column (only ever held informational values for a
// UI cross-check that turned out to be useless — see spec §3.1 and the §6 page layout
// after the 2026-06-04 cleanup). Idempotent: SKIP when column absent. Safe to run on every
// boot since the column is no longer referenced anywhere.
{
  const platformCols = db.prepare("PRAGMA table_info(platforms)").all().map((c) => c.name);
  if (platformCols.includes('commissionRatePercent')) {
    db.exec('ALTER TABLE platforms DROP COLUMN commissionRatePercent');
  }
}
// Always-present 'direct' row + auto-seed from EVERY known platform string in the DB
// (idempotent via INSERT OR IGNORE):
//   1. `ical_sources.platformLabel` — every iCal source declared by the operator.
//   2. `reservations.platform` — covers manually-entered platform reservations whose source
//      isn't an iCal sync (e.g. operator typed "Booking" while creating a one-off reservation).
// The operator can refresh the list at runtime from `/comptabilite/plateformes` (POST
// `/api/accounting/platform-accounts/refresh`) — see platformsModel.rescan.
db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('direct')").run();
db.exec(`
  INSERT OR IGNORE INTO platforms (name)
  SELECT DISTINCT platformLabel FROM ical_sources
   WHERE platformLabel IS NOT NULL AND platformLabel != ''
`);
db.exec(`
  INSERT OR IGNORE INTO platforms (name)
  SELECT DISTINCT platform FROM reservations
   WHERE platform IS NOT NULL AND platform != '' AND LOWER(platform) != 'direct'
`);

// Global commission settings (default account + commission VAT rate). The VAT rate lives in
// Settings → Général → Taux de TVA alongside the existing vatRate (per spec §3.7 rule 17b).
tryAddAppSettingsCol('defaultCommissionAccountNumber', "ALTER TABLE app_settings ADD COLUMN defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600'");
tryAddAppSettingsCol('vatRateCommission',              "ALTER TABLE app_settings ADD COLUMN vatRateCommission REAL NOT NULL DEFAULT 20");

// Idempotency table for one-shot data migrations (= "schema_versions" by another name, kept
// simple). Each one-shot migration inserts its name when it runs successfully.
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// One-shot migration: collapse legacy platform deposits into balance. Per spec §3.3 + §3.4,
// every platform reservation is paid in a single bank transfer, so depositAmount must be 0.
// Past CSV exports change retroactively on these rows — accepted call per spec rule 9.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'platform_no_deposit_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const candidates = db.prepare(`
      SELECT id FROM reservations
       WHERE kind = 'reservation'
         AND platform IS NOT NULL
         AND platform != 'direct'
         AND depositAmount > 0
    `).all();
    if (candidates.length > 0) {
      const tx = db.transaction(() => {
        db.prepare(`
          UPDATE reservations
             SET balanceAmount = balanceAmount + depositAmount,
                 depositAmount = 0,
                 depositPaid = 0,
                 depositPaidDate = NULL,
                 depositDueDate = NULL
           WHERE kind = 'reservation'
             AND platform IS NOT NULL
             AND platform != 'direct'
             AND depositAmount > 0
        `).run();
        // Null out per-line acompte contribs on the migrated reservations' children — the
        // contrib-driven path falls back to legacy pro-rata for any reservation already paid.
        const ids = candidates.map((c) => c.id);
        const placeholders = ids.map(() => '?').join(',');
        if (ids.length > 0) {
          db.prepare(`UPDATE reservation_options SET acompteContribTtc = NULL WHERE reservationId IN (${placeholders})`).run(...ids);
          db.prepare(`UPDATE reservation_custom_options SET acompteContribTtc = NULL WHERE reservationId IN (${placeholders})`).run(...ids);
          db.prepare(`UPDATE reservation_resources SET acompteContribTtc = NULL WHERE reservationId IN (${placeholders})`).run(...ids);
          db.prepare(`UPDATE reservations SET accommodationAcompteContribTtc = NULL, touristTaxAcompteContribTtc = NULL WHERE id IN (${placeholders})`).run(...ids);
        }
      });
      tx();
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
    if (candidates.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[migration:platform-no-deposit] migrated ${candidates.length} reservation(s)`);
    }
  }
}

// Backfill clientGrossAmount = finalPrice for direct bookings where the column is NULL. After
// this spec the column is always populated (= the customer-paid TTC, regardless of platform).
// For directs gross = net trivially; for platforms the value was already entered at booking time.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  db.prepare(`
    UPDATE reservations
       SET clientGrossAmount = finalPrice
     WHERE kind = 'reservation'
       AND clientGrossAmount IS NULL
       AND (platform IS NULL OR platform = 'direct')
  `).run();
}

// ---------- PLATFORM NAMES NORMALIZATION ----------
// specs/normalize-platform-names.md §3.3. One-shot migration: every existing platform name
// (across `platforms.name`, `ical_sources.platformLabel`, `reservations.platform`) is collapsed
// to its canonical UpperCamelCase form. Conflicts in `platforms` (e.g. `Gitedefrance` and
// `gitedefrance` both → `Gitedefrance`) are merged: the row with a non-NULL
// `commissionAccountNumber` wins; tiebreak by lowest id. References in iCal sources +
// reservations follow the merge. Idempotent via `migrations.platform_names_normalized_v1`.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'platform_names_normalized_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runPlatformNamesNormalization } = require('./utils/normalizePlatformNamesMigration');
    const tx = db.transaction(() => {
      const { mergedCount, renamedCount } = runPlatformNamesNormalization(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:platform-names-normalized] merged ${mergedCount} conflict(s), renamed ${renamedCount} row(s)`);
    });
    tx();
  }
}

// ---------- FORCE EXTRAS TO COMPLÉMENT ON PLATFORM RESERVATIONS ----------
// specs/force-extras-complement-on-platform.md §3 rule 6. One-shot migration: every
// extra line (`reservation_options`, `reservation_custom_options`, `reservation_resources`)
// attached to a non-direct platform reservation is forced to `inComplement = 1` with
// both contribs nulled. From this boot onwards, the reservationsModel enforces the same
// invariant on every write — see `replaceOptions` / `replaceCustomOptions` /
// `replaceResources`. Idempotent via `migrations.force_extras_complement_on_platform_v1`.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'force_extras_complement_on_platform_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runForceExtrasComplementOnPlatform } = require('./utils/forceExtrasComplementOnPlatformMigration');
    const tx = db.transaction(() => {
      const { affectedReservations, affectedLines } = runForceExtrasComplementOnPlatform(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:force-extras-complement-on-platform] migrated ${affectedLines} extra line(s) across ${affectedReservations} reservation(s)`);
    });
    tx();
  }
}

// ---------- NORMALISE EMPTY PLATFORM TO 'direct' ----------
// specs/bed-config-in-linen-card.md §10 hotfix follow-up #4. Data invariant: the
// `reservations.platform` column never holds NULL or empty/whitespace. Legacy rows that
// pre-date the controller-level coercion get backfilled here. Idempotent via
// `migrations.platform_empty_to_direct_v1`.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'platform_empty_to_direct_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runNormaliseEmptyPlatformMigration } = require('./utils/normaliseEmptyPlatformMigration');
    const tx = db.transaction(() => {
      const { normalisedCount } = runNormaliseEmptyPlatformMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:platform-empty-to-direct] normalised ${normalisedCount} reservation(s)`);
    });
    tx();
  }
}

// ---------- ZERO BED COUNTS WHEN NO BED-LINEN OPTION ----------
// specs/bed-config-in-linen-card.md §5. One-shot migration: zero
// `singleBeds / doubleBeds / babyBeds` for every reservation that has no
// `countsAsBedLinen = 1` option in reservation_options AND whose property has no such
// option in property_option_defaults. From this boot onwards, the reservationsController
// enforces the same invariant on every save — see `create` / `update` and the
// `hasBedLinenOption` helper. Idempotent via `migrations.zero_beds_when_no_bed_linen_option_v1`.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'zero_beds_when_no_bed_linen_option_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runZeroBedsWhenNoBedLinenMigration } = require('./utils/zeroBedsWhenNoBedLinenMigration');
    const tx = db.transaction(() => {
      const { zeroedCount } = runZeroBedsWhenNoBedLinenMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:zero-beds-when-no-bed-linen-option] zeroed ${zeroedCount} reservation(s)`);
    });
    tx();
  }
}

// ---------- PROPERTY DEFAULT OPTIONS IMPLY APPLICABILITY ----------
// specs/property-default-option-applicability.md rule 1. A property default
// (`property_option_defaults`) means "auto-add this option on every reservation here" — which only
// works if the option is also APPLICABLE to the property (`property_options`), because every code
// path that lists a property's options (the reservation form's client filter, the pricing engine,
// the public catalog) keys off `property_options`. Historically a default could be set without an
// applicability row (e.g. the Gîte's bed-linen default pointing at an option scoped to another
// property), so the option never rendered and its bed-config card never showed. Backfill the missing
// links; `propertyOptionDefaultsModel.set()` keeps them in sync going forward. Idempotent via
// INSERT OR IGNORE + the migrations flag.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'property_defaults_imply_applicability_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT OR IGNORE INTO property_options (propertyId, optionId)
        SELECT propertyId, optionId FROM property_option_defaults
      `).run();
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:property-defaults-imply-applicability] linked ${info.changes} option(s)`);
    });
    tx();
  }
}

// ---------- BACKFILL PROPERTY DEFAULT OPTIONS ONTO EXISTING RESERVATIONS ----------
// specs/property-default-option-applicability.md §5. One-shot backfill: every property default
// option (offered or chargeable, per the configured flag) is inserted onto existing
// `kind='reservation'` rows of that property that lack it — mirroring the iCal-import default insert
// (0-priced; the engine recomputes on the next save, and `getApplicableOptions` now keeps a
// property-default option so it persists). This materialises e.g. the Gîte's offered bed-linen
// default on existing reservations so the in-card bed-config editor finally shows. Idempotent via
// `migrations.backfill_property_default_options_v1` + the migration's own NOT EXISTS guard.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'backfill_property_default_options_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runBackfillPropertyDefaultOptionsMigration } = require('./utils/backfillPropertyDefaultOptionsMigration');
    const tx = db.transaction(() => {
      const { insertedCount } = runBackfillPropertyDefaultOptionsMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:backfill-property-default-options] inserted ${insertedCount} reservation option(s)`);
    });
    tx();
  }
}

const { ensureDefaultBedLinenOption } = require('./utils/bedLinenSeed');
ensureDefaultBedLinenOption(db);
db.ensureDefaultBedLinenOption = ensureDefaultBedLinenOption;

const { ensureDefaultBathroomLinenOption } = require('./utils/bathroomLinenSeed');
ensureDefaultBathroomLinenOption(db);
db.ensureDefaultBathroomLinenOption = ensureDefaultBathroomLinenOption;

// specs/breakfast-option-and-planning-card.md §3 rule 1. Same idempotent typed-default
// pattern as the two linen seeds above: ensures the catalog carries exactly one
// `autoOptionType = 'breakfast'` row, promoting any existing operator-created variant
// before inserting a fresh row.
const { ensureDefaultBreakfastOption } = require('./utils/breakfastSeed');
ensureDefaultBreakfastOption(db);
db.ensureDefaultBreakfastOption = ensureDefaultBreakfastOption;

// specs/j1-arrival-reminder-email.md §4.1 — tag the existing "Ménage" option with
// `autoOptionType = 'cleaning'` so the J-1 reminder can detect whether cleaning was booked.
// Promotion only (never creates a row); idempotent; untyped rows only.
const { ensureCleaningOptionTagged } = require('./utils/cleaningOptionSeed');
ensureCleaningOptionTagged(db);
db.ensureCleaningOptionTagged = ensureCleaningOptionTagged;

// ---------- EMAIL AUTOMATION — specs/email-automation.md ----------
// Two tables: `email_templates` (CRUD-able library) + `email_log` (every send attempt,
// regardless of mode). Both idempotent at boot. The `stableKey` column on templates is
// what `defaultEmailTemplatesSeed` uses to detect "already inserted this registry entry"
// — null for operator-created rows, unique-non-null for registry-seeded ones.
db.exec(`
  CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stableKey TEXT UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    CHECK (sendMode IN ('auto', 'manual'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_templates_enabled_offset
    ON email_templates(enabled, dayOffset);

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER,
    reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL,
    renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT '',
    CHECK (status IN ('sent', 'failed', 'acknowledged-skip'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_log_reservation ON email_log(reservationId);
  CREATE INDEX IF NOT EXISTS idx_email_log_status_sent ON email_log(status, sentAt DESC);
  CREATE INDEX IF NOT EXISTS idx_email_log_template_res ON email_log(templateId, reservationId);

  -- Manually-queued emails (specs/manual-email-from-template.md §5). One row per (template,
  -- reservation) pair the operator explicitly asked to send. Merged into the derived pending
  -- list; removed on send / acknowledge. FK cascade cleans up when a template or reservation
  -- is deleted.
  CREATE TABLE IF NOT EXISTS email_manual_queue (
    templateId    INTEGER NOT NULL,
    reservationId INTEGER NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (templateId, reservationId),
    FOREIGN KEY (templateId)    REFERENCES email_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id)    ON DELETE CASCADE
  );
`);

// specs/mark-email-sent-manually.md §5 — `channel` records HOW a logged email left: 'smtp'
// (sent by GuestFlow) or 'manual' (operator marked it sent from the platform's messaging).
// Additive, idempotent; historical rows default to 'smtp' (they were SMTP sends).
{
  const emailLogCols = db.prepare('PRAGMA table_info(email_log)').all().map((c) => c.name);
  if (!emailLogCols.includes('channel')) {
    db.exec("ALTER TABLE email_log ADD COLUMN channel TEXT NOT NULL DEFAULT 'smtp'");
  }
}

// Online payment links (specs/online-payments-qonto.md §5). One row per Qonto payment link issued
// for a reservation/devis. `reference` reconciliation is by reservationId; the polling pass reads
// `status='open'` rows and flips them to 'paid'. Amounts are stored in cents (integer, exact).
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    type TEXT NOT NULL,
    qontoPaymentLinkId TEXT,
    url TEXT NOT NULL DEFAULT '',
    amountCents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'open',
    qontoPaymentId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    paidAt TEXT,
    expiresAt TEXT,
    CHECK (type IN ('deposit', 'balance', 'full', 'complement')),
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled'))
  );
  CREATE INDEX IF NOT EXISTS idx_payment_links_reservation ON payment_links(reservationId);
  CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);
`);

const { ensureDefaultEmailTemplates } = require('./utils/defaultEmailTemplatesSeed');
ensureDefaultEmailTemplates(db);
db.ensureDefaultEmailTemplates = ensureDefaultEmailTemplates;

// Content migration (specs/email-automation.md §3 rule 13): the shipped J-7 reminder gained
// the {{propertyWithArticle}} token, but the seed is insert-only, so installs seeded before
// the change still carry the old "séjour à {{propertyName}}" phrasing. Upgrade that exact
// phrase to the article-aware token. Idempotent (the LIKE guard skips already-migrated rows)
// and scoped to the shipped template; the plain "- Logement : {{propertyName}}" line is left
// untouched. If the operator rewrote the body without that phrase, this is a no-op.
db.prepare(`
  UPDATE email_templates
  SET subject   = REPLACE(subject, 'séjour à {{propertyName}}', 'séjour {{propertyWithArticle}}'),
      body      = REPLACE(body,    'séjour à {{propertyName}}', 'séjour {{propertyWithArticle}}'),
      updatedAt = datetime('now')
  WHERE stableKey = 'arrival_reminder_7d'
    AND (subject LIKE '%séjour à {{propertyName}}%' OR body LIKE '%séjour à {{propertyName}}%')
`).run();

// Content migration (specs/email-automation.md §3 rule 14): the shipped J-7 reminder now
// signs with {{senderName}} (Settings → Envoi d'emails → "Nom expéditeur") instead of
// {{companyName}}. Upgrade the seeded signature on installs created before the change.
// Idempotent + scoped to the shipped template; operator templates keep {{companyName}}.
db.prepare(`
  UPDATE email_templates
  SET body      = REPLACE(body, '{{companyName}}', '{{senderName}}'),
      updatedAt = datetime('now')
  WHERE stableKey = 'arrival_reminder_7d'
    AND body LIKE '%{{companyName}}%'
`).run();

// Content migration (specs/j1-linen-default-message.md §5): the J-1 reminder body was reworked
// (linen-by-default "beds made" line, "Option(s) réservée(s)" rename, filtered options list). The
// seed is insert-only, so replace the in-place body ONLY when it still equals the previously-shipped
// J-1 body (operator edits are preserved). Idempotent: after the update the body no longer matches.
{
  const PREVIOUS_J1_BODY = [
    'Bonjour {{clientFirstName}},',
    '',
    'C\'est avec grand plaisir que nous vous accueillons dès demain {{propertyWithArticle}} !',
    'Voici un dernier rappel avant votre arrivée.',
    '',
    'Votre séjour :',
    '- Logement : {{propertyName}}',
    '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
    '- Départ   : le {{endDate}} avant {{checkOutTime}}',
    '{{#if hasOptions}}- Options réservées : {{optionsList}}',
    '{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}',
    '{{/if}}',
    '{{#if cautionNotReceived}}Pour finaliser votre arrivée, pensez à prévoir un chèque de caution de {{cautionAmount}} à nous remettre sur place.',
    '',
    '{{/if}}{{#if hasBedLinenOption}}{{else}}Le linge de lit n\'est pas inclus dans votre réservation : pensez à apporter le vôtre (draps, taies d\'oreiller). Vous pouvez aussi nous demander de l\'ajouter, avec plaisir.',
    '',
    '{{/if}}{{#if hasCleaningOption}}{{else}}Le ménage de fin de séjour n\'a pas été réservé : il reste à votre charge avant le départ. N\'hésitez pas si vous souhaitez l\'ajouter, nous nous en occupons volontiers.',
    '',
    '{{/if}}Nous restons à votre entière disposition d\'ici là — répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
    '',
    'Très belles vacances, et à demain !',
    '{{senderName}}',
  ].join('\n');
  const { ARRIVAL_REMINDER_1D_BODY } = require('./utils/defaultEmailTemplatesRegistry');
  db.prepare(`
    UPDATE email_templates
       SET body = ?, updatedAt = datetime('now')
     WHERE stableKey = 'arrival_reminder_1d' AND body = ?
  `).run(ARRIVAL_REMINDER_1D_BODY, PREVIOUS_J1_BODY);
}

// Content migration (specs/j1-complement-to-collect.md §5): the J-1 body gained an unpaid-complement
// notice block. Same in-place upgrade discipline — replace only when the stored body still equals the
// previous (linen-rework) shipped body. Runs after the linen migration above, so a body still on the
// pre-linen version is first lifted to the linen version, then to this one on the next boot.
{
  const PRE_COMPLEMENT_J1_BODY = [
    'Bonjour {{clientFirstName}},',
    '',
    'C\'est avec grand plaisir que nous vous accueillons dès demain {{propertyWithArticle}} !',
    'Voici un dernier rappel avant votre arrivée.',
    '',
    'Votre séjour :',
    '- Logement : {{propertyName}}',
    '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
    '- Départ   : le {{endDate}} avant {{checkOutTime}}',
    '{{#if hasReservedOptions}}- Option(s) réservée(s) : {{reservedOptionsList}}',
    '{{/if}}{{#if hasResources}}- Équipements réservés : {{resourcesList}}',
    '{{/if}}',
    '{{#if cautionNotReceived}}Pour finaliser votre arrivée, pensez à prévoir un chèque de caution de {{cautionAmount}} à nous remettre sur place.',
    '',
    '{{/if}}{{#if bedLinenProvidedByDefault}}Pour votre confort, les lits seront faits à votre arrivée.',
    '',
    '{{/if}}{{#if bedLinenBringYourOwn}}Le linge de lit n\'est pas inclus dans votre réservation : pensez à apporter le vôtre (draps, taies d\'oreiller). Vous pouvez aussi nous demander de l\'ajouter, avec plaisir.',
    '',
    '{{/if}}{{#if hasCleaningOption}}{{else}}Le ménage de fin de séjour n\'a pas été réservé : il reste à votre charge avant le départ. N\'hésitez pas si vous souhaitez l\'ajouter, nous nous en occupons volontiers.',
    '',
    '{{/if}}Nous restons à votre entière disposition d\'ici là — répondez simplement à cet email ou appelez-nous au {{companyPhone}}.',
    '',
    'Très belles vacances, et à demain !',
    '{{senderName}}',
  ].join('\n');
  const { ARRIVAL_REMINDER_1D_BODY } = require('./utils/defaultEmailTemplatesRegistry');
  db.prepare(`
    UPDATE email_templates
       SET body = ?, updatedAt = datetime('now')
     WHERE stableKey = 'arrival_reminder_1d' AND body = ?
  `).run(ARRIVAL_REMINDER_1D_BODY, PRE_COMPLEMENT_J1_BODY);
}

// ---------- ARRIVAL / DEPARTURE SAS — specs/arrival-departure-sas.md ----------
// Priced linen items shown in the SAS (operator-managed in Réglages → Blanchisserie). One table,
// two categories ('bed' bed-linen elements + 'towel' towels/variants).
db.exec(`
  CREATE TABLE IF NOT EXISTS linen_priced_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    label     TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    category  TEXT NOT NULL DEFAULT 'bed',
    sortOrder INTEGER NOT NULL DEFAULT 0
  );
`);
// End-of-stay complement (departure SAS): a dedicated amount, separate from the arrival complement.
{
  const rcols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!rcols.includes('endOfStayComplementAmount')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementAmount REAL NOT NULL DEFAULT 0");
  if (!rcols.includes('endOfStayComplementPaid')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('endOfStayComplementPaidDate')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementPaidDate TEXT");
  if (!rcols.includes('endOfStayComplementDetail')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementDetail TEXT");
  // SAS completion markers (specs/arrival-departure-sas.md §3.0): set on commit so the planning
  // card disables the SAS button once done (no accidental re-run).
  if (!rcols.includes('arrivalSasDoneAt')) db.exec("ALTER TABLE reservations ADD COLUMN arrivalSasDoneAt TEXT");
  if (!rcols.includes('departureSasDoneAt')) db.exec("ALTER TABLE reservations ADD COLUMN departureSasDoneAt TEXT");
  // Breakfast composition captured at check-in (specs/sas-breakfast-and-handover-note.md): counts of
  // hot drinks to prepare each morning + a free note, surfaced on the planning breakfast card. The
  // breakfast hour reuses the existing reservations.breakfastTime column.
  if (!rcols.includes('breakfastCoffee')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastCoffee INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastTea')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastTea INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastChocolate')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastChocolate INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastNote')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastNote TEXT");
  // Handover note authored at the end of the arrival SAS, shown read-only in the departure SAS and on
  // the departure planning card. Dedicated column — kept separate from reservations.notes.
  if (!rcols.includes('departureHandoverNote')) db.exec("ALTER TABLE reservations ADD COLUMN departureHandoverNote TEXT");
}
// Domain gate/access code shown on the arrival SAS (global — one code for the whole domain).
{
  const scols = db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
  if (!scols.includes('portalCode')) db.exec("ALTER TABLE app_settings ADD COLUMN portalCode TEXT DEFAULT ''");
}

// ---------- DB HYGIENE — Bloc 0 ----------
// See specs/db-hygiene-quick-wins.md and utils/dbHygiene.js for the contract.
require('./utils/dbHygiene').applyHygiene(db);

module.exports = db;
