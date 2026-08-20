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
//
// ⚠ Sur une base EXISTANTE, le baseline peut legitimement echouer en cours de route, et ce
// n'est pas une anomalie : `CREATE TABLE IF NOT EXISTS` est un no-op sur une table deja
// presente, donc une colonne ajoutee par l'une des migrations gardees plus bas est encore
// absente quand schema.sql atteint l'index qui la reference. exec() interrompt alors TOUT le
// script — et les migrations qui auraient ajoute la colonne ne s'executent jamais.
//
// Constate en production le 2026-08-19 : `CREATE INDEX idx_reservations_cancelled ON
// reservations(cancelledAt)` (schema.sql) s'executait ~1250 lignes AVANT
// `ALTER TABLE reservations ADD COLUMN cancelledAt` (ce fichier). Tout deploiement sur une
// base existante mourait la. Comme le workflow arrete PM2 *avant* les migrations,
// l'application restait a terre jusqu'a ce que quelqu'un ajoute les colonnes a la main.
//
// Correctif : tolerer un baseline partiel ici, laisser tourner les migrations gardees, puis
// REJOUER le baseline en fin de fichier — chaque instruction de schema.sql etant
// `IF NOT EXISTS`, le rejeu est idempotent et cree exactement ce que la premiere passe n'a
// pas pu creer. Si le rejeu echoue encore, l'erreur est reelle et remonte.
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
let baselineDeferredError = null;
try {
  db.exec(SCHEMA_SQL);
} catch (err) {
  baselineDeferredError = err;
  console.warn(
    `[schema] baseline applique partiellement (${err.message}) — rejeu prevu apres les migrations gardees.`
  );
}

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

// specs/laundry-bath-mat.md §5 — per-property bath-mat quantity for the "Tapis de bain" option.
// Mirror of property_option_prices: an absent row means quantity 0 for that property. Additive,
// starts empty, no data migration.
db.exec(`
  CREATE TABLE IF NOT EXISTS property_option_bath_mats (
    propertyId INTEGER NOT NULL,
    optionId   INTEGER NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId)   REFERENCES options(id)    ON DELETE CASCADE
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

// specs/laundry-extra-trip.md §5 — global extra laundry trips on a free date (early pick-up). One
// row per date: `pickUpAll` (default 1) or the seven per-type quantities actually taken back when the
// pick-up is partial. The summary ledger + the inventory engine read it. Additive, starts empty.
db.exec(`
  CREATE TABLE IF NOT EXISTS laundry_extra_trips (
    tripDate     TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    pickUpAll    INTEGER NOT NULL DEFAULT 1,
    singleBeds   INTEGER NOT NULL DEFAULT 0,
    doubleBeds   INTEGER NOT NULL DEFAULT 0,
    babyBeds     INTEGER NOT NULL DEFAULT 0,
    largeTowels  INTEGER NOT NULL DEFAULT 0,
    mediumTowels INTEGER NOT NULL DEFAULT 0,
    smallTowels  INTEGER NOT NULL DEFAULT 0,
    bathMats     INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL DEFAULT (datetime('now')),
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
// 2026-08-12 — accounting closing month (specs/fiscal-year-and-nights-sold.md §5). The exercise ends
// on the last day of this month and starts the day after: 9 → 1 Oct … 30 Sep. Default 12 = calendar
// year, i.e. exactly the behaviour of every annual figure before this spec, so existing rows keep
// reading the same way until the operator changes it.
tryAddAppSettingsCol('fiscalYearEndMonth', "ALTER TABLE app_settings ADD COLUMN fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12");
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
// Bath mat as a 7th linen type (specs/laundry-bath-mat.md §5). Stock shared across properties,
// 0 = "type not tracked", same convention as the other six.
tryAddAppSettingsCol('towelStockBathMat',   "ALTER TABLE app_settings ADD COLUMN towelStockBathMat   INTEGER NOT NULL DEFAULT 0");
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
// 2026-07-18 — Google Calendar OAuth rework (specs/google-calendar-oauth-rework.md §5). The OAuth
// client id/secret live in .env.local; these columns hold the per-connection refresh token
// (AES-256-GCM, masked on read) + non-secret connection metadata and last-sync state.
// `googleLastSyncOk` is tri-state: 1/0/NULL (never ran).
tryAddAppSettingsCol('googleOAuthRefreshTokenEncrypted', "ALTER TABLE app_settings ADD COLUMN googleOAuthRefreshTokenEncrypted TEXT DEFAULT ''");
tryAddAppSettingsCol('googleOAuthConnectedEmail',        "ALTER TABLE app_settings ADD COLUMN googleOAuthConnectedEmail        TEXT DEFAULT ''");
tryAddAppSettingsCol('googleOAuthConnectedAt',           "ALTER TABLE app_settings ADD COLUMN googleOAuthConnectedAt           TEXT DEFAULT ''");
tryAddAppSettingsCol('googleCalendarSummary',            "ALTER TABLE app_settings ADD COLUMN googleCalendarSummary            TEXT DEFAULT ''");
tryAddAppSettingsCol('googleLastSyncAt',                 "ALTER TABLE app_settings ADD COLUMN googleLastSyncAt                 TEXT DEFAULT ''");
tryAddAppSettingsCol('googleLastSyncOk',                 "ALTER TABLE app_settings ADD COLUMN googleLastSyncOk                 INTEGER DEFAULT NULL");
tryAddAppSettingsCol('googleLastSyncDetail',             "ALTER TABLE app_settings ADD COLUMN googleLastSyncDetail             TEXT DEFAULT ''");
// One-shot clear of the legacy service-account credentials: the SA auth mechanism is removed by
// the OAuth rework (columns physically kept for schema parity; the model no longer reads them).
// Idempotent — the WHERE clauses make re-runs no-ops; guarded so a future drop of the dead
// columns from schema.sql doesn't crash fresh installs at boot.
if (appSettingsCols.includes('googleServiceAccountEmail') && appSettingsCols.includes('googleServiceAccountPrivateKey')) {
  db.prepare("UPDATE app_settings SET googleServiceAccountEmail = '', googleServiceAccountPrivateKey = '' WHERE id = 1 AND (googleServiceAccountEmail != '' OR googleServiceAccountPrivateKey != '')").run();
}
// A calendar id stored while NO OAuth connection exists is necessarily a leftover from the
// service-account era (the new picker only writes it once connected). Clearing it forces the
// post-connect « Configuration en cours » step instead of silently syncing to the old target.
db.prepare("UPDATE app_settings SET googleCalendarId = '', googleCalendarSummary = '' WHERE id = 1 AND googleCalendarId != '' AND googleOAuthRefreshTokenEncrypted = ''").run();
// Admin-only escape hatch for legitimate corrections on past reservations (typo in dates,
// wrong property assigned). OFF by default; the existing server-side lock keeps holding.
// See specs/admin-unlock-past-reservations.md (Approved 2026-06-01).
tryAddAppSettingsCol('allowEditPastReservations', "ALTER TABLE app_settings ADD COLUMN allowEditPastReservations INTEGER NOT NULL DEFAULT 0");
// Master switch for every AUTOMATIC guest email (specs/no-automatic-email-without-approval.md §5).
// OFF by default — on fresh installs AND on upgrade: a guest email leaves GuestFlow only when the
// operator sends it, unless this is explicitly turned on in Réglages.
tryAddAppSettingsCol('emailAutoSendEnabled', "ALTER TABLE app_settings ADD COLUMN emailAutoSendEnabled INTEGER NOT NULL DEFAULT 0");
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
// Capacity as ONE total instead of three additive buckets (specs/property-capacity-single-total.md
// §5). `maxGuests` counts everyone over 2 (adults + teens + children); `maxBabies` stays separate
// and out of the total. Backfilled from `maxAdults`, which is the number operators actually used as
// "how many people fit" — so no property gets tighter than it is today, and every property stops
// rejecting children (`maxChildren` was 0 on the lodge, blocking 1 adulte + 1 enfant).
// Driven by PRAGMA so restoring an older backup re-runs add → backfill → drop safely.
{
  const propColsBefore = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  if (!propColsBefore.includes('maxGuests')) {
    db.exec('ALTER TABLE properties ADD COLUMN maxGuests INTEGER DEFAULT 2');
    if (propColsBefore.includes('maxAdults')) {
      db.exec('UPDATE properties SET maxGuests = COALESCE(NULLIF(maxAdults, 0), 2)');
    }
  }
  const propColsAfter = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  for (const col of ['maxAdults', 'maxChildren']) {
    if (propColsAfter.includes(col)) db.exec(`ALTER TABLE properties DROP COLUMN ${col}`);
  }
}

// Per-property « Acompte en ligne » toggle (specs/public-online-deposit.md §5). Default 0 → existing
// behaviour (single online full payment) is unchanged until the operator opts a property in.
{
  const propCols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  if (!propCols.includes('publicDepositEnabled')) {
    db.exec('ALTER TABLE properties ADD COLUMN publicDepositEnabled INTEGER NOT NULL DEFAULT 0');
  }
}

// ---------- TARIFF RECIPES (specs/tariff-recipes/) ----------
// Every default reproduces the pre-recipe behaviour byte-for-byte: no recipe, per-stay extra guest,
// no welcome-pack add-on, untagged seasons (never touched by an apply), unrestricted changeover,
// net = pricePerNight for the platform grid.
{
  const propCols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  const tryAddProp = (col, sql) => { if (!propCols.includes(col)) db.exec(sql); };
  tryAddProp('tariffRecipeId', "ALTER TABLE properties ADD COLUMN tariffRecipeId TEXT DEFAULT ''");
  tryAddProp('tariffRecipeVersion', "ALTER TABLE properties ADD COLUMN tariffRecipeVersion TEXT DEFAULT ''");
  tryAddProp('extraGuestPriceUnit', "ALTER TABLE properties ADD COLUMN extraGuestPriceUnit TEXT DEFAULT 'per_stay'");
  tryAddProp('welcomePackCost', 'ALTER TABLE properties ADD COLUMN welcomePackCost REAL DEFAULT 0');

  const ruleCols = db.prepare("PRAGMA table_info(pricing_rules)").all().map((c) => c.name);
  const tryAddRule = (col, sql) => { if (!ruleCols.includes(col)) db.exec(sql); };
  tryAddRule('seasonKey', 'ALTER TABLE pricing_rules ADD COLUMN seasonKey TEXT DEFAULT NULL');
  tryAddRule('seasonRank', 'ALTER TABLE pricing_rules ADD COLUMN seasonRank INTEGER DEFAULT NULL');
  tryAddRule('netTargetPerNight', 'ALTER TABLE pricing_rules ADD COLUMN netTargetPerNight REAL DEFAULT NULL');
  tryAddRule('extraGuestPrice', 'ALTER TABLE pricing_rules ADD COLUMN extraGuestPrice REAL DEFAULT NULL');
  tryAddRule('extraGuestNetTarget', 'ALTER TABLE pricing_rules ADD COLUMN extraGuestNetTarget REAL DEFAULT NULL');
  tryAddRule('maxNights', 'ALTER TABLE pricing_rules ADD COLUMN maxNights INTEGER DEFAULT NULL');
  tryAddRule('changeoverArrival', 'ALTER TABLE pricing_rules ADD COLUMN changeoverArrival INTEGER DEFAULT NULL');
  tryAddRule('changeoverDeparture', 'ALTER TABLE pricing_rules ADD COLUMN changeoverDeparture INTEGER DEFAULT NULL');
  // specs/tariff-events-and-extra-guest-tiers/spec.md §5 — the extra-guest supplement as a per-night
  // tier table, JSON, mirroring `progressiveTiers`. NULL = the single `extraGuestPrice` applies,
  // which is what every existing row has: the migration cannot move a price.
  tryAddRule('extraGuestTiers', 'ALTER TABLE pricing_rules ADD COLUMN extraGuestTiers TEXT DEFAULT NULL');

  // specs/tariff-recipes/spec.md §3.9 rule 52bis — the first N units of an option can be included in
  // the rate (the direct welcome pack's two breakfasts). 0 = nothing free, today's behaviour.
  {
    const priceCols = db.prepare("PRAGMA table_info(property_option_prices)").all().map((c) => c.name);
    if (priceCols.length && !priceCols.includes('freeUnits')) {
      db.exec('ALTER TABLE property_option_prices ADD COLUMN freeUnits REAL NOT NULL DEFAULT 0');
    }
  }

  // specs/tariff-recipes/spec.md §3.2 rule 12bis — the tariff context a reservation was SOLD under,
  // captured at creation. Nights and option lines were already frozen per date / per line; the
  // property-level tariff (included guests, extra-guest price/unit/tiers, included units per option)
  // was not, so editing an old reservation re-priced it with today's recipe. NULL = a reservation
  // created before this column: it keeps the live behaviour, which is what it has always had.
  {
    const resCols = db.prepare("PRAGMA table_info(reservations)").all().map((c) => c.name);
    if (resCols.length && !resCols.includes('tariffSnapshot')) {
      db.exec('ALTER TABLE reservations ADD COLUMN tariffSnapshot TEXT DEFAULT NULL');

      // ONE-SHOT BACKFILL, in the same boot as the column. Without it the protection would only
      // cover reservations created from here on, and every booking ALREADY SOLD — the ones a recipe
      // change actually threatens — would still be re-priced the next time someone saved it.
      //
      // What is stamped is exact, not approximate: at this instant no recipe has been applied yet
      // (the configure script runs after the deploy), so the property still holds the tariff these
      // reservations were sold under. And the two recipe-era fields provably did not exist for them:
      // `pricing_rules.extraGuestTiers` and `property_option_prices.freeUnits` are introduced by this
      // very migration with NULL / 0, so no existing reservation was ever sold with either.
      //
      // Guarded by the column creation rather than by `WHERE tariffSnapshot IS NULL`, so it can only
      // ever run once and can never stamp a row created later by a path that writes no snapshot.
      const sold = db.prepare(`
        SELECT r.id,
               COALESCE(p.basePriceIncludedGuests, 0) AS includedGuests,
               COALESCE(p.extraGuestPrice, 0)         AS extraGuestPrice,
               COALESCE(p.extraGuestPriceUnit, 'per_stay') AS extraGuestPriceUnit
        FROM reservations r JOIN properties p ON p.id = r.propertyId
      `).all();
      const stamp = db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?');
      db.transaction(() => {
        for (const row of sold) {
          stamp.run(JSON.stringify({
            includedGuests: Number(row.includedGuests),
            extraGuestPrice: Number(row.extraGuestPrice),
            extraGuestPriceUnit: row.extraGuestPriceUnit === 'per_night' ? 'per_night' : 'per_stay',
            extraGuestTiers: null,
            freeUnitsByOption: {},
          }), row.id);
        }
      })();
      if (sold.length) console.log(`[tariff-snapshot] ${sold.length} réservation(s) figée(s) au tarif en vigueur`);
    }
  }

  // Journal of the scheduled horizon-extension runs → Dashboard alerts (spec §5). UI applies do
  // not write here — only the background task, so a silently generated year is always surfaced.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tariff_recipe_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propertyId INTEGER NOT NULL,
      recipeId TEXT NOT NULL,
      recipeVersion TEXT NOT NULL DEFAULT '',
      generatedYear INTEGER,
      note TEXT NOT NULL DEFAULT '',
      blocking INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      dismissedAt TEXT,
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tariff_recipe_runs_propertyId ON tariff_recipe_runs(propertyId)');

  // specs/tariff-change-journal.md §5 — WHEN the grid changed, and when travellers saw it. Two
  // distinct beats: `recipe` (the apply inside GuestFlow) and `platforms` (the rollout to Lodgify,
  // GreenGo, Abracadaroom, declared by hand because GuestFlow cannot observe it). `occurredAt` is
  // the moment the change took effect, `createdAt` the moment the row was written — a rollout is
  // routinely declared after the fact. Nothing here feeds a price: it is a register.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tariff_change_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      propertyId    INTEGER NOT NULL,
      kind          TEXT    NOT NULL,
      recipeId      TEXT    NOT NULL DEFAULT '',
      recipeVersion TEXT    NOT NULL DEFAULT '',
      occurredAt    TEXT    NOT NULL,
      source        TEXT    NOT NULL DEFAULT 'manual',
      note          TEXT    NOT NULL DEFAULT '',
      createdAt     TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tariff_change_events_property ON tariff_change_events(propertyId, occurredAt)');

  // RATTRAPAGE (spec rule 11). Before this table existed, the only trace of an apply was
  // `properties.updatedAt` — a column the next property-form save overwrites. Recover it while it is
  // still there, for every property carrying a recipe and holding no event yet.
  //
  // The date is DEDUCED, not observed: `updatedAt` is the property's last modification, which is the
  // apply only if nothing touched the row since. The note says so, so nobody later reads it as a
  // measurement. Guarded by the absence of an event rather than by the table creation, so a property
  // whose recipe is attached later by a script gets caught too.
  {
    const orphans = db.prepare(`
      SELECT p.id, p.tariffRecipeId, p.tariffRecipeVersion, p.updatedAt
      FROM properties p
      WHERE p.tariffRecipeId != ''
        AND NOT EXISTS (SELECT 1 FROM tariff_change_events e WHERE e.propertyId = p.id)
    `).all();
    if (orphans.length) {
      const stamp = db.prepare(`
        INSERT INTO tariff_change_events (propertyId, kind, recipeId, recipeVersion, occurredAt, source, note)
        VALUES (?, 'recipe', ?, ?, ?, 'backfill', ?)
      `);
      db.transaction(() => {
        for (const row of orphans) {
          stamp.run(
            row.id,
            row.tariffRecipeId || '',
            row.tariffRecipeVersion || '',
            row.updatedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
            "Date déduite de la dernière modification de la fiche logement, pas observée : le journal n'existait pas encore lors de cette application.",
          );
        }
      })();
      console.log(`[tariff-change-journal] ${orphans.length} application(s) de recette rattrapée(s) depuis updatedAt`);
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

// Thermal model of an hourly resource (specs/hourly-resource-quantity-and-sas-scheduling.md §3.3).
// A nordic bath needs a warm-up from cold, and stays usable for a while after a use — which decides
// whether the next guest only waits the turnover or the whole warm-up. Both default to 0, i.e. the
// pre-existing availability behaviour, so no configured resource changes until the operator fills
// them in (§3.3 rule 16).
{
  const rcols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  if (!rcols.includes('heatUpMinutes')) db.exec('ALTER TABLE resources ADD COLUMN heatUpMinutes INTEGER NOT NULL DEFAULT 0');
  if (!rcols.includes('heatRetentionMinutes')) db.exec('ALTER TABLE resources ADD COLUMN heatRetentionMinutes INTEGER NOT NULL DEFAULT 0');
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
    // Bath-mat linen option flag (specs/laundry-bath-mat.md §5) — drives the LaundryDayCard like
    // countsAsBedLinen / countsAsBathroomLinen. Brand-new column, absent on pre-feature prod DBs.
    ['countsAsBathMat',         'INTEGER NOT NULL DEFAULT 0'],
    // Client-visibility flag (specs/laundry-bath-mat.md §3 rule 11). Default 1 = shown on every
    // client/operator surface (no behaviour change). 0 = internal-only (laundry + stock only).
    ['displayToClient',         'INTEGER NOT NULL DEFAULT 1'],
    // 2026-07-19 — backfill: breakfastTime lived only in schema.sql (fresh DBs); older DBs relied
    // on the HAS_OPTION_BREAKFAST_TIME guards. Adding it here makes the column universal.
    ['breakfastTime',           "TEXT DEFAULT '09:00'"],
    // Breakfast push notice (specs/sas-breakfast-bread-and-push.md rule 7): the push fires
    // `breakfastNotifyLeadMinutes` before the serving time. Configurable on the breakfast option.
    ['breakfastNotifyLeadMinutes', 'INTEGER NOT NULL DEFAULT 30'],
    // Free-text grouping label (specs/option-categories.md §5.1). '' = ungrouped = the historical
    // flat rendering; a non-empty label folds the option into a collapsible section on the fiche
    // and on the public widget.
    ['category',                'TEXT NOT NULL DEFAULT \'\''],
    // Stable identity of a seeded catalogue article (specs/option-categories.md §3 rule 23).
    // `autoOptionType` can't serve here: it's a single-valued behaviour discriminator, while the
    // catering seed owns 14 distinct rows with no engine behaviour. Keying on `seedKey` rather
    // than on the title is what lets the operator rename an article without the next boot
    // inserting a duplicate beside it.
    ['seedKey',                 'TEXT NOT NULL DEFAULT \'\''],
    // Pins an option outside its category's collapse (specs/option-categories.md §3 rule 9bis).
    // Only meaningful inside a category — an ungrouped option is always visible anyway.
    ['alwaysVisible',           'INTEGER NOT NULL DEFAULT 0'],
    // Marks THE cancellation insurance (specs/cancellation-insurance.md §3 rule 11). Exclusive:
    // one option at most carries it. The public API and the website key on this flag, never on a
    // title, so the operator can rename the article without breaking the booking funnel.
    ['isCancellationInsurance', 'INTEGER NOT NULL DEFAULT 0'],
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
  // specs/platforms-and-ical-rework.md §3 rule 6 — the GLOBAL per-platform calendar colour. NULL ⇒
  // fall back to the built-in `KNOWN_PLATFORM_COLORS` default. Authoritative source for the calendar
  // colour endpoint (replaces the per-source `ical_sources.platformColor`, kept for back-compat).
  if (!platformCols.includes('color')) {
    db.exec('ALTER TABLE platforms ADD COLUMN color TEXT');
  }
  // specs/per-platform-tourist-tax-three-way.md — the tourist-tax handling is now GLOBAL per platform
  // (was per-property on `ical_sources`): changing it for a platform applies to every property.
  //   collectsTouristTax           = 1 → the platform charges the guest (tax not billed by us);
  //                                  0 → we charge it at arrival (complément).
  //   touristTaxRemittedByPlatform = 1 → the platform remits it to the commune (we never touch it);
  //                                  0 → WE remit it → the stay shows in the « Taxe de séjour » page.
  // Three valid states: platform (1,1), platform_reversed (1,0), owner (0,0).
  if (!platformCols.includes('collectsTouristTax')) {
    db.exec('ALTER TABLE platforms ADD COLUMN collectsTouristTax INTEGER NOT NULL DEFAULT 1');
  }
  if (!platformCols.includes('touristTaxRemittedByPlatform')) {
    db.exec('ALTER TABLE platforms ADD COLUMN touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1');
    // One-time backfill from the per-property ical_sources flags (the previous source of truth). For
    // each platform, adopt the first non-default per-source mode so an operator who already flipped a
    // source keeps that intent globally. Matched by slug-insensitive name = platformLabel. Idempotent
    // (guarded on the column being freshly added).
    try {
      db.exec(`
        UPDATE platforms SET
          collectsTouristTax = COALESCE((
            SELECT s.collectsTouristTax FROM ical_sources s
            WHERE lower(s.platformLabel) = lower(platforms.name) ORDER BY s.collectsTouristTax ASC LIMIT 1
          ), collectsTouristTax),
          touristTaxRemittedByPlatform = COALESCE((
            SELECT s.touristTaxRemittedByPlatform FROM ical_sources s
            WHERE lower(s.platformLabel) = lower(platforms.name) ORDER BY s.touristTaxRemittedByPlatform ASC LIMIT 1
          ), touristTaxRemittedByPlatform)
      `);
      // Enforce the invariant: collecting-at-arrival always means we remit.
      db.exec('UPDATE platforms SET touristTaxRemittedByPlatform = 0 WHERE collectsTouristTax = 0');
    } catch (e) {
      console.error('[tourist-tax] platforms backfill from ical_sources failed (non-fatal):', e && e.message);
    }
  }
  // specs/platform-deposit-toggle.md — per-platform "takes an acompte?" flag (GLOBAL per platform, like
  // the tourist-tax mode). 0 (default) = no acompte → the engine forces deposit=0 and puts everything in
  // the solde (the legacy behaviour for every platform). 1 = the platform's reservations use the normal
  // acompte/solde split. Idempotent ADD COLUMN; DEFAULT 0 → no behaviour change for existing platforms.
  if (!platformCols.includes('platformTakesDeposit')) {
    db.exec('ALTER TABLE platforms ADD COLUMN platformTakesDeposit INTEGER NOT NULL DEFAULT 0');
  }
  // specs/platform-payout-due-date.md §3.1 rule 6 — how many days after the guest leaves the platform
  // is expected to settle. Drives `balanceDueDate = endDate + payoutDueDays` on every non-direct
  // reservation, and therefore the dashboard's « Virement plateforme en retard » alert. GLOBAL per
  // platform (Airbnb pays within days, Booking invoices at the month's end). DEFAULT 10 is the
  // intended value for every existing row — no backfill, and no reservation row is rewritten.
  if (!platformCols.includes('payoutDueDays')) {
    db.exec('ALTER TABLE platforms ADD COLUMN payoutDueDays INTEGER NOT NULL DEFAULT 10');
  }
}
// specs/platforms-and-ical-rework.md §3 rule 10 — per (property, platform) "hidden from this
// property's reservation views" flag. Independent of `isActive` (sync inclusion); a disabled
// platform's bookings still block dates (availability is unchanged) but are hidden from the
// property calendar/list. Idempotent ADD COLUMN for DBs predating the baseline.
{
  const icalSourceCols = db.prepare('PRAGMA table_info(ical_sources)').all().map((c) => c.name);
  if (!icalSourceCols.includes('disabled')) {
    db.exec('ALTER TABLE ical_sources ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  }
  // specs/platforms-and-ical-rework.md §6 — structured per-category sync counts (JSON) so the "État"
  // cell can render one icon + number per category (created/updated/removed/unchanged/locked/skipped)
  // instead of a free-text message. Written on every successful sync; the message is kept as fallback.
  if (!icalSourceCols.includes('lastSyncCounts')) {
    db.exec('ALTER TABLE ical_sources ADD COLUMN lastSyncCounts TEXT');
  }
  // specs/per-platform-tourist-tax-three-way.md §5 — split the binary `collectsTouristTax` into a
  // three-way handling by adding a "who remits the tax to the commune" flag:
  //   touristTaxRemittedByPlatform = 1 → the platform remits it itself (we never touch it; default,
  //     = legacy `collectsTouristTax = 1` "platform" case).
  //   touristTaxRemittedByPlatform = 0 → WE remit it (the platform reverses it to us, OR we collect
  //     it at arrival) → the reservation shows in Suivi taxe de séjour + the 46710000 accounting line.
  // The DEFAULT 1 + the backfill below make every existing source resolve to its current behaviour
  // (owner-collect rows say "we remit", platform-collect rows stay hidden) until the operator picks
  // the new "reversée à vous" mode.
  if (!icalSourceCols.includes('touristTaxRemittedByPlatform')) {
    db.exec('ALTER TABLE ical_sources ADD COLUMN touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1');
    db.exec('UPDATE ical_sources SET touristTaxRemittedByPlatform = 0 WHERE collectsTouristTax = 0');
  }
  // specs/ical-sync-mapping-resilience.md §5 — consecutive-empty-fetch counter backing the
  // empty-feed guard: a feed that suddenly parses to 0 events while mappings exist is only
  // trusted (→ soft-cancellation sweep) from the 2nd consecutive empty fetch.
  if (!icalSourceCols.includes('emptyFeedStreak')) {
    db.exec('ALTER TABLE ical_sources ADD COLUMN emptyFeedStreak INTEGER NOT NULL DEFAULT 0');
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

// specs/platforms-and-ical-rework.md §5 — one-time backfill of the new GLOBAL `platforms.color`
// from any operator-customised per-source `ical_sources.platformColor` (a colour that differs from
// both the grey default and the platform's built-in brand colour). Only fills rows whose
// `platforms.color` is still NULL, so it never overwrites a colour later chosen via the new palette.
{
  const { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } = require('./constants/platformColors');
  const slug = (v) => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const setColor = db.prepare('UPDATE platforms SET color = ? WHERE id = ? AND color IS NULL');
  const platformRows = db.prepare('SELECT id, name FROM platforms WHERE color IS NULL').all();
  for (const platform of platformRows) {
    const key = slug(platform.name);
    const source = db.prepare(`
      SELECT platformColor FROM ical_sources
       WHERE lower(platformLabel) = lower(?)
         AND platformColor IS NOT NULL AND trim(platformColor) != ''
       ORDER BY updatedAt DESC, id DESC LIMIT 1
    `).get(platform.name);
    const custom = source && String(source.platformColor).trim();
    if (custom && custom.toLowerCase() !== DEFAULT_PLATFORM_COLOR.toLowerCase()
        && custom.toLowerCase() !== String(KNOWN_PLATFORM_COLORS[key] || '').toLowerCase()) {
      setColor.run(custom, platform.id);
    }
  }
}

// specs/platforms-and-ical-rework.md — fold the legacy singular "Gîte de France" (slug `gitedefrance`)
// into the canonical plural "Gîtes de France" ("GitesDeFrance"). Same brand, must show as one. Slug-based
// + idempotent (no-op once merged); safe (relabels, drops only empty-URL placeholder duplicates).
try {
  const { mergePlatformDuplicates } = require('./utils/platformMerge');
  mergePlatformDuplicates(db, { slugs: ['gitedefrance', 'gitesdefrance'], targetName: 'GitesDeFrance' });
} catch (e) {
  console.error('[platform-merge] Gîtes-de-France fold failed (non-fatal):', e && e.message);
}

// Global commission settings (default account + commission VAT rate). The VAT rate lives in
// Settings → Général → Taux de TVA alongside the existing vatRate (per spec §3.7 rule 17b).
tryAddAppSettingsCol('defaultCommissionAccountNumber', "ALTER TABLE app_settings ADD COLUMN defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600'");
tryAddAppSettingsCol('vatRateCommission',              "ALTER TABLE app_settings ADD COLUMN vatRateCommission REAL NOT NULL DEFAULT 20");

// Cancellation compensation — the money a platform pays back when a guest cancels outside the
// free-cancellation window (specs/cancellation-compensation.md §5). Credited to a « produits divers »
// account with no VAT by default: a sum kept after a désistement is an indemnity, outside the scope
// of VAT (CJUE Société thermale d'Eugénie-les-Bains, C-277/05). Both are settings so the accountant
// can overrule the default without a code change — the journal entry is built at read time.
tryAddAppSettingsCol('cancellationCompensationAccount', "ALTER TABLE app_settings ADD COLUMN cancellationCompensationAccount TEXT NOT NULL DEFAULT '75880000'");
tryAddAppSettingsCol('vatRateCancellationCompensation', "ALTER TABLE app_settings ADD COLUMN vatRateCancellationCompensation REAL NOT NULL DEFAULT 0");

// specs/cancellation-compensation.md §5 — one row per compensation a platform owes (or has paid) us
// for a cancelled stay. Standalone by design: approving an iCal cancellation DELETES the reservation,
// so the row carries a frozen snapshot (property name, platform, client name, stay dates, lost stay
// amount) instead of foreign keys — `reservationId` / `propertyId` are informational and deliberately
// NOT declared as FKs, since the reservation is gone by the time the row is committed.
// `status` walks 'pending' (editable, invisible to accounting) → 'received' (frozen, booked at
// `receivedDate`). Additive table, starts empty, no backfill.
db.exec(`
  CREATE TABLE IF NOT EXISTS cancellation_compensations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cancellationAlertId INTEGER UNIQUE,
    reservationId       INTEGER,
    propertyId          INTEGER,
    propertyName        TEXT    NOT NULL DEFAULT '',
    platform            TEXT    NOT NULL DEFAULT '',
    clientFirstName     TEXT    NOT NULL DEFAULT '',
    clientLastName      TEXT    NOT NULL DEFAULT '',
    startDate           TEXT,
    endDate             TEXT,
    cancelledStayAmount REAL,
    expectedAmount      REAL    NOT NULL DEFAULT 0,
    expectedDate        TEXT,
    receivedAmount      REAL,
    receivedDate        TEXT,
    status              TEXT    NOT NULL DEFAULT 'pending',
    notes               TEXT    NOT NULL DEFAULT '',
    createdAt           TEXT    NOT NULL DEFAULT (datetime('now')),
    updatedAt           TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_cancellation_comp_status ON cancellation_compensations (status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cancellation_comp_received ON cancellation_compensations (receivedDate)');

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

// ---------- PAYMENT SCHEDULE & CANCELLATION ----------
// specs/payment-schedule-and-cancellation.md §5. The acompte stops being derived from the arrival
// date (`depositDaysBefore`) and becomes due `depositDueDays` after the BOOKING; the solde moves to
// 30 days before arrival; an unpaid solde may cost the stay `cancelAfterBalanceDueDays` later.
// Reservations gain a cancellation state — `kind` walks 'reservation' → 'cancelled', which removes
// the row from every operational read at once (they all filter kind = 'reservation') while keeping
// its booked encaissements visible to accounting.
{
  const propCols = db.prepare('PRAGMA table_info(properties)').all().map((c) => c.name);
  const tryAddProp = (col, sql) => { if (!propCols.includes(col)) db.exec(sql); };
  tryAddProp('depositDueDays', 'ALTER TABLE properties ADD COLUMN depositDueDays INTEGER NOT NULL DEFAULT 7');
  tryAddProp('cancelAfterBalanceDueDays', 'ALTER TABLE properties ADD COLUMN cancelAfterBalanceDueDays INTEGER NOT NULL DEFAULT 7');

  const resCols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  const tryAddRes = (col, sql) => { if (!resCols.includes(col)) db.exec(sql); };
  tryAddRes('cancelledAt', 'ALTER TABLE reservations ADD COLUMN cancelledAt TEXT');
  tryAddRes('cancellationReason', 'ALTER TABLE reservations ADD COLUMN cancellationReason TEXT');
  tryAddRes('cancelledBy', 'ALTER TABLE reservations ADD COLUMN cancelledBy INTEGER');
  tryAddRes('paymentAlertSnoozedUntil', 'ALTER TABLE reservations ADD COLUMN paymentAlertSnoozedUntil TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_reservations_cancelled ON reservations(cancelledAt)');

  const compCols = db.prepare('PRAGMA table_info(cancellation_compensations)').all().map((c) => c.name);
  if (!compCols.includes('origin')) {
    db.exec("ALTER TABLE cancellation_compensations ADD COLUMN origin TEXT NOT NULL DEFAULT 'platform'");
  }

  if (process.env.SKIP_MIGRATIONS !== 'true') {
    // One-shot: raise the solde deadline to the new 30-day policy. Guarded by `migrations` so an
    // operator who later chooses another value is never overwritten at the next boot.
    const balanceMigration = 'balance_days_before_30_v1';
    if (!db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(balanceMigration)) {
      const changed = db.prepare('UPDATE properties SET balanceDaysBefore = 30 WHERE balanceDaysBefore IS NULL OR balanceDaysBefore < 30').run().changes;
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(balanceMigration);
      if (changed > 0) console.log(`[migration:balance-days-before-30] updated ${changed} property/properties`);
    }
    // `depositDaysBefore` has no reader left (the acompte is anchored on the booking date now).
    // Dropped inside a try/catch: an older SQLite without ALTER TABLE DROP COLUMN simply keeps a
    // dead column, which nothing reads.
    if (propCols.includes('depositDaysBefore')) {
      try { db.exec('ALTER TABLE properties DROP COLUMN depositDaysBefore'); }
      catch (err) { console.warn('[migration:deposit-days-before] column left in place:', err.message); }
    }
  }
}

// ---------- SAS ARRIVAL UPSELLS → CATALOGUE OPTION ----------
// specs/sas-upsells-activate-catalogue-option.md §5. The arrival SAS used to write « Ménage » and
// « Linge de toilette » as CUSTOM lines, which the laundry + linen-stock aggregators (they join
// `reservation_options → options WHERE countsAsBathroomLinen = 1`) never see. They now activate the
// catalogue option instead, tagged `sasArrivalOrigin` so the SAS may remove what it added — and only
// what it added (an option sold from the fiche is never touched).
{
  const roCols = db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name);
  if (!roCols.includes('sasArrivalOrigin')) {
    db.exec('ALTER TABLE reservation_options ADD COLUMN sasArrivalOrigin INTEGER NOT NULL DEFAULT 0');
  }
  // How many people a per-person card option actually serves on each of its moments
  // (specs/card-option-served-persons.md §5). NULL = the whole party, which is what every line
  // written before this column means — hence no default and no backfill.
  if (!roCols.includes('cardPersons')) {
    db.exec('ALTER TABLE reservation_options ADD COLUMN cardPersons REAL');
  }
}
// One-shot data migration: move the existing SAS-origin custom lines onto their catalogue option, at
// the SAME amount (a past stay is never re-quoted). A reservation already carrying the option is
// skipped — deleting its custom line would silently lower what the guest owes — and logged for review.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'sas_upsell_custom_to_option_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runSasUpsellOptionMigration } = require('./utils/sasUpsellOptionMigration');
    const tx = db.transaction(() => {
      const { migrated, skipped } = runSasUpsellOptionMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      if (migrated > 0 || skipped.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[migration:sas-upsell-custom-to-option] moved ${migrated} line(s) onto their catalogue option`
          + (skipped.length > 0 ? `; skipped (option already present, review by hand): ${skipped.join(', ')}` : ''));
      }
    });
    tx();
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

// Durable platform de-duplication by canonical name — runs on EVERY boot (idempotent), unlike the
// one-shot above. Heals case-duplicate rows (e.g. « Lodgify » + « lodgify ») that the seeding can
// re-introduce after the one-shot ran, which otherwise break the per-platform tourist-tax write/read
// (the write hits one row, the read another). Merges operator-customised settings into the survivor.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  try {
    const { runPlatformSlugDedup } = require('./utils/platformSlugDedupMigration');
    const tx = db.transaction(() => runPlatformSlugDedup(db));
    const { mergedCount, renamedCount } = tx();
    if (mergedCount || renamedCount) {
      // eslint-disable-next-line no-console
      console.log(`[platform-slug-dedup] merged ${mergedCount} duplicate(s), renamed ${renamedCount} row(s)`);
    }
  } catch (e) {
    console.error('[platform-slug-dedup] failed (non-fatal):', e && e.message);
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

// ---------- ZERO THE TOTAL OF OFFERED RESOURCE LINES ----------
// specs/devis-offered-resource-parity.md §3 rule 5. `insertResourceLine` used to re-bill an offered
// resource at its catalogue price (`rr.totalPrice || unitPrice * qty` swallowed the engine's
// legitimate 0), so every offered resource line was persisted WITH its price: the devis PDF printed it
// unmarked and deducted it from the accommodation row. From this boot onwards the model stores 0; the
// rows already written are repaired here. Idempotent via
// `migrations.offered_resource_totals_zeroed_v1`.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'offered_resource_totals_zeroed_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runOfferedResourceTotalRepair } = require('./utils/offeredResourceTotalRepair');
    const tx = db.transaction(() => {
      const { repairedCount } = runOfferedResourceTotalRepair(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      // eslint-disable-next-line no-console
      console.log(`[migration:offered-resource-totals-zeroed] repaired ${repairedCount} offered resource line(s)`);
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

const { ensureDefaultBathMatOption } = require('./utils/bathMatSeed');
ensureDefaultBathMatOption(db);
db.ensureDefaultBathMatOption = ensureDefaultBathMatOption;

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

// specs/option-categories.md §5.2 — the « Boissons » + « Restauration » catalogue. Same structural
// contract as the linen/breakfast seeds above, keyed by `options.seedKey` because the family is 14
// rows rather than a singleton.
const { ensureCateringOptions } = require('./utils/cateringSeed');
ensureCateringOptions(db);
db.ensureCateringOptions = ensureCateringOptions;

// specs/cancellation-insurance.md §3.2 — the « Assurance annulation » article, seeded « par nuit »
// and unpriced (0 €) so it stays invisible to guests until Adrien sets its tariff. Same structural
// contract as the catering seed: keyed by `seedKey`, linked to every property on each boot.
const { ensureCancellationInsuranceOption } = require('./utils/cancellationInsuranceSeed');
ensureCancellationInsuranceOption(db);
db.ensureCancellationInsuranceOption = ensureCancellationInsuranceOption;

// specs/baby-bed-supplement.md §5 — the « Lit bébé » supplement (5 € per cot, for the stay). Same
// structural contract: keyed by `seedKey`, linked to every property on each boot. Engine-managed
// (`autoOptionType = 'baby_bed'`), so it is derived from the reservation's cot count, never ticked.
const { ensureBabyBedSupplementOption } = require('./utils/babyBedSupplementSeed');
ensureBabyBedSupplementOption(db);
db.ensureBabyBedSupplementOption = ensureBabyBedSupplementOption;

// One-shot migration (specs/option-categories.md §5.3): file the options that pre-date the category
// column into their group. The 5 « Animation… » rows and « Le repas des trappeurs » were created by
// hand, so they carry no seedKey and the catering seed above will never touch them — this backfill
// is the only thing that categorises them. Untouched afterwards: the operator owns the label.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'option_categories_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  const optCols = db.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
  if (!ran && optCols.includes('category')) {
    const { runOptionCategoriesMigration } = require('./utils/optionCategoriesMigration');
    const { animations, meals } = runOptionCategoriesMigration(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
    if (animations > 0 || meals > 0) {
      // eslint-disable-next-line no-console
      console.log(`[migration:option-categories] categorised ${animations} animation(s) + ${meals} meal(s)`);
    }
  }
}

// One-shot follow-up (specs/option-categories.md §5.3bis): the breakfast option joins
// « Restauration » but stays pinned outside the collapse. Separate flag from
// `option_categories_v1` because that one has already run on the dev database.
if (process.env.SKIP_MIGRATIONS !== 'true') {
  const migrationName = 'option_breakfast_restauration_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  const optCols = db.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
  if (!ran && optCols.includes('alwaysVisible')) {
    const { runBreakfastCategoryMigration } = require('./utils/optionCategoriesMigration');
    const { moved } = runBreakfastCategoryMigration(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
    if (moved > 0) {
      // eslint-disable-next-line no-console
      console.log(`[migration:breakfast-restauration] moved ${moved} breakfast option(s) into Restauration (pinned)`);
    }
  }
}

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
  // Scheduling anchor for listPending (specs/online-payments-qonto.md §3.8): 'start' = legacy
  // startDate+dayOffset; 'validUntil' = devis validity date (deposit reminder). Existing rows → 'start'.
  if (!etCols.includes('anchor'))    db.exec("ALTER TABLE email_templates ADD COLUMN anchor TEXT NOT NULL DEFAULT 'start'");
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
// personalised — so this is a one-shot FORCE-sync of name/subject/body (+ subjectEn/bodyEn) / dayOffset
// to the registry def (sendMode + enabled are preserved). Runs once per version tag, AFTER the exact-match
// chain above so it has the final say; guarded by the `migrations` table so a later operator edit is never
// clobbered again. specs/j2-email-coffee-and-sas-complement.md — bumped to `_v2` to re-propagate the new
// coffee/capsule line + the now-synced English side to already-seeded rows.
// specs/payment-schedule-and-cancellation.md §3.7 rule 37 — the acompte reminder changes SCHEDULING
// ANCHOR (devis validity → the reservation's own acompte deadline). The seed is insert-only, so an
// already-seeded row would keep firing off `validUntil` — NULL on a reservation, i.e. never again.
// One-shot force-sync of the contract + the copy; `enabled` is preserved.
{
  const migrationName = 'deposit_reminder_anchor_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runDepositReminderAnchorMigration } = require('./utils/migrateDepositReminderAnchor');
    const tx = db.transaction(() => {
      const { action } = runDepositReminderAnchorMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      console.log(`[migration:deposit-reminder-anchor] ${action}`);
    });
    tx();
  }
}

// specs/payment-schedule-and-cancellation.md rule 45 — the seeded dunning rows still carry
// `sendMode = 'auto'` and would keep mailing guests after deploy. Force them to `manual`; nothing else
// on the row is touched.
{
  const migrationName = 'payment_templates_manual_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { runPaymentTemplatesToManualMigration } = require('./utils/migratePaymentTemplatesToManual');
    const tx = db.transaction(() => {
      const { action, changed } = runPaymentTemplatesToManualMigration(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
      console.log(`[migration:payment-templates-manual] ${action} (${changed})`);
    });
    tx();
  }
}

{
  const migrationName = 'arrival_reminder_j2_overwrite_v2';
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
  // « En fin de séjour » on the arrival recap (specs/defer-arrival-complement-to-checkout.md §3.2
  // rule 5): the arrival complement is not collected at check-in but at the door, together with the
  // end-of-stay complement — presented as ONE complement everywhere. Backfilled once, on creation,
  // for the stays the departure recall already treats as deferred (arrival SAS done, complement
  // still to collect). Display/collection only: no amount is moved or recomputed.
  if (!rcols.includes('complementDeferredToCheckout')) {
    db.exec("ALTER TABLE reservations ADD COLUMN complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0");
    db.exec(`UPDATE reservations SET complementDeferredToCheckout = 1
             WHERE arrivalSasDoneAt IS NOT NULL
               AND COALESCE(complementAmount, 0) > 0
               AND COALESCE(complementPaid, 0) = 0`);
  }
  // Extras as they stood when the STAY STARTED (specs/mid-stay-extras-to-end-of-stay-complement.md
  // §3.1): JSON `{ "opt:9": 24, "res:3": 30, "custom:linge manquant": 18 }`. Whatever exceeds this
  // baseline was sold during the stay and is billed in the end-of-stay complement instead of the
  // (frozen) arrival buckets. NULL until the stay starts — existing rows are never requalified.
  if (!rcols.includes('arrivalExtrasBaseline')) db.exec("ALTER TABLE reservations ADD COLUMN arrivalExtrasBaseline TEXT DEFAULT NULL");
  // « Notes en séjour » (specs/mid-stay-notes.md §3.1): history of what was actually COLLECTED during
  // the stay — JSON array of `{ id, paidDate, paidCash, total, lines[] }`. A note exists only once
  // settled; a sale left for check-out simply stays in the end-of-stay remainder. NULL = no note yet.
  if (!rcols.includes('midStaySettledNotes')) db.exec("ALTER TABLE reservations ADD COLUMN midStaySettledNotes TEXT DEFAULT NULL");
  // Tourist-tax declaration marker (specs/tourist-tax-declared-checkbox.md): set to the server time-stamp
  // when the operator ticks « Déclarée » on the extraction page, NULL = not yet declared.
  if (!rcols.includes('touristTaxDeclaredAt')) db.exec("ALTER TABLE reservations ADD COLUMN touristTaxDeclaredAt TEXT");
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
  // 2026-07-18 — milk drink + food counters (specs/sas-breakfast-milk-and-food.md): a 4th hot-drink
  // count and the number of pastries / cereal bowls to put on the tray.
  if (!rcols.includes('breakfastMilk')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastMilk INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastPastries')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastPastries INTEGER NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastCereals')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastCereals INTEGER NOT NULL DEFAULT 0");
  // 2026-07-19 — bread in half-baguette steps + serving-time push guard (last notified day)
  // (specs/sas-breakfast-bread-and-push.md rules 2 & 8).
  if (!rcols.includes('breakfastBread')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastBread REAL NOT NULL DEFAULT 0");
  if (!rcols.includes('breakfastNotifiedDate')) db.exec("ALTER TABLE reservations ADD COLUMN breakfastNotifiedDate TEXT");
  // Handover note authored at the end of the arrival SAS, shown read-only in the departure SAS and on
  // the departure planning card. Dedicated column — kept separate from reservations.notes.
  if (!rcols.includes('departureHandoverNote')) db.exec("ALTER TABLE reservations ADD COLUMN departureHandoverNote TEXT");
  // Per-event push-notification guards (specs/pwa-push-notifications.md §3.3): the local date on which
  // the arrival (resp. departure) push was sent for this reservation, so it fires once.
  if (!rcols.includes('arrivalNotifiedAt')) db.exec("ALTER TABLE reservations ADD COLUMN arrivalNotifiedAt TEXT");
  if (!rcols.includes('departureNotifiedAt')) db.exec("ALTER TABLE reservations ADD COLUMN departureNotifiedAt TEXT");
  // specs/platform-commission-line.md — operator-entered platform commission (€, TTC). Drives the
  // « total séjour − commission = net perçu » block on the fiche. NULL/0 on direct bookings. Distinct
  // from the accounting commission, which is still derived from `clientGrossAmount` (gross − net).
  if (!rcols.includes('platformCommissionAmount')) db.exec('ALTER TABLE reservations ADD COLUMN platformCommissionAmount REAL');
  // specs/platform-per-echeance-commission.md — the platform commission on the ACOMPTE (€, TTC). The
  // existing `platformCommissionAmount` now means the SOLDE commission; this one books on the deposit
  // entry. NULL/0 on direct / no-acompte. Idempotent ADD COLUMN.
  if (!rcols.includes('acompteCommissionAmount')) db.exec('ALTER TABLE reservations ADD COLUMN acompteCommissionAmount REAL');
  // specs/platform-payment-entry.md — platform-payment block: `platformGrossAmount` (the brut the guest
  // paid, pins the total séjour) + `platformPayoutAmount` (the bank transfer received, reconciliation
  // only). Both NULL on direct / unused.
  if (!rcols.includes('platformGrossAmount')) db.exec('ALTER TABLE reservations ADD COLUMN platformGrossAmount REAL');
  if (!rcols.includes('platformPayoutAmount')) db.exec('ALTER TABLE reservations ADD COLUMN platformPayoutAmount REAL');
  // specs/public-online-payment.md §5 — set when a paid online full-payment was converted onto dates that
  // had become unavailable (the devis never blocked them). Drives the admin notification + the conflict
  // chip; NULL on every normal booking. Idempotent ADD COLUMN.
  if (!rcols.includes('bookingConflictAt')) db.exec('ALTER TABLE reservations ADD COLUMN bookingConflictAt TEXT');
  // specs/public-online-payment.md §7 — unguessable capability token minted per public devis. Required
  // (constant-time compared) on the public /pay and /status routes so the sequential row id alone can't
  // be enumerated to read another booking's recap or mint its payment link. NULL on non-public rows.
  if (!rcols.includes('publicToken')) db.exec('ALTER TABLE reservations ADD COLUMN publicToken TEXT');
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
// Breakfast serving-time push preference (specs/sas-breakfast-bread-and-push.md rule 6). Default ON,
// like the other channels.
{
  const pcols = db.prepare('PRAGMA table_info(user_push_prefs)').all().map((c) => c.name);
  if (!pcols.includes('breakfast')) db.exec('ALTER TABLE user_push_prefs ADD COLUMN breakfast INTEGER NOT NULL DEFAULT 1');
}
// Domain gate/access code shown on the arrival SAS (global — one code for the whole domain).
{
  const scols = db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
  if (!scols.includes('portalCode')) db.exec("ALTER TABLE app_settings ADD COLUMN portalCode TEXT DEFAULT ''");
  // Météo-France Vigilance API key (specs/checkin-weather-alerts.md §5). Operator-configured secret,
  // AES-256-GCM encrypted at rest (settingsModel.ENCRYPTED_COLUMNS). Empty → the weather-alert feature
  // is inert (no page, no error).
  if (!scols.includes('meteoFranceApiKeyEncrypted')) db.exec("ALTER TABLE app_settings ADD COLUMN meteoFranceApiKeyEncrypted TEXT DEFAULT ''");
}

// Weather vigilance cache (specs/checkin-weather-alerts.md §5). One row per département: the normalized
// phenomena payload (JSON) + the fetch timestamp, so opening several check-ins in a row reuses a fresh
// cache instead of hammering the Météo-France API. Survives restarts (durable, unlike an in-memory cache).
db.exec(`
  CREATE TABLE IF NOT EXISTS weather_vigilance_cache (
    departmentCode TEXT PRIMARY KEY,
    payload        TEXT NOT NULL,
    fetchedAt      TEXT NOT NULL
  );
`);

// Data repair (specs/sas-bath-linen-ghost-line.md §3 rule 3): erase the billing lines the removed
// « linge de toilette réglé en fin de séjour » flow left in the end-of-stay complement. Naturally
// idempotent (a filter — once dropped, nothing matches), so it needs no `migrations` guard and keeps
// covering any row restored from an old backup.
{
  const { repairBathLinenGhosts } = require('./utils/complementDataRepairs');
  const repaired = repairBathLinenGhosts(db);
  if (repaired.length > 0) {
    console.log(`[migration:bath-linen-ghost] dropped the ghost line on reservation(s) ${repaired.join(', ')}`);
  }
}

// Data repair (specs/frozen-complement-trusts-client.md §3 rule 3): a collected arrival complement
// that absorbed a later mid-stay sale is reduced by the part the end-of-stay complement already bills.
// ONE-SHOT — guarded by the `migrations` table: the correction subtracts, so re-running it would keep
// eating into the amount. The write-path fix (reservationsController.update) is what prevents new ones.
{
  const migrationName = 'frozen_complement_midstay_repair_v1';
  const ran = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(migrationName);
  if (!ran) {
    const { repairFrozenComplements } = require('./utils/complementDataRepairs');
    const repaired = repairFrozenComplements(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
    if (repaired.length > 0) {
      console.log(`[migration:frozen-complement] corrected the collected complement on reservation(s) ${repaired.join(', ')}`);
    }
  }
}

// ---------- REJEU DU BASELINE ----------
// Voir la note en tete de fichier : quand la premiere passe de schema.sql s'est interrompue sur
// une base existante, les migrations gardees ci-dessus ont depuis ajoute les colonnes
// manquantes, donc rejouer le baseline cree maintenant ce qu'il n'avait pas pu creer. Chaque
// instruction etant `IF NOT EXISTS`, c'est un no-op dans le cas nominal. Un echec ici est un
// vrai probleme de schema : on le laisse remonter plutot que de demarrer le serveur sur une
// base a moitie migree.
if (baselineDeferredError) {
  db.exec(SCHEMA_SQL);
  console.log('[schema] baseline rejoue avec succes apres les migrations gardees.');
}

// ---------- DB HYGIENE — Bloc 0 ----------
// See specs/db-hygiene-quick-wins.md and utils/dbHygiene.js for the contract.
require('./utils/dbHygiene').applyHygiene(db);

module.exports = db;
