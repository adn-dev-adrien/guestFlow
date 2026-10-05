// The evening of an hourly resource is billed once (specs/hourly-resource-quantity-and-sas-scheduling.md
// §3.4 rules 26, 30-32).
//
// Three defects, all on money:
//  - a fiche save after the SAS re-priced the sold line from its evening sessions, while the SAS had
//    already billed the evening as a supplement;
//  - a re-opened SAS sent the old supplement back as a custom line, and the server added a fresh one;
//  - a save after a partial placement shrank the sold hours to the hours placed.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Module = require('module');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { seed } = require('./hourlySchedulingFixture');

// ── The engine: a sold line is frozen, whatever its sessions say ───────────────────────────────────

function pricingDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30,
      hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0,
      openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  // Bain nordique: 30 €/h, 50 €/h from 20:00, 1-hour slots.
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, isComplex, showsPlanningCard, slotDuration, hourlyEveningStart, hourlyEveningRate) VALUES (14, 'Bain nordique', 1, 30, 'per_hour', 1, 1, 60, '20:00', 50)").run();
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13',
  adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [],
};
const soldAtDayRate = (hours) => [{
  resourceId: 14, quantity: hours, unitPrice: 30, billedUnits: hours, priceType: 'per_hour', totalPrice: hours * 30, offered: 0,
}];
const bathLine = (quote) => quote.resourceLines.find((l) => l.resourceId === 14);

test('rule 30: a sold line keeps its amount after the SAS places an evening hour', () => {
  const quote = calculateReservationQuote({
    db: pricingDb(), ...STAY,
    lockedResourceLines: soldAtDayRate(2),
    selectedResources: [{ resourceId: 14, quantity: 2, sessions: [
      { date: '2026-07-11', start: '15:00', end: '16:00' },
      { date: '2026-07-11', start: '21:00', end: '22:00' },
    ] }],
  });
  const line = bathLine(quote);
  assert.equal(line.totalPrice, 60, 'the evening is the SAS supplement, never the line');
  assert.equal(line.quantity, 2);
  assert.equal(line.scheduledHours, 2);
  assert.equal(line.sessions.length, 2);
});

test('rule 31: a partly placed line keeps every hour sold', () => {
  const quote = calculateReservationQuote({
    db: pricingDb(), ...STAY,
    lockedResourceLines: soldAtDayRate(3),
    selectedResources: [{ resourceId: 14, quantity: 3, sessions: [{ date: '2026-07-11', start: '15:00', end: '16:00' }] }],
  });
  const line = bathLine(quote);
  assert.equal(line.quantity, 3);
  assert.equal(line.totalPrice, 90);
  assert.equal(line.scheduledHours, 1);
});

test('rule 30: an unsold line is still priced from its sessions', () => {
  const quote = calculateReservationQuote({
    db: pricingDb(), ...STAY,
    selectedResources: [{ resourceId: 14, quantity: 2, sessions: [
      { date: '2026-07-11', start: '15:00', end: '16:00' },
      { date: '2026-07-11', start: '21:00', end: '22:00' },
    ] }],
  });
  assert.equal(bathLine(quote).totalPrice, 80);
});

// ── The supplement: what the placed hours owe beyond what the line already bills ───────────────────

const NOW = new Date('2026-09-01T09:00:00Z');
const DAY_AND_EVENING = [
  { date: '2026-09-12', start: '17:00', end: '18:00' },
  { date: '2026-09-12', start: '20:00', end: '21:00' },
];

test('rule 30: a line sold at the day rate owes the evening difference', () => {
  const ctx = seed({ hoursSold: 2 });
  const verdict = ctx.scheduling.validateBlocks({
    reservation: ctx.reservation, now: NOW, blocks: DAY_AND_EVENING.map((b) => ({ ...b, resourceId: ctx.resourceId })),
  });
  assert.deepEqual(verdict.supplements.map((s) => s.amount), [20]);
});

test('rule 30: a line sold with its evening already priced owes nothing for it', () => {
  const ctx = seed({ hoursSold: 2 });
  ctx.db.prepare('UPDATE reservation_resources SET unitPrice = 40, totalPrice = 80 WHERE reservationId = 500').run();
  const verdict = ctx.scheduling.validateBlocks({
    reservation: ctx.reservation, now: NOW, blocks: DAY_AND_EVENING.map((b) => ({ ...b, resourceId: ctx.resourceId })),
  });
  assert.deepEqual(verdict.supplements, []);
});

test('rule 30: an offered line counts its real amount', () => {
  const ctx = seed({ hoursSold: 2 });
  ctx.db.prepare('UPDATE reservation_resources SET unitPrice = 40, totalPrice = 0, offered = 1 WHERE reservationId = 500').run();
  const verdict = ctx.scheduling.validateBlocks({
    reservation: ctx.reservation, now: NOW, blocks: DAY_AND_EVENING.map((b) => ({ ...b, resourceId: ctx.resourceId })),
  });
  assert.deepEqual(verdict.supplements, []);
});

test('rule 32: the stored sessions owe their supplement when the step did not run', () => {
  const ctx = seed({ hoursSold: 2, sessions: DAY_AND_EVENING });
  assert.deepEqual(ctx.scheduling.storedSupplements(ctx.reservation), [
    { resourceId: ctx.resourceId, label: 'Bain nordique — supplément soirée', amount: 20 },
  ]);
  assert.deepEqual(ctx.scheduling.supplementLabels(ctx.reservation), ['Bain nordique — supplément soirée']);
});

test('rule 26: the SAS payload hands the placed hours back with their supplement', () => {
  const ctx = seed({ hoursSold: 2, sessions: DAY_AND_EVENING });
  const entry = ctx.scheduling.getSchedulingPayload(ctx.reservation, { now: NOW }).resources[0];
  assert.deepEqual(entry.sessions.map((s) => s.supplement), [0, 20]);
});

// ── The commit: one supplement, whatever the dialog carries back ───────────────────────────────────

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The controller validates against the real clock: freeze it before the stay.
function commitArrival(ctx, body, t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const writes = [];
  const reservation = { ...ctx.reservation, arrivalSasDoneAt: '2026-09-11 16:30:00' };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => reservation;
    if (k === 'commitArrivalSas') return (id, args) => { writes.push(args); return 0; };
    return () => null;
  } });
  const mocks = {
    '../models/reservationsModel': reservationsModelMock,
    '../models/resourceSchedulingModel': ctx.scheduling,
    '../models/linenItemsModel': { list: () => [] },
    '../models/settingsModel': { read: () => ({}) },
    '../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../models/repairAmountsModel': { list: () => [] },
    '../utils/sasAudit': { buildSasSnapshot: () => ({}), computeSasChanges: () => [] },
  };
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return origRequire.call(this, id);
  };
  let controller;
  try {
    delete require.cache[require.resolve('../controllers/sasController')];
    controller = require('../controllers/sasController');
  } finally { Module.prototype.require = origRequire; }
  const res = fakeRes();
  controller.commitArrival({ params: { id: '500' }, body, user: { id: 1, roles: ['admin'] } }, res);
  return { res, items: writes[0] && writes[0].complementItems };
}

const OLD_SUPPLEMENT = { label: 'Bain nordique — supplément soirée', amount: 20 };

test('rule 26: a re-opened SAS that sends the old supplement back bills it once', (t) => {
  const ctx = seed({ hoursSold: 2, sessions: DAY_AND_EVENING });
  const { res, items } = commitArrival(ctx, {
    complementItems: [OLD_SUPPLEMENT, { label: 'Drap housse', amount: 15 }],
    resourceBlocks: DAY_AND_EVENING.map((b) => ({ ...b, resourceId: ctx.resourceId })),
  }, t);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(items, [
    { label: 'Drap housse', amount: 15, offered: false },
    { label: 'Bain nordique — supplément soirée', amount: 20 },
  ]);
});

test('rule 32: a commit without the step recomputes the supplement instead of keeping a copy', (t) => {
  const ctx = seed({ hoursSold: 2, sessions: DAY_AND_EVENING });
  const { items } = commitArrival(ctx, { complementItems: [OLD_SUPPLEMENT] }, t);
  assert.deepEqual(items, [{ label: 'Bain nordique — supplément soirée', amount: 20 }]);
});

test('rule 32: hours moved to the day band drop the supplement', (t) => {
  const ctx = seed({ hoursSold: 2, sessions: DAY_AND_EVENING });
  const { items } = commitArrival(ctx, {
    complementItems: [OLD_SUPPLEMENT],
    resourceBlocks: [{ resourceId: ctx.resourceId, date: '2026-09-12', start: '17:00', end: '19:00' }],
  }, t);
  assert.deepEqual(items, []);
});

// ── A fiche save keeps the SAS's own lines its own (rule 33) ───────────────────────────────────────

test('rule 33: a fiche save keeps the SAS marker on the lines the SAS wrote', () => {
  const ctx = seed({ hoursSold: 2 });
  const lines = require('../models/bookingLinesModel').buildModel(ctx.db);
  ctx.db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin)
    VALUES (500, 'Bain nordique — supplément soirée', 20, 1, 1), (500, 'Bouquet', 12, 0, 0)`).run();

  lines.replaceCustomOptions(500, [
    { isCustom: true, title: 'Bain nordique — supplément soirée', totalPrice: 20, inComplement: 1 },
    { isCustom: true, title: 'Bouquet', totalPrice: 12 },
    { isCustom: true, title: 'Panier pique-nique', totalPrice: 25 },
  ]);

  const rows = ctx.db.prepare('SELECT description, sasArrivalOrigin FROM reservation_custom_options WHERE reservationId = 500 ORDER BY sortOrder').all();
  assert.deepEqual(rows.map((r) => [r.description, r.sasArrivalOrigin]), [
    ['Bain nordique — supplément soirée', 1],
    ['Bouquet', 0],
    ['Panier pique-nique', 0],
  ]);
});
