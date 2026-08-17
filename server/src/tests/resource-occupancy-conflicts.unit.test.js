const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourceBookingsModel = require('../models/resourceBookingsModel');
const resourceOccupancyModel = require('../models/resourceOccupancyModel');

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.5 — a resource is occupied by standalone
// bookings AND by the sessions placed on reservations. `countConflicts` used to read only the former,
// so a standalone booking could be created right on top of a guest's nordic-bath session (§1 defect 4).

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, quantity INTEGER DEFAULT 1, price REAL DEFAULT 0,
    priceType TEXT DEFAULT 'per_hour', turnoverMinutes INTEGER DEFAULT 0, minimumUsageMinutes INTEGER DEFAULT 0,
    slotDuration INTEGER DEFAULT 60, isComplex INTEGER DEFAULT 0, openTime TEXT DEFAULT '08:00',
    closeTime TEXT DEFAULT '22:00', openDays TEXT DEFAULT '[0,1,2,3,4,5,6]',
    showsPlanningCard INTEGER DEFAULT 1, hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0,
    hourlyExternalDayRate REAL DEFAULT 0, hourlyExternalEveningRate REAL DEFAULT 0
  );
  CREATE TABLE property_resource_prices (
    propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL DEFAULT 0, freeMinutes INTEGER DEFAULT 0,
    PRIMARY KEY (propertyId, resourceId)
  );
  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, reservationId INTEGER, clientId INTEGER,
    clientName TEXT, clientPhone TEXT, propertyId INTEGER, date TEXT, startTime TEXT, endTime TEXT,
    notes TEXT DEFAULT '', totalPrice REAL DEFAULT 0, paid INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER);
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 0,
    unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT, totalPrice REAL DEFAULT 0,
    offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, sessions TEXT
  );
`;

function seed({ resource = {}, sessions = [], kind = 'reservation' } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const r = {
    name: 'Bain nordique', quantity: 1, price: 30, turnoverMinutes: 15, minimumUsageMinutes: 60,
    slotDuration: 60, ...resource,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, quantity, price, turnoverMinutes, minimumUsageMinutes, slotDuration)
    VALUES (@name, @quantity, @price, @turnoverMinutes, @minimumUsageMinutes, @slotDuration)
  `).run(r);
  const resourceId = Number(info.lastInsertRowid);

  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId) VALUES (700, ?, 1, 1)").run(kind);
  if (sessions.length) {
    db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, sessions) VALUES (700, ?, ?, ?)')
      .run(resourceId, sessions.length, JSON.stringify(sessions));
  }
  return { db, resourceId, model: resourceBookingsModel.create(db), occupancy: resourceOccupancyModel.create(db) };
}

const GUEST_SESSION = [{ date: '2026-09-12', start: '14:00', end: '15:00' }];

// ── The regression that matters ────────────────────────────────────────────────────────────────────

test('REGRESSION: a guest session blocks a standalone booking on the same slot', () => {
  const { model, resourceId } = seed({ sessions: GUEST_SESSION });
  const result = model.createBooking({
    resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00', propertyId: 1,
  });
  assert.equal(result.status, 409);
  assert.match(result.error, /non disponible/i);
});

test('REGRESSION: the turnover buffer around a guest session also blocks', () => {
  const { model, resourceId } = seed({ sessions: GUEST_SESSION });
  // Ends exactly when the session starts — 15 min of reset are still owed.
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '13:00', endTime: '14:00' }).status, 409);
  // Starts exactly when it ends — same.
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '15:00', endTime: '16:00' }).status, 409);
  // Clear of the buffer on both sides.
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '16:00', endTime: '17:00' }).ok, true);
});

test('a standalone booking still blocks another standalone booking (unchanged)', () => {
  const { model, resourceId } = seed();
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00' }).ok, true);
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00' }).status, 409);
});

test('a guest session on ANOTHER day leaves the slot free', () => {
  const { model, resourceId } = seed({ sessions: GUEST_SESSION });
  assert.equal(model.createBooking({ resourceId, date: '2026-09-13', startTime: '14:00', endTime: '15:00' }).ok, true);
});

test('capacity 2 admits the standalone booking beside one guest session, refuses the third use', () => {
  const { model, resourceId } = seed({ resource: { quantity: 2, turnoverMinutes: 0 }, sessions: GUEST_SESSION });
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00' }).ok, true);
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00' }).status, 409);
});

test('a session carried by a DEVIS reserves nothing — a quote holds no slot', () => {
  const { model, resourceId } = seed({ sessions: GUEST_SESSION, kind: 'devis' });
  assert.equal(model.createBooking({ resourceId, date: '2026-09-12', startTime: '14:00', endTime: '15:00' }).ok, true);
});

// ── The unified reader ─────────────────────────────────────────────────────────────────────────────

test('listRange: returns bookings and sessions together, each tagged by kind', () => {
  const { model, occupancy, resourceId } = seed({ sessions: GUEST_SESSION });
  model.createBooking({ resourceId, date: '2026-09-12', startTime: '17:00', endTime: '18:00' });

  const rows = occupancy.listRange({ resourceId, from: '2026-09-12', to: '2026-09-12' });
  assert.deepEqual(rows.map((r) => [r.start, r.kind]), [['14:00', 'session'], ['17:00', 'booking']]);
  assert.equal(rows.find((r) => r.kind === 'session').reservationId, 700);
});

test('listRange: carries no client identity', () => {
  const { db, model, occupancy, resourceId } = seed({ sessions: GUEST_SESSION });
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Dupont')").run();
  model.createBooking({ resourceId, date: '2026-09-12', startTime: '17:00', endTime: '18:00', clientName: 'Client extérieur' });

  const serialized = JSON.stringify(occupancy.listRange({ resourceId, from: '2026-09-12', to: '2026-09-12' }));
  assert.ok(!serialized.includes('Camille'));
  assert.ok(!serialized.includes('Dupont'));
  assert.ok(!serialized.includes('Client extérieur'));
});

test('listRange: excludeReservationId drops the booking being edited, so it never blocks itself', () => {
  const { occupancy, resourceId } = seed({ sessions: GUEST_SESSION });
  assert.equal(occupancy.listRange({ resourceId, from: '2026-09-12', to: '2026-09-12' }).length, 1);
  assert.equal(
    occupancy.listRange({ resourceId, from: '2026-09-12', to: '2026-09-12', excludeReservationId: 700 }).length,
    0,
  );
});

test('listForStay: reaches one day back so a late-evening use can still be seen', () => {
  const { occupancy, resourceId } = seed({ sessions: [{ date: '2026-09-11', start: '21:00', end: '22:00' }] });
  const rows = occupancy.listForStay({ resourceId, startDate: '2026-09-12', endDate: '2026-09-14' });
  assert.deepEqual(rows.map((r) => r.date), ['2026-09-11']);
});

test('listRange: malformed session JSON is ignored, never thrown', () => {
  const { db, occupancy, resourceId } = seed();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, sessions) VALUES (700, ?, 1, ?)')
    .run(resourceId, 'not json at all');
  assert.deepEqual(occupancy.listRange({ resourceId, from: '2026-09-12', to: '2026-09-12' }), []);
});
