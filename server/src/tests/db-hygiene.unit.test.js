const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyHygiene, FK_INDEXES, UNIQUE_INDEXES } = require('../utils/dbHygiene');

// Minimal DDL — only the tables touched by the hygiene pass need to exist.
// Mirrors the columns/types from server/src/database.js so unique constraints
// + drop column behave identically against an in-memory DB.
const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT);

  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER);
  CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER);

  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    clientId INTEGER,
    startDate TEXT,
    endDate TEXT,
    sourceIcalSourceId INTEGER,
    sourceIcalEventUid TEXT
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER);
  CREATE TABLE reservation_custom_options (reservationId INTEGER);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE reservation_nights (reservationId INTEGER);
  CREATE TABLE reservation_history (reservationId INTEGER);

  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    quantity INTEGER,
    propertyId INTEGER,
    propertyIds TEXT
  );

  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resourceId INTEGER,
    reservationId INTEGER,
    propertyId INTEGER,
    date TEXT,
    startTime TEXT,
    endTime TEXT
  );

  CREATE TABLE devis (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER, status TEXT);
  CREATE TABLE devis_options (devisId INTEGER, optionId INTEGER);
  CREATE TABLE devis_custom_options (devisId INTEGER);
  CREATE TABLE devis_resources (devisId INTEGER, resourceId INTEGER);
  CREATE TABLE devis_nights (devisId INTEGER);
  CREATE TABLE devis_history (devisId INTEGER);

  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    platformKey TEXT
  );
  CREATE TABLE ical_import_events (
    sourceId INTEGER,
    eventUid TEXT,
    reservationId INTEGER
  );
  CREATE TABLE ical_tokens (propertyId INTEGER, token TEXT);
  CREATE TABLE calendar_notes (propertyId INTEGER, date TEXT);

  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId INTEGER,
    label TEXT,
    startDate TEXT,
    endDate TEXT
  );

  CREATE TABLE school_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    externalRef TEXT
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

function silentLogger() {
  return {
    warnings: [],
    logs: [],
    warn(...args) { this.warnings.push(args.join(' ')); },
    log(...args) { this.logs.push(args.join(' ')); },
  };
}

function indexNames(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().map((r) => r.name);
}

// ---------- FK indexes ----------

test('applyHygiene: creates every declared FK index', () => {
  const db = freshDb();
  const logger = silentLogger();
  applyHygiene(db, { logger });

  for (const [name, table] of FK_INDEXES) {
    const names = indexNames(db, table);
    assert.ok(names.includes(name), `expected index ${name} on ${table}; got ${names.join(', ')}`);
  }
});

test('applyHygiene: idempotent (running twice does not throw)', () => {
  const db = freshDb();
  const logger = silentLogger();
  applyHygiene(db, { logger });
  applyHygiene(db, { logger });
  // Sample check.
  assert.ok(indexNames(db, 'reservations').includes('idx_reservations_propertyId'));
});

// ---------- UNIQUE indexes ----------

test('applyHygiene: uniq_resource_bookings_slot rejects duplicates after creation', () => {
  const db = freshDb();
  applyHygiene(db, { logger: silentLogger() });
  const ins = db.prepare('INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, ?, ?, ?)');
  ins.run(1, '2026-06-01', '10:00', '12:00');
  assert.throws(
    () => ins.run(1, '2026-06-01', '10:00', '12:00'),
    /UNIQUE constraint failed/
  );
});

test('applyHygiene: uniq_ical_sources_property_platform rejects duplicates after creation', () => {
  const db = freshDb();
  applyHygiene(db, { logger: silentLogger() });
  const ins = db.prepare('INSERT INTO ical_sources (propertyId, platformKey) VALUES (?, ?)');
  ins.run(1, 'airbnb');
  assert.throws(
    () => ins.run(1, 'airbnb'),
    /UNIQUE constraint failed/
  );
});

test('applyHygiene: skips uniq_resource_bookings_slot when pre-existing duplicates + logs French warning', () => {
  const db = freshDb();
  // Seed two duplicate rows BEFORE applying hygiene.
  const ins = db.prepare('INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, ?, ?, ?)');
  ins.run(1, '2026-06-01', '10:00', '12:00');
  ins.run(1, '2026-06-01', '10:00', '12:00');

  const logger = silentLogger();
  applyHygiene(db, { logger });

  const names = indexNames(db, 'resource_bookings');
  assert.ok(!names.includes('uniq_resource_bookings_slot'), 'unique index should NOT be created when duplicates exist');
  assert.ok(
    logger.warnings.some((w) => /Doublons détectés.*resource_bookings/.test(w)),
    `expected a French warning about duplicates in resource_bookings; got: ${logger.warnings.join(' | ')}`
  );
});

test('applyHygiene: skips uniq_ical_sources_property_platform when pre-existing duplicates', () => {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO ical_sources (propertyId, platformKey) VALUES (?, ?)');
  ins.run(1, 'airbnb');
  ins.run(1, 'airbnb');

  const logger = silentLogger();
  applyHygiene(db, { logger });

  const names = indexNames(db, 'ical_sources');
  assert.ok(!names.includes('uniq_ical_sources_property_platform'));
  assert.ok(logger.warnings.some((w) => /Doublons détectés.*ical_sources/.test(w)));
});

// ---------- resources.propertyId removal ----------

test('applyHygiene: drops the legacy resources.propertyId column', () => {
  const db = freshDb();
  // Sanity: column is there to begin with.
  assert.ok(db.prepare('PRAGMA table_info(resources)').all().some((c) => c.name === 'propertyId'));

  applyHygiene(db, { logger: silentLogger() });

  const cols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  assert.ok(!cols.includes('propertyId'), `propertyId should be gone; got: ${cols.join(', ')}`);
  assert.ok(cols.includes('propertyIds'), `propertyIds should still be there; got: ${cols.join(', ')}`);
});

test('applyHygiene: drop column is idempotent — second run is a no-op', () => {
  const db = freshDb();
  const logger1 = silentLogger();
  applyHygiene(db, { logger: logger1 });
  const logger2 = silentLogger();
  applyHygiene(db, { logger: logger2 });
  // No error; second run does not log the "supprimée" message because the column is already gone.
  assert.ok(!logger2.logs.some((l) => /Colonne resources\.propertyId supprimée/.test(l)));
});

test('applyHygiene: when propertyId is FK-defined (real schema), drop is refused but handled gracefully', () => {
  // Reproduces the production schema: resources.propertyId is part of a FOREIGN KEY definition.
  // SQLite refuses ALTER TABLE DROP COLUMN in that case; the hygiene pass must NOT throw and
  // must emit an info-level message explaining the column is harmless (no app code reads it).
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY);
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY,
      name TEXT,
      propertyId INTEGER,
      propertyIds TEXT,
      FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE SET NULL
    );
  `);

  const logger = silentLogger();
  // Run only the resources-related part by calling applyHygiene with this minimal DB.
  // Other tables are absent → applyHygiene's tableExists guard skips their indexes.
  applyHygiene(db, { logger });

  // Column should still be present (drop was refused).
  const cols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
  assert.ok(cols.includes('propertyId'), 'column should remain because SQLite refuses to drop FK-defined columns');
  // No warning, just an info-level log explaining the situation.
  assert.ok(
    logger.logs.some((l) => /conservée.*FK SQLite/.test(l)),
    `expected an info log about FK-blocked drop; got logs: ${logger.logs.join(' | ')}`
  );
  assert.ok(
    !logger.warnings.some((w) => /resources\.propertyId/.test(w)),
    `no warning expected when SQLite refuses the drop; got warnings: ${logger.warnings.join(' | ')}`
  );
});

// ---------- iCal anti-overbooking index ----------

test('applyHygiene: idx_reservations_ical_source is used by the query planner', () => {
  const db = freshDb();
  applyHygiene(db, { logger: silentLogger() });
  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT * FROM reservations WHERE sourceIcalSourceId = ? AND sourceIcalEventUid = ?'
  ).all(1, 'abc-123');
  const planText = plan.map((row) => row.detail || '').join(' | ');
  assert.match(planText, /idx_reservations_ical_source/, `query planner should use the new index; plan: ${planText}`);
});

test('applyHygiene: idx_ical_import_events_reservationId is created', () => {
  const db = freshDb();
  applyHygiene(db, { logger: silentLogger() });
  assert.ok(indexNames(db, 'ical_import_events').includes('idx_ical_import_events_reservationId'));
});

// ---------- Catalog sanity ----------

test('UNIQUE_INDEXES catalog matches the two expected entries', () => {
  assert.equal(UNIQUE_INDEXES.length, 2);
  const names = UNIQUE_INDEXES.map((u) => u.name);
  assert.ok(names.includes('uniq_resource_bookings_slot'));
  assert.ok(names.includes('uniq_ical_sources_property_platform'));
});

test('FK_INDEXES catalog covers the iCal anti-overbooking lookups', () => {
  const names = FK_INDEXES.map(([name]) => name);
  assert.ok(names.includes('idx_reservations_ical_source'));
  assert.ok(names.includes('idx_ical_import_events_reservationId'));
});
