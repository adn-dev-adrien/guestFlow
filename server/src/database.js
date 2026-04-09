const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH env var lets CI/CD point to a persistent location outside the deployment folder.
// Falls back to the traditional location so existing dev setups are unaffected.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'guestflow.db');
const db = new Database(dbPath);

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
    phoneNumbers TEXT DEFAULT '[]',
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
    photo TEXT DEFAULT '',
    maxAdults INTEGER DEFAULT 2,
    maxChildren INTEGER DEFAULT 0,
    maxBabies INTEGER DEFAULT 0,
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
    autoOptionType TEXT,
    autoEnabled INTEGER NOT NULL DEFAULT 0,
    autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
    autoFullNightThreshold TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

// priceType: per_stay, per_person, per_night, per_person_per_night, per_hour

db.exec(`
  CREATE TABLE IF NOT EXISTS property_options (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
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
    totalPrice REAL NOT NULL DEFAULT 0,
    discountPercent REAL DEFAULT 0,
    finalPrice REAL NOT NULL DEFAULT 0,
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
    PRIMARY KEY (reservationId, optionId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
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
    propertyIds TEXT,
    note TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_resources (
    reservationId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (reservationId, resourceId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
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
    lastSeenAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (sourceId, eventUid),
    FOREIGN KEY (sourceId) REFERENCES ical_sources(id) ON DELETE CASCADE,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  )
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
if (!clientCols.includes('phoneNumbers')) {
  db.exec("ALTER TABLE clients ADD COLUMN phoneNumbers TEXT DEFAULT '[]'");
}

const resourceCols = db.prepare("PRAGMA table_info(resources)").all().map(c => c.name);
if (resourceCols.length > 0 && !resourceCols.includes('updatedAt')) {
  db.exec("ALTER TABLE resources ADD COLUMN updatedAt TEXT DEFAULT (datetime('now'))");
}
if (resourceCols.length > 0 && !resourceCols.includes('priceType')) {
  db.exec("ALTER TABLE resources ADD COLUMN priceType TEXT NOT NULL DEFAULT 'per_stay'");
}
if (resourceCols.length > 0 && !resourceCols.includes('propertyIds')) {
  db.exec("ALTER TABLE resources ADD COLUMN propertyIds TEXT");
}

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

const reservationResourceCols = db.prepare("PRAGMA table_info(reservation_resources)").all().map(c => c.name);
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('billedUnits')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN billedUnits REAL NOT NULL DEFAULT 0");
}
if (reservationResourceCols.length > 0 && !reservationResourceCols.includes('priceType')) {
  db.exec("ALTER TABLE reservation_resources ADD COLUMN priceType TEXT NOT NULL DEFAULT 'per_stay'");
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

// Seed default resource: baby bed (global)
const babyBed = db.prepare("SELECT id FROM resources WHERE lower(name) = lower('Lit bébé') AND propertyId IS NULL").get();
if (!babyBed) {
  db.prepare('INSERT INTO resources (name, quantity, price, propertyId, note) VALUES (?, ?, ?, ?, ?)')
    .run('Lit bébé', 1, 0, null, 'Ressource par défaut');
}

// Migration: Add missing columns to options table if they don't exist
function migrateOptionsColumns() {
  try {
    // Get existing columns using PRAGMA
    const columns = db.prepare('PRAGMA table_info(options)').all();
    const columnNames = columns.map(col => col.name);
    
    console.log('[Migration] Options table columns:', columnNames);
    
    const needed = ['autoOptionType', 'autoEnabled', 'autoPricingMode', 'autoFullNightThreshold'];
    const missing = needed.filter(col => !columnNames.includes(col));
    
    if (missing.length > 0) {
      console.log('[Migration] Adding missing columns to options table:', missing);
      
      // Add missing columns one by one with individual error handling
      if (!columnNames.includes('autoOptionType')) {
        try {
          db.exec('ALTER TABLE options ADD COLUMN autoOptionType TEXT');
          console.log('[Migration] ✅ Added autoOptionType column');
        } catch (e) {
          console.log('[Migration] Column autoOptionType might already exist:', e.message);
        }
      }
      
      if (!columnNames.includes('autoEnabled')) {
        try {
          db.exec('ALTER TABLE options ADD COLUMN autoEnabled INTEGER NOT NULL DEFAULT 0');
          console.log('[Migration] ✅ Added autoEnabled column');
        } catch (e) {
          console.log('[Migration] Column autoEnabled might already exist:', e.message);
        }
      }
      
      if (!columnNames.includes('autoPricingMode')) {
        try {
          db.exec('ALTER TABLE options ADD COLUMN autoPricingMode TEXT NOT NULL DEFAULT \'fixed\'');
          console.log('[Migration] ✅ Added autoPricingMode column');
        } catch (e) {
          console.log('[Migration] Column autoPricingMode might already exist:', e.message);
        }
      }
      
      if (!columnNames.includes('autoFullNightThreshold')) {
        try {
          db.exec('ALTER TABLE options ADD COLUMN autoFullNightThreshold TEXT');
          console.log('[Migration] ✅ Added autoFullNightThreshold column');
        } catch (e) {
          console.log('[Migration] Column autoFullNightThreshold might already exist:', e.message);
        }
      }
      
      // Verify migration
      const columnsAfter = db.prepare('PRAGMA table_info(options)').all();
      const columnNamesAfter = columnsAfter.map(col => col.name);
      console.log('[Migration] Options table columns after migration:', columnNamesAfter);
    } else {
      console.log('[Migration] All required columns already exist in options table');
    }
  } catch (err) {
    console.error('[Migration] Error during migration:', err.message);
    throw err;
  }
}

console.log('[Migration] Running options table migration...');
migrateOptionsColumns();
console.log('[Migration] Options table migration completed');

function ensureDefaultTimedOptionsForProperty(propertyId) {
  // Safety check: ensure required columns exist before proceeding
  try {
    const columns = db.prepare('PRAGMA table_info(options)').all();
    const columnNames = columns.map(col => col.name);
    const required = ['autoOptionType', 'autoEnabled', 'autoPricingMode', 'autoFullNightThreshold'];
    const allExist = required.every(col => columnNames.includes(col));
    
    if (!allExist) {
      console.warn('[ensureDefaultTimedOptionsForProperty] Required columns missing, skipping initialization');
      return;
    }
  } catch (err) {
    console.warn('[ensureDefaultTimedOptionsForProperty] Could not verify columns:', err.message, ', skipping initialization');
    return;
  }
  
  const upsertTimedOption = (config) => {
    const existing = db.prepare(`
      SELECT o.id
      FROM options o
      JOIN property_options po ON po.optionId = o.id
      WHERE po.propertyId = ? AND o.autoOptionType = ?
      LIMIT 1
    `).get(propertyId, config.autoOptionType);

    if (existing) {
      // Update existing option, but only non-empty fields
      db.prepare(`
        UPDATE options
        SET title = COALESCE(NULLIF(title, ''), ?),
            description = COALESCE(NULLIF(description, ''), ?),
            autoPricingMode = COALESCE(NULLIF(autoPricingMode, ''), 'fixed'),
            autoFullNightThreshold = COALESCE(NULLIF(autoFullNightThreshold, ''), ?)
        WHERE id = ?
      `).run(config.title, config.description, config.autoFullNightThreshold, existing.id);
      return;
    }

    const result = db.prepare(`
      INSERT INTO options (title, description, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
      VALUES (?, ?, 'per_stay', 0, ?, 0, 'fixed', ?)
    `).run(config.title, config.description, config.autoOptionType, config.autoFullNightThreshold);

    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, result.lastInsertRowid);
  };

  upsertTimedOption({
    autoOptionType: 'early_check_in',
    title: 'Arrivée anticipée',
    description: 'Option automatique si arrivée avant l\'heure par défaut',
    autoFullNightThreshold: '10:00',
  });

  upsertTimedOption({
    autoOptionType: 'late_check_out',
    title: 'Départ tardif',
    description: 'Option automatique si départ après l\'heure par défaut',
    autoFullNightThreshold: '17:00',
  });
}

// Safely ensure default timed options for existing properties
try {
  const allProperties = db.prepare('SELECT id FROM properties').all();
  allProperties.forEach((property) => {
    try {
      ensureDefaultTimedOptionsForProperty(property.id);
    } catch (err) {
      console.error(`[Warning] Failed to ensure default timed options for property ${property.id}:`, err.message);
    }
  });
  console.log('[Database] Default timed options ensured for all properties');
} catch (err) {
  console.error('[Warning] Failed to ensure default timed options:', err.message);
}

db.ensureDefaultTimedOptionsForProperty = ensureDefaultTimedOptionsForProperty;

module.exports = db;
