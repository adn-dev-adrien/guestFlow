const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH env var lets CI/CD point to a persistent location outside the deployment folder.
// PERSISTENT_DB is used by deployment scripts. Falls back to the traditional location so existing dev setups are unaffected.
const dbPath = process.env.DB_PATH || process.env.PERSISTENT_DB || path.join(__dirname, '..', 'guestflow.db');
const db = new Database(dbPath);
// Exposed so index.js can surface it in the single boot banner without a second computation.
db.dbPath = dbPath;

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


// ---------- SCHEMA (generated baseline — see schema.sql) ----------
// schema.sql reproduces the production schema exactly and is the single source of truth for a
// fresh DB. Executed first so it is authoritative; the guarded seeds/migrations below are then
// no-ops on an up-to-date database (specs/migrations-baseline.md).
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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

// specs/manual-laundry-additions.md §5 — global per-trip manual linen additions. One row per
// laundry date holds six non-negative per-type counts; they fold into À apporter / À récupérer and
// the inventory simulation like reservation linen. Additive table, starts empty, no migration.
db.exec(`
  CREATE TABLE IF NOT EXISTS laundry_trip_manual_additions (
    tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    singleBeds   INTEGER NOT NULL DEFAULT 0,
    doubleBeds   INTEGER NOT NULL DEFAULT 0,
    babyBeds     INTEGER NOT NULL DEFAULT 0,
    largeTowels  INTEGER NOT NULL DEFAULT 0,
    mediumTowels INTEGER NOT NULL DEFAULT 0,
    smallTowels  INTEGER NOT NULL DEFAULT 0,
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
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

// Per-client email language (specs/email-client-language-and-fiche-polish.md). Additive; existing rows
// backfill to 'fr' via the DEFAULT clause. Drives the language of every email sent to the client.
{
  const clientCols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  if (!clientCols.includes('emailLanguage')) {
    db.exec("ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
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
  // Human-readable reservation number (specs/reservation-number-and-search.md). NULL for devis
  // (they keep devisNumber); partial unique index mirrors ux_reservations_devisNumber.
  if (!rcols.includes('reservationNumber')) db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  // Per-reservation email language (specs/email-language-fr-en.md). 'fr' (default) | 'en'. Existing rows
  // backfill to 'fr' via the DEFAULT clause; the email preview/send pipeline reads this column.
  if (!rcols.includes('emailLanguage')) db.exec("ALTER TABLE reservations ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_devisNumber ON reservations(devisNumber) WHERE devisNumber IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_reservationNumber ON reservations(reservationNumber) WHERE reservationNumber IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_reservations_kind ON reservations(kind)');

  const { migrateDevisIntoReservations, assessDevisFusion, dropLegacyDevisTables } = require('./utils/devisFusionMigration');
  // Robust boot decision (works on prod, not just the dev symptom — see assessDevisFusion). A
  // pre-migration `.bak` is written ONLY for the genuine one-time fusion, never on every boot.
  const fusion = assessDevisFusion(db);
  if (fusion.action === 'migrate') {
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
  } else if (fusion.action === 'dropLeftover') {
    // Rows already fused, the legacy devis_* tables are EMPTY husks (a pre-atomic-migration artefact).
    // Drop them once — no data to lose, no backup. This ends the boot loop that used to re-write a
    // `.pre-devis-fusion-*.bak` on every start.
    dropLegacyDevisTables(db);
    console.log('[Fusion] Dropped empty legacy devis_* tables (rows already fused) — no backup needed.');
  } else if (fusion.action === 'skipAmbiguous') {
    // Legacy devis rows AND fused rows coexist — the atomic migration can't produce this, so it's a
    // corrupt/partial artefact. Never auto-resolve (data-loss risk) and never re-backup; surface it.
    console.warn(`[Fusion] Ambiguous devis state — left untouched for manual check (legacy devis rows: ${fusion.pendingDevis}, fused: ${fusion.alreadyFused}, legacy rows total: ${fusion.legacyRowTotal}).`);
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

// Hourly-scheduled resources (specs/resource-hourly-scheduling.md): a time-banded grid (day/evening
// rate + an evening switch time), a separate « extérieurs » rate pair, and a planning-card flag. Plus a
// per-reservation session list. Idempotent ALTERs for DBs predating schema.sql baseline #225.
{
  const rcols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  if (!rcols.includes('showsPlanningCard')) db.exec('ALTER TABLE resources ADD COLUMN showsPlanningCard INTEGER NOT NULL DEFAULT 0');
  if (!rcols.includes('hourlyEveningStart')) db.exec('ALTER TABLE resources ADD COLUMN hourlyEveningStart TEXT');
  if (!rcols.includes('hourlyEveningRate')) db.exec('ALTER TABLE resources ADD COLUMN hourlyEveningRate REAL NOT NULL DEFAULT 0');
  if (!rcols.includes('hourlyExternalDayRate')) db.exec('ALTER TABLE resources ADD COLUMN hourlyExternalDayRate REAL NOT NULL DEFAULT 0');
  if (!rcols.includes('hourlyExternalEveningRate')) db.exec('ALTER TABLE resources ADD COLUMN hourlyExternalEveningRate REAL NOT NULL DEFAULT 0');
  const rrcols = db.prepare('PRAGMA table_info(reservation_resources)').all().map((c) => c.name);
  if (!rrcols.includes('sessions')) db.exec('ALTER TABLE reservation_resources ADD COLUMN sessions TEXT');
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
  // Commission % per platform (specs/platform-price-from-commission.md): now functional — drives the
  // « prix plateforme » gross-up on the property tarif page (gross = net / (1 − c/100)). Global per
  // platform. Distinct from the dropped informational `commissionRatePercent`.
  if (!platformCols.includes('commissionPercent')) {
    db.exec('ALTER TABLE platforms ADD COLUMN commissionPercent REAL NOT NULL DEFAULT 0');
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

// One-shot migration (specs/breakfast-option-planning-card.md §3 rule 7): the breakfast option gained
// the per-day occurrence selection. Seed `cardOccurrences` on every existing reservation that carries
// the breakfast option but has none yet — one entry per served morning (startDate, endDate] at the
// reservation's breakfast hour — so its planning card keeps showing AND a future re-save preserves the
// charge (a card-option with no occurrences would otherwise drop the line).
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'breakfast_card_occurrences_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  const roCols = db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name);
  const optCols = db.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
  if (!ran && roCols.includes('cardOccurrences') && optCols.includes('autoOptionType')) {
    const rows = db.prepare(`
      SELECT ro.reservationId, ro.optionId, r.startDate, r.endDate,
             COALESCE(NULLIF(r.breakfastTime, ''), NULLIF(o.breakfastTime, ''), '09:00') AS bkfTime
        FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        JOIN reservations r ON r.id = ro.reservationId
       WHERE o.autoOptionType = 'breakfast'
         AND (ro.cardOccurrences IS NULL OR TRIM(ro.cardOccurrences) = '')
    `).all();
    // Served mornings = (startDate, endDate] : exclude the arrival morning, include the departure one.
    const mornings = (start, end) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) return [];
      let cur = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10)) + 86400000;
      const cap = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
      const out = [];
      for (let i = 0; i < 366 && cur <= cap; i += 1) { out.push(new Date(cur).toISOString().slice(0, 10)); cur += 86400000; }
      return out;
    };
    const upd = db.prepare('UPDATE reservation_options SET cardOccurrences = ? WHERE reservationId = ? AND optionId = ?');
    let migrated = 0;
    const tx = db.transaction(() => {
      for (const r of rows) {
        const occ = mornings(String(r.startDate), String(r.endDate)).map((d) => ({ date: d, time: r.bkfTime, done: false }));
        if (occ.length === 0) continue;
        upd.run(JSON.stringify(occ), r.reservationId, r.optionId);
        migrated += 1;
      }
    });
    tx();
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[migration:breakfast-card-occurrences] seeded occurrences on ${migrated} reservation(s)`);
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

// Bilingual templates (specs/email-language-fr-en.md): optional English subject/body. Additive +
// idempotent; must run BEFORE the seed so fresh installs insert the EN side too.
{
  const etCols = db.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
  if (!etCols.includes('subjectEn')) db.exec('ALTER TABLE email_templates ADD COLUMN subjectEn TEXT');
  if (!etCols.includes('bodyEn'))    db.exec('ALTER TABLE email_templates ADD COLUMN bodyEn TEXT');
}

const { ensureDefaultEmailTemplates } = require('./utils/defaultEmailTemplatesSeed');
ensureDefaultEmailTemplates(db);
db.ensureDefaultEmailTemplates = ensureDefaultEmailTemplates;

// Content migration (specs/email-language-fr-en.md §3 rule 6): backfill the shipped English subject/body
// onto the two default reminders for installs seeded before the bilingual feature — ONLY when the EN
// columns are still empty (operator EN edits + the French side are never touched). Idempotent.
{
  const { DEFAULT_TEMPLATES } = require('./utils/defaultEmailTemplatesRegistry');
  const upd = db.prepare(`
    UPDATE email_templates SET subjectEn = ?, bodyEn = ?, updatedAt = datetime('now')
     WHERE stableKey = ? AND (subjectEn IS NULL OR subjectEn = '') AND (bodyEn IS NULL OR bodyEn = '')
  `);
  for (const def of DEFAULT_TEMPLATES) {
    if (def.bodyEn) upd.run(def.subjectEn || '', def.bodyEn, def.stableKey);
  }
}

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

// Content migration (specs/j1-arrival-reminder-email.md): the arrival reminder moved from J-1 to J-2
// and was fully rewritten (stay date instead of « demain », GPS line, nordic-bath gear/schedule block,
// cleaning matched by option NAME). Adrien explicitly asked to OVERWRITE the row even if it was
// personalised — so this is a one-shot FORCE-sync of name/subject/body/dayOffset to the registry def
// (sendMode + enabled are preserved). Runs once, AFTER the exact-match chain above so it has the final
// say; guarded by the `migrations` table so a later operator edit is never clobbered again.
{
  const migrationName = 'arrival_reminder_j2_overwrite_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runArrivalReminderJ2Migration } = require('./utils/migrateArrivalReminderJ2');
    const tx = db.transaction(() => {
      const { action } = runArrivalReminderJ2Migration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      console.log(`[migration:arrival-reminder-j2] ${action}`);
    });
    tx();
  }
}

// Content migration (specs/reservation-number-and-search.md §4): the J-7 and J-2 reminders now recall
// the reservation number in the stay recap. The seed is insert-only and the J-2 force-overwrite already
// ran (guarded), so reach already-seeded rows with a targeted, idempotent REPLACE — insert the gated
// `{{#if hasReservationNumber}}` line between the recap header and "- Logement". Idempotent (skipped once
// the token is present); a no-op when the operator rewrote the recap header (the anchor won't match).
for (const [stableKey, header] of [
  ['arrival_reminder_7d', 'Rappel des informations de votre séjour :'],
  ['arrival_reminder_1d', 'Votre séjour :'],
]) {
  const anchor = `${header}\n- Logement : {{propertyName}}`;
  const replacement = `${header}\n{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}\n{{/if}}- Logement : {{propertyName}}`;
  db.prepare(`
    UPDATE email_templates
       SET body = REPLACE(body, ?, ?), updatedAt = datetime('now')
     WHERE stableKey = ? AND body NOT LIKE '%{{reservationNumber}}%'
  `).run(anchor, replacement, stableKey);
}

// Backfill reservation numbers (specs/reservation-number-and-search.md §5). Existing reservations
// predate the `reservationNumber` column, so give each one a number once — grouped by the month of
// its createdAt, sequential within the month. Guarded by the `migrations` table; idempotent anyway
// (only NULL/empty rows are filled). Devis are untouched.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'reservation_number_backfill_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { backfillReservationNumbers } = require('./utils/reservationNumber');
    const tx = db.transaction(() => {
      const assigned = backfillReservationNumbers(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      console.log(`[migration:reservation-number-backfill] assigned ${assigned} number(s)`);
    });
    tx();
  }
}

// Drop the separators from reservation numbers (specs/reservation-number-and-search.md §3): the format
// changed from `AAAA-MM-###` to `AAAAMM###`. Reformat ONLY values still in the original hyphenated shape;
// operator-customised / non-conforming numbers are left as-is. Guarded once; collision-safe.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'reservation_number_drop_hyphens_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { dehyphenateReservationNumbers } = require('./utils/reservationNumber');
    const tx = db.transaction(() => {
      const reformatted = dehyphenateReservationNumbers(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      console.log(`[migration:reservation-number-drop-hyphens] reformatted ${reformatted} number(s)`);
    });
    tx();
  }
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
// « Tarifs facturables » — repair amounts (operator-managed in Réglages). Generic priced list; rows with
// a `repairKey` are SAS-linked + protected. Seeded with the fire-extinguisher seal
// (specs/extinguisher-seal-and-repair-amounts.md).
db.exec(`
  CREATE TABLE IF NOT EXISTS repair_amounts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    repairKey TEXT,
    label     TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );
`);
if (!db.prepare("SELECT 1 FROM repair_amounts WHERE repairKey = 'extinguisher_seal' LIMIT 1").get()) {
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price, sortOrder) VALUES ('extinguisher_seal', 'Plomb manquant', 0, 0)").run();
}
// Extinguisher-condition tariffs (specs/extinguisher-seal-and-repair-amounts.md §3.2 — 2026-06-17):
// the departure SAS asks « extincteur en bon état ? » and, if not, bills these per-quantity. Relabel
// the legacy seed (was « Plomb extincteur ») in place — the label is operator-protected, so it's always
// the seed default — and add the « Utilisation » tariff.
db.prepare("UPDATE repair_amounts SET label = 'Plomb manquant' WHERE repairKey = 'extinguisher_seal' AND label = 'Plomb extincteur'").run();
if (!db.prepare("SELECT 1 FROM repair_amounts WHERE repairKey = 'extinguisher_use' LIMIT 1").get()) {
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price, sortOrder) VALUES ('extinguisher_use', 'Utilisation', 0, 1)").run();
}
// End-of-stay complement (departure SAS): a dedicated amount, separate from the arrival complement.
{
  const rcols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!rcols.includes('endOfStayComplementAmount')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementAmount REAL NOT NULL DEFAULT 0");
  if (!rcols.includes('endOfStayComplementPaid')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('endOfStayComplementPaidDate')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementPaidDate TEXT");
  if (!rcols.includes('endOfStayComplementDetail')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementDetail TEXT");
  // « Caisse interne » markers (specs/cash-complement-and-endofstay-finance.md §3.2): when set, the
  // complement is settled (paid) and COUNTS in the financial tracking, but is EXCLUDED from the
  // accounting (compta) + the accounting export. Independent per complement.
  if (!rcols.includes('complementPaidCash')) db.exec("ALTER TABLE reservations ADD COLUMN complementPaidCash INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('endOfStayComplementPaidCash')) db.exec("ALTER TABLE reservations ADD COLUMN endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0");
  // SAS completion markers (specs/arrival-departure-sas.md §3.0): set on commit so the planning
  // card disables the SAS button once done (no accidental re-run).
  if (!rcols.includes('arrivalSasDoneAt')) db.exec("ALTER TABLE reservations ADD COLUMN arrivalSasDoneAt TEXT");
  if (!rcols.includes('departureSasDoneAt')) db.exec("ALTER TABLE reservations ADD COLUMN departureSasDoneAt TEXT");
  // Fire-extinguisher seal state captured in the SAS (specs/extinguisher-seal-and-repair-amounts.md):
  // 1 = present, 0 = missing, NULL = not recorded (présent assumed by default at departure).
  if (!rcols.includes('extinguisherSealOkAtArrival')) db.exec("ALTER TABLE reservations ADD COLUMN extinguisherSealOkAtArrival INTEGER");
  if (!rcols.includes('extinguisherSealOkAtDeparture')) db.exec("ALTER TABLE reservations ADD COLUMN extinguisherSealOkAtDeparture INTEGER");
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
  // Per-event push-notification guards (specs/pwa-push-notifications.md §3.3): the local date on which
  // the arrival (resp. departure) push was sent for this reservation, so it fires once.
  if (!rcols.includes('arrivalNotifiedAt')) db.exec("ALTER TABLE reservations ADD COLUMN arrivalNotifiedAt TEXT");
  if (!rcols.includes('departureNotifiedAt')) db.exec("ALTER TABLE reservations ADD COLUMN departureNotifiedAt TEXT");
}
// PWA Web Push (specs/pwa-push-notifications.md §5): per-(user,device) subscriptions + per-user prefs.
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_push_prefs (
    userId INTEGER PRIMARY KEY,
    newReservation INTEGER NOT NULL DEFAULT 1,
    arrivals INTEGER NOT NULL DEFAULT 1,
    departures INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
`);
// Domain gate/access code shown on the arrival SAS (global — one code for the whole domain).
{
  const scols = db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
  if (!scols.includes('portalCode')) db.exec("ALTER TABLE app_settings ADD COLUMN portalCode TEXT DEFAULT ''");
}

// ---------- DB HYGIENE — Bloc 0 ----------
// See specs/db-hygiene-quick-wins.md and utils/dbHygiene.js for the contract.
require('./utils/dbHygiene').applyHygiene(db);

module.exports = db;
