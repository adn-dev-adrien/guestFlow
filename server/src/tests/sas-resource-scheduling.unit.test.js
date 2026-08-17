// Arrival SAS — « Planifier les ressources ».
// specs/hourly-resource-quantity-and-sas-scheduling.md §3.4.
//
// The hours are sold on the quote and placed on real slots with the guest at check-in. This covers
// what the step offers, what it refuses, and what the commit writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const resourceSchedulingModel = require('../models/resourceSchedulingModel');
const { create: createReservationsModel } = require('../models/reservationsModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCautionAmount REAL DEFAULT 0);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, nameEn TEXT DEFAULT '', quantity INTEGER DEFAULT 1,
    price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_hour', note TEXT DEFAULT '',
    turnoverMinutes INTEGER DEFAULT 0, minimumUsageMinutes INTEGER DEFAULT 60, slotDuration INTEGER DEFAULT 60,
    isComplex INTEGER DEFAULT 1, openTime TEXT DEFAULT '11:00', closeTime TEXT DEFAULT '22:00',
    openDays TEXT DEFAULT '[0,1,2,3,4,5,6]', closedDays TEXT DEFAULT '[]',
    showsPlanningCard INTEGER DEFAULT 1, hourlyEveningStart TEXT, hourlyEveningRate REAL DEFAULT 0,
    hourlyExternalDayRate REAL DEFAULT 0, hourlyExternalEveningRate REAL DEFAULT 0,
    heatUpMinutes INTEGER DEFAULT 0, heatRetentionMinutes INTEGER DEFAULT 0,
    createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE resource_properties (resourceId INTEGER, propertyId INTEGER);
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL DEFAULT 0, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
  CREATE TABLE resource_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER NOT NULL, reservationId INTEGER, clientId INTEGER,
    clientName TEXT, clientPhone TEXT, propertyId INTEGER, date TEXT, startTime TEXT, endTime TEXT,
    notes TEXT DEFAULT '', totalPrice REAL DEFAULT 0, paid INTEGER DEFAULT 0
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    checkInTime TEXT DEFAULT '16:00', checkOutTime TEXT DEFAULT '10:00',
    adults INTEGER DEFAULT 2, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
    complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
    complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
    complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
    endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
    arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
    checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
    extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER, breakfastTime TEXT,
    breakfastCoffee INTEGER DEFAULT 0, breakfastTea INTEGER DEFAULT 0, breakfastChocolate INTEGER DEFAULT 0,
    breakfastMilk INTEGER DEFAULT 0, breakfastPastries INTEGER DEFAULT 0, breakfastCereals INTEGER DEFAULT 0,
    breakfastBread REAL DEFAULT 0, breakfastNotifiedDate TEXT, breakfastNote TEXT, departureHandoverNote TEXT,
    updatedAt TEXT
  );
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 0,
    unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT, totalPrice REAL DEFAULT 0,
    offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, sessions TEXT
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
    inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
    sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 0,
    unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT, totalPrice REAL DEFAULT 0,
    offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, sasArrivalOrigin INTEGER DEFAULT 0,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL DEFAULT 0);
  -- Read by getSasUpsellOptions (ménage / linge de toilette): none configured here, so both upsells
  -- resolve to « nothing to offer » and stay out of the way of the resource-scheduling assertions.
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay',
    autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0
  );
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, price REAL);
`;

// Stay 11→14 Sept 2026, check-in 16:00. Bain nordique: 30 €/h day, 50 €/h from 20:00,
// 15 min turnover, no warm-up unless a test asks for one.
function seed({ hoursSold = 3, sessions = null, resource = {} } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura lodge')").run();
  const r = {
    name: 'Bain nordique', price: 30, turnoverMinutes: 15, minimumUsageMinutes: 60, slotDuration: 60,
    openTime: '11:00', closeTime: '22:00', hourlyEveningStart: '20:00', hourlyEveningRate: 50,
    heatUpMinutes: 0, heatRetentionMinutes: 0, quantity: 1, ...resource,
  };
  const info = db.prepare(`
    INSERT INTO resources (name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime,
      hourlyEveningStart, hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity)
    VALUES (@name, @price, @turnoverMinutes, @minimumUsageMinutes, @slotDuration, @openTime, @closeTime,
      @hourlyEveningStart, @hourlyEveningRate, @heatUpMinutes, @heatRetentionMinutes, @quantity)
  `).run(r);
  const resourceId = Number(info.lastInsertRowid);

  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime)
              VALUES (500, 1, '2026-09-11', '2026-09-14', '16:00', '10:00')`).run();
  if (hoursSold > 0) {
    db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions) VALUES (500, ?, ?, 30, ?, ?, ?, ?)')
      .run(resourceId, hoursSold, hoursSold, 'per_hour', hoursSold * 30, sessions ? JSON.stringify(sessions) : null);
  }

  const reservation = { id: 500, propertyId: 1, startDate: '2026-09-11', endDate: '2026-09-14', checkInTime: '16:00', checkOutTime: '10:00' };
  return {
    db, resourceId, reservation,
    scheduling: resourceSchedulingModel.create(db),
    reservations: createReservationsModel(db),
  };
}

// A fixed clock well before the stay, so `notBefore` is always the check-in.
const NOW = new Date('2026-09-01T09:00:00Z');
const slotsOn = (payload, resourceId, date) =>
  payload.resources.find((r) => r.resourceId === resourceId).days.find((d) => d.date === date).slots;
const stateAt = (payload, resourceId, date, time) =>
  slotsOn(payload, resourceId, date).find((s) => s.start === time)?.state;

// ── Applicability + hours owed ─────────────────────────────────────────────────────────────────────

test('the step applies while hours are still unplaced', () => {
  const { scheduling, reservation, resourceId } = seed({ hoursSold: 3 });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, true);
  const entry = payload.resources.find((r) => r.resourceId === resourceId);
  assert.deepEqual(
    { sold: entry.hoursSold, placed: entry.hoursPlaced, remaining: entry.hoursRemaining },
    { sold: 3, placed: 0, remaining: 3 },
  );
});

test('the step is skipped once every hour sits on a slot', () => {
  const { scheduling, reservation } = seed({
    hoursSold: 2,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '19:00' }],
  });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, false);
  assert.equal(payload.resources[0].hoursRemaining, 0);
});

test('partially placed hours leave the remainder owed', () => {
  const { scheduling, reservation } = seed({
    hoursSold: 3,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const entry = scheduling.getSchedulingPayload(reservation, { now: NOW }).resources[0];
  assert.equal(entry.hoursPlaced, 1);
  assert.equal(entry.hoursRemaining, 2);
});

test('a reservation with no hourly resource makes the step inapplicable', () => {
  const { scheduling, reservation } = seed({ hoursSold: 0 });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(payload.applicable, false);
  assert.deepEqual(payload.resources, []);
});

// ── What the picker offers ─────────────────────────────────────────────────────────────────────────

test('nothing is offered before the guests arrive', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  assert.equal(stateAt(payload, resourceId, '2026-09-11', '15:00'), 'past');
  assert.equal(stateAt(payload, resourceId, '2026-09-11', '16:00'), 'free');
});

test('nothing is offered after the check-out', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  // Check-out is 10:00 on the 14th; the resource opens at 11:00 → the whole departure day is closed.
  assert.ok(slotsOn(payload, resourceId, '2026-09-14').every((s) => s.state === 'closed'));
});

test('a warm-up pushes the first evening back, and a neighbour cancels it', () => {
  const cold = seed({ resource: { heatUpMinutes: 240, heatRetentionMinutes: 480 } });
  const coldPayload = cold.scheduling.getSchedulingPayload(cold.reservation, { now: NOW });
  assert.equal(stateAt(coldPayload, cold.resourceId, '2026-09-11', '17:00'), 'heating');
  assert.equal(stateAt(coldPayload, cold.resourceId, '2026-09-11', '20:00'), 'free');

  // Somebody else used the bath until 14:00 that day → still warm, so 16:00 works.
  const warm = seed({ resource: { heatUpMinutes: 240, heatRetentionMinutes: 480 } });
  warm.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2026-09-11', '13:00', '14:00')").run(warm.resourceId);
  const warmPayload = warm.scheduling.getSchedulingPayload(warm.reservation, { now: NOW });
  const slot = slotsOn(warmPayload, warm.resourceId, '2026-09-11').find((s) => s.start === '16:00');
  assert.equal(slot.state, 'free');
  assert.equal(slot.warm, true);
});

test('the occupancy strip shows the neighbours without naming anyone', () => {
  const { db, scheduling, reservation, resourceId } = seed();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9, 'Camille', 'Dupont')").run();
  db.prepare("INSERT INTO resource_bookings (resourceId, clientId, clientName, date, startTime, endTime) VALUES (?, 9, 'Camille Dupont', '2026-09-12', '14:00', '15:00')").run(resourceId);
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  const day = payload.resources[0].days.find((d) => d.date === '2026-09-12');
  assert.deepEqual(day.occupancy, [{ start: '14:00', end: '15:00' }]);
  assert.ok(!JSON.stringify(payload).includes('Camille'));
});

test("the reservation's own stored hours never block its own picker", () => {
  const { scheduling, reservation, resourceId } = seed({
    hoursSold: 3,
    sessions: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const payload = scheduling.getSchedulingPayload(reservation, { now: NOW });
  // Re-opening the SAS must be able to keep or move that block, so 17:00 stays offerable.
  assert.equal(stateAt(payload, resourceId, '2026-09-12', '17:00'), 'free');
});

test('a block placed earlier in the run occupies its slot on the next refresh', () => {
  const { scheduling, reservation, resourceId } = seed();
  const payload = scheduling.getFreeSlots({
    reservation, resourceId, now: NOW,
    pending: [{ date: '2026-09-12', start: '17:00', end: '18:00' }],
  });
  const slots = payload.days.find((d) => d.date === '2026-09-12').slots;
  assert.equal(slots.find((s) => s.start === '17:00').state, 'taken');
  assert.equal(slots.find((s) => s.start === '19:00').state, 'free');
});

test('getFreeSlots refuses a resource that is not sold on the reservation', () => {
  const { scheduling, reservation } = seed();
  assert.equal(scheduling.getFreeSlots({ reservation, resourceId: 999, now: NOW }), null);
});

// ── Commit-time validation ─────────────────────────────────────────────────────────────────────────

const validate = (ctx, blocks) => ctx.scheduling.validateBlocks({ reservation: ctx.reservation, blocks, now: NOW });

test('a bookable block passes and reports no supplement in the day band', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.supplements, []);
});

test('an evening block owes the band difference', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.supplements[0].amount, 40); // 2 h × (50 − 30)
  assert.match(verdict.supplements[0].label, /Bain nordique/);
});

test('a taken slot is refused, with its reason', () => {
  const ctx = seed();
  ctx.db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime) VALUES (?, '2026-09-12', '14:00', '15:00')").run(ctx.resourceId);
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'taken');
});

test('two blocks in the same payload cannot overlap each other', () => {
  const ctx = seed();
  const verdict = validate(ctx, [
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
  ]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'taken');
});

test('more hours than were sold are refused', () => {
  const ctx = seed({ hoursSold: 2 });
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '18:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'budget');
});

test('the budget spans the payload, not each block', () => {
  const ctx = seed({ hoursSold: 2 });
  const blocks = [
    { resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' },
    { resourceId: ctx.resourceId, date: '2026-09-13', start: '16:00', end: '17:00' }, // the 3rd hour
  ];
  assert.equal(validate(ctx, blocks.slice(0, 2)).ok, true);
  assert.equal(validate(ctx, blocks).reason, 'budget');
});

test('re-placing hours on a reservation that already has sessions uses the FULL sold budget', () => {
  // Re-opening a completed SAS must be able to MOVE a block, not just add to the remainder.
  const ctx = seed({ hoursSold: 2, sessions: [{ date: '2026-09-12', start: '17:00', end: '19:00' }] });
  const verdict = validate(ctx, [{ resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '16:00' }]);
  assert.equal(verdict.ok, true);
});

test('a resource not sold on the reservation is refused', () => {
  const ctx = seed();
  const verdict = validate(ctx, [{ resourceId: 999, date: '2026-09-12', start: '14:00', end: '15:00' }]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'unknown');
});

// ── What the commit writes ─────────────────────────────────────────────────────────────────────────

function storedSessions(ctx) {
  const row = ctx.db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = 500 AND resourceId = ?').get(ctx.resourceId);
  return JSON.parse(row.sessions || 'null');
}

test('the commit writes the placed blocks as sessions, ordered', () => {
  const ctx = seed();
  ctx.reservations.commitArrivalSas(500, {
    resourceBlocks: [
      { resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' },
      { resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '21:00' },
    ],
  });
  assert.deepEqual(storedSessions(ctx), [
    { date: '2026-09-12', start: '20:00', end: '21:00' },
    { date: '2026-09-13', start: '14:00', end: '15:00' },
  ]);
});

test('the commit REPLACES the sessions instead of appending to them', () => {
  const ctx = seed({ sessions: [{ date: '2026-09-12', start: '11:00', end: '12:00' }] });
  ctx.reservations.commitArrivalSas(500, {
    resourceBlocks: [{ resourceId: ctx.resourceId, date: '2026-09-13', start: '14:00', end: '15:00' }],
  });
  assert.deepEqual(storedSessions(ctx), [{ date: '2026-09-13', start: '14:00', end: '15:00' }]);
});

test('skipping the step writes nothing — the stored hours stay as they were', () => {
  const before = [{ date: '2026-09-12', start: '11:00', end: '12:00' }];
  const ctx = seed({ sessions: before });
  ctx.reservations.commitArrivalSas(500, { cautionReceived: true });
  assert.deepEqual(storedSessions(ctx), before);
});

test('the evening supplement lands in the arrival complement as a SAS line', () => {
  const ctx = seed();
  const amount = ctx.scheduling
    .validateBlocks({ reservation: ctx.reservation, blocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }], now: NOW })
    .supplements[0].amount;
  const complement = ctx.reservations.commitArrivalSas(500, {
    complementItems: [{ label: 'Bain nordique — supplément soirée', amount }],
    resourceBlocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }],
  });
  assert.equal(complement, 40);
  const rows = ctx.db.prepare('SELECT description, amount, inComplement, sasArrivalOrigin FROM reservation_custom_options WHERE reservationId = 500').all();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { amount: rows[0].amount, inComplement: rows[0].inComplement, sasOrigin: rows[0].sasArrivalOrigin },
    { amount: 40, inComplement: 1, sasOrigin: 1 },
  );
});

test('re-committing recomputes the supplement instead of stacking it', () => {
  const ctx = seed();
  const args = {
    complementItems: [{ label: 'Bain nordique — supplément soirée', amount: 40 }],
    resourceBlocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '20:00', end: '22:00' }],
  };
  ctx.reservations.commitArrivalSas(500, args);
  const second = ctx.reservations.commitArrivalSas(500, args);
  assert.equal(second, 40, 'a second run must not double the supplement');

  // Moving the block into the day band removes the supplement entirely.
  const third = ctx.reservations.commitArrivalSas(500, {
    complementItems: [],
    resourceBlocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '14:00', end: '16:00' }],
  });
  assert.equal(third, 0);
});
