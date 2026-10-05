// The `hourly-resources` module (specs/plugins-phase-3c-hourly-resources.md rules 9–17, 25).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const plugin = require('..');
const { createTables, tagEveningSupplements, resetHourlyColumns } = require('../migrations');

test.afterEach(() => registry.reset());

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY);
    CREATE TABLE clients (id INTEGER PRIMARY KEY);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY);
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT, priceType TEXT, price REAL DEFAULT 0, quantity INTEGER DEFAULT 1,
      isComplex INTEGER DEFAULT 0, showsPlanningCard INTEGER DEFAULT 0, turnoverMinutes INTEGER DEFAULT 0,
      hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0, hourlyExternalDayRate REAL DEFAULT 0,
      hourlyExternalEveningRate REAL DEFAULT 0, heatUpMinutes INTEGER DEFAULT 0, heatRetentionMinutes INTEGER DEFAULT 0
    );
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, sessions TEXT);
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL,
      sasArrivalOrigin INTEGER DEFAULT 0, sasLineKey TEXT
    );
  `);
  db.prepare(`INSERT INTO resources (id, name, priceType, price, isComplex, showsPlanningCard, turnoverMinutes, hourlyEveningStart, hourlyEveningRate, heatUpMinutes)
    VALUES (2, 'Bain nordique', 'per_hour', 30, 1, 1, 15, '20:00', 50, 240), (1, 'Lit bébé', 'per_stay', 0, 0, 0, 0, NULL, 0, 0)`).run();
  return db;
}

function registered(db = freshDb()) {
  registry.configure({ isActive: () => true, allows: () => true });
  plugin.register(createContext(plugin.id, { db }));
  return registry.get(plugin.id);
}

test('rules 9–12: the module declares its pricing, URLs, reception entries and SAS step', () => {
  const record = registered();
  assert.deepEqual(record.priceLineContributor.priceTypes, ['per_hour']);
  assert.deepEqual(record.mounts.map((m) => m.path), ['/api/resource-bookings']);
  assert.deepEqual(record.routes.map((r) => `${r.method} ${r.path}`), [
    'get /api/resources/:id/free-slots',
    'get /api/planning/resource-cards',
    'post /api/planning/resource-cards/done',
  ]);
  assert.ok(record.roleAccess.reception.some((m) => m.re.test('/planning/resource-cards/done')));
  assert.ok(record.roleAccess.reception.some((m) => m.re.test('/resource-bookings/planning-events')));
  assert.equal(record.sasProviders.length, 1);
  assert.deepEqual(record.sasCommits.map((h) => h.step), ['resourceScheduling']);
});

test('rule 16: tables_v1 keeps every external booking of an existing database', () => {
  const db = freshDb();
  db.exec("CREATE TABLE resource_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, reservationId INTEGER, clientId INTEGER, clientName TEXT, clientPhone TEXT, propertyId INTEGER, date TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL, notes TEXT DEFAULT '', totalPrice REAL DEFAULT 0, paid INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)");
  db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, totalPrice, paid) VALUES (2, '2026-10-01', '18:00', '19:00', 50, 1)").run();
  createTables(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n, 1);
});

test('rule 7, §5: the evening supplements written before the phase are tagged, and only those', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity) VALUES (7, 2, 2), (8, 1, 1)').run();
  db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, sasArrivalOrigin) VALUES
    (7, 'Bain nordique — supplément soirée', 20, 1),
    (7, 'Drap housse', 15, 1),
    (8, 'Bain nordique — supplément soirée', 20, 1),
    (9, 'Bain nordique — supplément soirée', 20, 0)`).run();
  tagEveningSupplements(db);
  const tags = db.prepare('SELECT reservationId, description, sasLineKey FROM reservation_custom_options ORDER BY id').all()
    .map((r) => [r.reservationId, r.description, r.sasLineKey]);
  assert.deepEqual(tags, [
    [7, 'Bain nordique — supplément soirée', 'hourly-resources:evening:2'],
    [7, 'Drap housse', null],
    [8, 'Bain nordique — supplément soirée', null], // that stay has no bath
    [9, 'Bain nordique — supplément soirée', null], // not written by the SAS
  ]);
});

test('rule 17 (P16): the erasure warns about the paid external bookings, then lists the rest', () => {
  const db = freshDb();
  createTables(db);
  db.prepare(`INSERT INTO resource_bookings (resourceId, date, startTime, endTime, totalPrice, paid) VALUES
    (2, '2026-10-01', '18:00', '19:00', 50, 1), (2, '2026-10-02', '18:00', '19:00', 90, 1), (2, '2026-10-03', '18:00', '19:00', 50, 0)`).run();
  const lines = registered(db).data.describe(db);
  assert.deepEqual(lines, [
    { label: '2 réservations hors séjour, 140,00 € encaissés, absents de la compta', count: 2, warning: true },
    { label: '1 réservation hors séjour', count: 1 },
    { label: 'les réglages de créneaux des ressources', count: 1 },
  ]);
  assert.deepEqual(registry.get(plugin.id).data.tables, ['resource_bookings']);
});

test('rule 17: the erasure empties the slot settings; prices and free minutes stay', () => {
  const db = freshDb();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 2, 30, 60)').run();
  resetHourlyColumns(db);
  const bath = db.prepare('SELECT * FROM resources WHERE id = 2').get();
  assert.deepEqual(
    [bath.isComplex, bath.showsPlanningCard, bath.turnoverMinutes, bath.hourlyEveningStart, bath.hourlyEveningRate, bath.heatUpMinutes],
    [0, 0, 0, null, 0, 0],
  );
  assert.equal(bath.price, 30);
  assert.equal(bath.priceType, 'per_hour', 'the resource stays sold by the hour, hidden while the plugin is off');
  assert.equal(db.prepare('SELECT freeMinutes FROM property_resource_prices').get().freeMinutes, 60);
});
