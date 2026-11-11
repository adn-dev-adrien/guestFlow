const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const planningDaysModel = require('../models/planningDaysModel');
const { buildController } = require('../controllers/planningController');
const { toArrivalCard, toDepartureRow, toOccupancyRow, CARD_FIELDS, DEPARTURE_FIELDS, OCCUPANCY_FIELDS } = require('../utils/upcomingArrivals');

// specs/inte-performance.md rules 20 and 22 — what the Planning page and the fiche read of a stay, not
// the whole fiche (about 5.8 kB per stay, 60 columns and three joined lists).

const FICHE = {
  id: 7, startDate: '2026-10-28', endDate: '2026-10-30', clientId: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Gite',
  propertyId: 1, platform: 'Booking', checkInTime: '16:00', checkOutTime: '10:00', checkInReady: 0, checkOutDone: 1, adults: 2,
  departureHandoverNote: 'Clés', departureSasDoneAt: null, arrivalSasDoneAt: null, options: [{ title: 'Linge', billedUnits: 1, quantity: 1, price: 7 }], resources: [],
  // the rest of the fiche
  email: 'j@x.fr', phone: '06', totalPrice: 90, finalPrice: 90, depositAmount: 10, sourceIcalEventUid: 'u', icalOriginalSummary: 'x',
  checkoutComplement: { a: 1 }, complementAdjustment: { b: 2 }, touristTaxTotal: 4, createdAt: 'c', updatedAt: 'u',
};

function days() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT, checkInTime TEXT, checkOutTime TEXT);`);
  db.prepare("INSERT INTO clients VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO properties VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate) VALUES (7, 1, 1, '2026-10-28', '2026-10-30'), (8, 1, 1, '2026-10-26', '2026-10-28')").run();
  const controller = buildController({
    planningDaysModel: planningDaysModel.create(db),
    detailOf: (id) => ({ ...FICHE, id }),
    today: () => '2026-10-28',
    breakfastModel: { breakfastByDate: () => ({}) },
    planningOptionCardsModel: { cardsInRange: () => ({}) },
    planningAlertsModel: { alertsInRange: () => ({ arrivals: {}, departures: {} }) },
  });
  let body;
  controller.days({ user: { roles: ['admin'] }, query: { from: '2026-10-28', to: '2026-10-28' } }, { status() { return this; }, json(b) { body = b; return this; } });
  return body.days[0];
}

test('rule 22: a Planning arrival carries the card fields only, a departure the row fields only', () => {
  const day = days();
  assert.deepEqual(day.arrivals.map((a) => a.id), [7]);
  assert.deepEqual(day.departures.map((d) => d.id), [8]);
  for (const field of ['email', 'phone', 'totalPrice', 'finalPrice', 'depositAmount', 'sourceIcalEventUid', 'checkoutComplement', 'complementAdjustment', 'createdAt']) {
    assert.equal(field in day.arrivals[0], false, `arrival ${field}`);
    assert.equal(field in day.departures[0], false, `departure ${field}`);
  }
  for (const key of Object.keys(day.arrivals[0])) assert.ok([...CARD_FIELDS, 'options', 'resources'].includes(key), `arrival key ${key}`);
  for (const key of Object.keys(day.departures[0])) assert.ok(DEPARTURE_FIELDS.includes(key), `departure key ${key}`);
  assert.equal(day.departures[0].departureHandoverNote, 'Clés');
  assert.equal(day.departures[0].checkOutDone, 1);
});

test('rule 22: the lean day is lighter than the fiches it replaces', () => {
  const day = days();
  assert.ok(JSON.stringify(day).length < JSON.stringify({ a: [FICHE], d: [FICHE] }).length * 0.6);
});

test('rule 20: an occupancy row has exactly the fields it lists, nothing else', () => {
  const row = toOccupancyRow(FICHE);
  assert.deepEqual(Object.keys(row).sort(), [...OCCUPANCY_FIELDS].sort());
  assert.equal(row.checkInTime, '16:00');
});

test('rule 20: GET /reservations?view=occupancy answers occupancy rows; the plain list and reception are unchanged', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occupancy-'));
  process.env.DB_PATH = path.join(dir, 'g.db');
  process.env.GUESTFLOW_LOCAL_ENV = path.join(dir, '.env.local');
  const model = require('../models/reservationsModel');
  const controller = require('../controllers/reservationsController');
  const original = model.list;
  model.list = () => [{ ...FICHE }];
  const ask = (query, user) => { let body; controller.list({ query, user }, { json: (b) => { body = b; return b; } }); return body; };
  try {
    assert.deepEqual(Object.keys(ask({ view: 'occupancy' }, { roles: ['admin'] })[0]).sort(), [...OCCUPANCY_FIELDS].sort());
    assert.ok('email' in ask({}, { roles: ['admin'] })[0]);
    assert.equal('email' in ask({ view: 'occupancy' }, { roles: ['reception'] })[0], false, 'reception keeps its own finance-free view');
    assert.ok(Object.keys(ask({ view: 'occupancy' }, { roles: ['reception'] })[0]).length > OCCUPANCY_FIELDS.length);
  } finally {
    model.list = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 22: the card and row projections are the same functions the upcoming page uses', () => {
  assert.equal(toArrivalCard(FICHE).id, 7);
  assert.equal(toDepartureRow(FICHE).id, 7);
});

test('rule 20: every field MiniPlanningStrip reads of a stay is in the occupancy row (read from the component)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'client', 'src', 'components', 'MiniPlanningStrip.jsx'), 'utf8');
  // The stays of the list are the ones named `…Res`, `reservation` and `r` there.
  const reads = new Set([...source.matchAll(/\b(?:\w*Res|reservation|r)\??\.([A-Za-z]+)/g)].map((m) => m[1]));
  assert.ok(reads.size >= 6, `the component reads ${[...reads].join(', ')}`);
  for (const field of ['platform', 'firstName', 'lastName', 'startDate', 'endDate', 'propertyId', 'id']) assert.ok(reads.has(field), `the pin finds ${field}`);
  for (const field of reads) assert.ok(OCCUPANCY_FIELDS.includes(field), `MiniPlanningStrip reads ${field}, which the occupancy row lacks`);
});
