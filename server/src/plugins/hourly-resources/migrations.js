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
function resetHourlyColumns(db) {
  if (!hasTable(db, 'resources')) return;
  const columns = new Set(db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name));
  const sets = [
    ['isComplex', '0'], ['showsPlanningCard', '0'], ['hourlyEveningStart', 'NULL'], ['hourlyEveningRate', '0'],
    ['hourlyExternalDayRate', '0'], ['hourlyExternalEveningRate', '0'], ['heatUpMinutes', '0'],
    ['heatRetentionMinutes', '0'], ['turnoverMinutes', '0'],
  ].filter(([column]) => columns.has(column)).map(([column, value]) => `${column} = ${value}`);
  if (sets.length > 0) db.exec(`UPDATE resources SET ${sets.join(', ')}`);
}

const MIGRATIONS = [
  { name: 'tables_v1', up: createTables },
  { name: 'tag_evening_supplements_v1', up: tagEveningSupplements },
];

module.exports = { MIGRATIONS, createTables, tagEveningSupplements, resetHourlyColumns, hasTable, SUPPLEMENT_SUFFIX };
