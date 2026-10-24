// specs/resource-supplements-total-server-side.md rules 1-7, 15 — the price of a booking draft is one
// function, shared by the preview and the commit; the preview refuses what the commit refuses and
// writes nothing; the displayed total is compared, never enforced.
// « Bain fictif »: open 10:00-22:00, slot 30 min, minimum 60 min, guest 25 / 35 €/h from 19:00,
// external 30 / 40 €/h; logement 2 offers 60 min.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const plugin = require('..');
const bookingsModel = require('../bookingsModel');
const { createController } = require('../controller');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, quantity INTEGER DEFAULT 1, price REAL DEFAULT 0,
    priceType TEXT DEFAULT 'per_stay', turnoverMinutes INTEGER DEFAULT 0, minimumUsageMinutes INTEGER DEFAULT 0,
    slotDuration INTEGER DEFAULT 60, isComplex INTEGER DEFAULT 0, openTime TEXT DEFAULT '08:00',
    closeTime TEXT DEFAULT '22:00', openDays TEXT DEFAULT '[0,1,2,3,4,5,6]',
    showsPlanningCard INTEGER DEFAULT 0, hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0,
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
`;

function seed(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const r = {
    name: 'Bain fictif', quantity: 1, price: 25, priceType: 'per_hour', turnoverMinutes: 0,
    minimumUsageMinutes: 60, slotDuration: 30, isComplex: 1, openTime: '10:00', closeTime: '22:00',
    showsPlanningCard: 1, hourlyEveningStart: '19:00', hourlyEveningRate: 35,
    hourlyExternalDayRate: 30, hourlyExternalEveningRate: 40, ...overrides,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex, openTime, closeTime, showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate)
    VALUES (@name, @quantity, @price, @priceType, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @isComplex, @openTime, @closeTime, @showsPlanningCard, @hourlyEveningStart, @hourlyEveningRate, @hourlyExternalDayRate, @hourlyExternalEveningRate)
  `).run(r);
  const resourceId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Cabane fictive')").run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (2, ?, 25, 60)').run(resourceId);
  return { db, model: bookingsModel.create(db), resourceId };
}

const draft = (resourceId, startTime, endTime, extra = {}) => ({
  resourceId, date: '2099-02-13', startTime, endTime, ...extra,
});
const rowCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM resource_bookings').get().n;

test('rule 1 — external 17:00-19:00 is one day band at the external rate', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, '17:00', '19:00'));
  assert.equal(out.total, 60);
  assert.equal(out.pricing, 'banded');
  assert.equal(out.rateGrid, 'external');
  assert.deepEqual(out.bands, [{ band: 'day', from: '17:00', to: '19:00', minutes: 120, rate: 30, amount: 60 }]);
});

test('rule 1 — external 18:00-20:00 crosses the switch: 30 + 40 = 70', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, '18:00', '20:00'));
  assert.equal(out.total, 70);
  assert.deepEqual(out.bands.map((b) => [b.band, b.from, b.to, b.amount]), [
    ['day', '18:00', '19:00', 30], ['evening', '19:00', '20:00', 40],
  ]);
  assert.equal(out.freeMinutesApplied, 0);
  assert.equal(out.billedMinutes, 120);
});

test('rule 1 — the logement offers 60 min: the offered hour is valued at its own band', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, '18:00', '20:00', { propertyId: 2 }));
  assert.equal(out.total, 40);
  assert.equal(out.freeMinutesApplied, 60);
  assert.equal(out.billedMinutes, 60);
  assert.equal(out.grossTotal, 70);
  assert.equal(out.freeValue, 30);
});

test('finding 1 — an off-grid range falls back to the flat guest rate, the figure stored today', () => {
  const { model, resourceId } = seed();
  const out = model.priceBooking(draft(resourceId, '18:05', '19:35'));
  assert.equal(out.pricing, 'flat-hourly');
  assert.equal(out.total, 37.5);
  assert.equal(out.rateGrid, null);
});

test('finding 2 — a fixed-price resource booked 2 h costs its flat price', () => {
  const { model, resourceId } = seed({
    priceType: 'per_stay', price: 15, showsPlanningCard: 0, slotDuration: 60, hourlyEveningStart: null,
  });
  const out = model.priceBooking(draft(resourceId, '14:00', '16:00'));
  assert.equal(out.pricing, 'fixed');
  assert.equal(out.total, 15);
  assert.deepEqual(out.bands, []);
});

test('finding 3 — a booking tied to a reservation is priced on the guest grid', () => {
  const { model, db, resourceId } = seed();
  const id = Number(db.prepare(
    "INSERT INTO resource_bookings (resourceId, reservationId, date, startTime, endTime) VALUES (?, 7, '2099-02-12', '10:00', '11:00')",
  ).run(resourceId).lastInsertRowid);
  const out = model.priceBooking(draft(resourceId, '19:00', '21:00', { bookingId: id }));
  assert.equal(out.rateGrid, 'guest');
  assert.equal(out.total, 70);
});

test('a free resource is priced 0,00 with the pricing named', () => {
  const { model, resourceId } = seed({ priceType: 'free', showsPlanningCard: 0 });
  const out = model.priceBooking(draft(resourceId, '14:00', '16:00'));
  assert.equal(out.total, 0);
  assert.equal(out.pricing, 'free');
});

test('rules 4, 5 — the refusals of the commit, from the same checks', () => {
  const { model, resourceId } = seed();
  assert.deepEqual(
    model.priceBooking(draft(resourceId, '18:00', '18:30')),
    { error: 'Durée minimale 60 min requise', status: 400 },
  );
  assert.equal(model.priceBooking(draft(resourceId, '', '')).status, 400);
  assert.equal(model.priceBooking(draft(999, '18:00', '19:00')).status, 404);
  assert.equal(model.priceBooking(draft(resourceId, '18:00', '19:00', { bookingId: 999 })).status, 404);

  model.createBooking(draft(resourceId, '18:00', '20:00', { clientName: 'Alex' }));
  const full = model.priceBooking(draft(resourceId, '19:00', '21:00'));
  assert.deepEqual(full, { error: 'Créneau non disponible (capacité atteinte)', status: 409 });
  assert.equal(model.createBooking(draft(resourceId, '19:00', '21:00')).status, 409);
});

test('rule 5 — editing a booking excludes the booking itself from the capacity check', () => {
  const { model, resourceId } = seed();
  const created = model.createBooking(draft(resourceId, '18:00', '20:00', { clientName: 'Alex' }));
  const out = model.priceBooking(draft(resourceId, '18:00', '20:00', { bookingId: created.id }));
  assert.equal(out.status, undefined);
  assert.equal(out.total, 70);
});

test('rule 1 — the preview writes nothing', () => {
  const { model, db, resourceId } = seed();
  const created = model.createBooking(draft(resourceId, '10:00', '12:00', { clientName: 'Alex' }));
  const before = JSON.stringify(db.prepare('SELECT * FROM resource_bookings').all());
  model.priceBooking(draft(resourceId, '18:00', '20:00'));
  model.priceBooking(draft(resourceId, '14:00', '16:00', { bookingId: created.id, propertyId: 2 }));
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM resource_bookings').all()), before);
  assert.equal(rowCount(db), 1);
});

test('rule 2 — the commit stores exactly the previewed total, case by case', () => {
  const cases = [
    [{}, '17:00', '19:00', {}],
    [{}, '18:00', '20:00', {}],
    [{}, '18:00', '20:00', { propertyId: 2 }],
    [{}, '18:05', '19:35', {}],
    [{ priceType: 'per_stay', price: 15, showsPlanningCard: 0, hourlyEveningStart: null, slotDuration: 60 }, '14:00', '16:00', {}],
    [{ priceType: 'free', showsPlanningCard: 0 }, '14:00', '16:00', {}],
  ];
  for (const [resource, start, end, extra] of cases) {
    const { model, db, resourceId } = seed(resource);
    const previewed = model.priceBooking(draft(resourceId, start, end, extra));
    const created = model.createBooking(draft(resourceId, start, end, { ...extra, clientName: 'Alex' }));
    const stored = db.prepare('SELECT totalPrice FROM resource_bookings WHERE id = ?').get(created.id).totalPrice;
    assert.equal(stored, previewed.total, `${start}-${end} ${JSON.stringify(resource)}`);
    assert.equal(created.totalPrice, previewed.total);
  }
});

test('rule 15 — a differing displayed total is warned about, the stored price wins', () => {
  const { model, db, resourceId } = seed();
  const created = model.createBooking(draft(resourceId, '18:00', '20:00', { propertyId: 2, displayedTotal: 70 }));
  assert.equal(created.totalPrice, 40);
  assert.deepEqual(created.warning, { code: 'BOOKING_TOTAL_DIFFERED', displayed: 70, stored: 40 });
  assert.equal(db.prepare('SELECT totalPrice FROM resource_bookings WHERE id = ?').get(created.id).totalPrice, 40);

  const same = model.createBooking(draft(resourceId, '10:00', '12:00', { displayedTotal: 60.004 }));
  assert.equal(same.warning, null);
  const none = model.createBooking(draft(resourceId, '12:00', '14:00'));
  assert.equal(none.warning, null);
});

test('rule 15 — the edit answers the same way', () => {
  const { model, resourceId } = seed();
  const created = model.createBooking(draft(resourceId, '10:00', '12:00', { clientName: 'Alex' }));
  const edited = model.update(created.id, { startTime: '18:00', endTime: '20:00', displayedTotal: 60 });
  assert.equal(edited.totalPrice, 70);
  assert.equal(edited.warning.code, 'BOOKING_TOTAL_DIFFERED');
  assert.equal(model.update(created.id, { displayedTotal: 70 }).warning, null);
});

test('rules 4, 7 — the controller maps refusals, and reception never reaches the preview', () => {
  const { model, resourceId } = seed();
  const controller = createController({ bookings: () => model });
  const reply = () => ({
    code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
  });
  const ok = reply();
  controller.preview({ body: draft(resourceId, '17:00', '19:00') }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.total, 60);
  const refused = reply();
  controller.preview({ body: draft(resourceId, '18:00', '18:30') }, refused);
  assert.equal(refused.code, 400);
  assert.deepEqual(refused.body, { error: 'Durée minimale 60 min requise' });

  registry.configure({ isActive: () => true, allows: () => true });
  plugin.register(createContext(plugin.id, { db: seed().db }));
  const record = registry.get(plugin.id);
  registry.reset();
  assert.equal(record.roleAccess.reception.some((m) => m.method === 'POST' && m.re.test('/resource-bookings/preview')), false);
  assert.ok(record.roleAccess.reception.some((m) => m.re.test('/resource-bookings/planning-events')));
});

test('a bookingId of another resource is refused', () => {
  const { model, db, resourceId } = seed();
  const other = Number(db.prepare("INSERT INTO resources (name, priceType) VALUES ('Autre fictif', 'per_stay')").run().lastInsertRowid);
  const id = Number(db.prepare(
    "INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2099-02-12', '10:00', '11:00')",
  ).run(other).lastInsertRowid);
  const out = model.priceBooking(draft(resourceId, '18:00', '20:00', { bookingId: id }));
  assert.equal(out.status, 400);
});
