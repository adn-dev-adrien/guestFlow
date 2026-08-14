/**
 * specs/devis-extras-parity-and-price-lock.md — a devis must keep everything a reservation keeps.
 *
 * Pins the five losses measured in §1: the planning-card occurrences and the hourly-resource sessions
 * used to be stripped before the engine ran (so the lines returned `null` and vanished with their
 * money), and `breakfastTime` / `extraGuestSurchargeOffered` / `touristTaxInComplement` /
 * `tariffSnapshot` were simply absent from the devis INSERT.
 *
 * The schema below is the FULL one (occurrences, sessions, routing columns) — that is the whole point:
 * these columns exist on both sides of the fusion and the devis stack must write them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');
const { calculateReservationQuote } = require('../utils/pricing');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 500,
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
    autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardFrequency TEXT, cardTimes TEXT, cardTime TEXT,
    displayToClient INTEGER NOT NULL DEFAULT 1, countsAsBedLinen INTEGER DEFAULT 0,
    countsAsBathroomLinen INTEGER DEFAULT 0, countsAsBathMat INTEGER DEFAULT 0
  );
  CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE property_option_prices ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, price REAL, freeUnits REAL DEFAULT 0, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0,
    showsPlanningCard INTEGER NOT NULL DEFAULT 0, openTime TEXT DEFAULT '09:00', closeTime TEXT DEFAULT '22:00',
    slotDuration INTEGER DEFAULT 30, minimumUsageMinutes INTEGER DEFAULT 60, hourlyEveningRate REAL, hourlyEveningStart TEXT
  );
  CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER, pdfLanguage TEXT DEFAULT 'fr',
    reservationNumber TEXT, emailLanguage TEXT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    breakfastTime TEXT, extraGuestSurchargeOffered INTEGER DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0,
    tariffSnapshot TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL DEFAULT 0, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL,
    offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL
  );
  CREATE TABLE reservation_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL,
    billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0,
    inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT
  );
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE property_option_defaults (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30);
  INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30);
`;

const CLEANING = 1;   // plain per-stay option, the control
const BREAKFAST = 2;  // planning-card option, per person per night
const NORDIC_BATH = 1; // hourly-scheduled resource

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  let serial = 0;
  db.generateDevisNumber = () => `D-TEST-${++serial}`;
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES (${CLEANING}, 'Ménage', 'per_stay', 80)`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, showsPlanningCard, cardFrequency, cardTime)
              VALUES (${BREAKFAST}, 'Petit déjeuner', 'per_person_per_night', 8, 1, 'daily', '08:30')`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?), (1, ?)').run(CLEANING, BREAKFAST);
  db.prepare(`INSERT INTO resources (id, name, quantity, price, priceType, showsPlanningCard, openTime, closeTime, slotDuration, minimumUsageMinutes)
              VALUES (${NORDIC_BATH}, 'Bain nordique', 1, 30, 'per_hour', 1, '09:00', '22:00', 30, 60)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

// The exact basket of the §1 measurement: a plain option + a scheduled breakfast + one bath session.
const OCCURRENCES = [
  { date: '2027-03-09', time: '08:30' },
  { date: '2027-03-10', time: '08:30' },
  { date: '2027-03-11', time: '08:30' },
];
const SESSIONS = [{ date: '2027-03-09', start: '18:00', end: '20:00' }];

const BASKET = {
  propertyId: 1,
  clientId: 1,
  startDate: '2027-03-08',
  endDate: '2027-03-11',
  adults: 2,
  checkInTime: '16:00',
  checkOutTime: '10:00',
  platform: 'direct',
  selectedOptions: [
    { optionId: BREAKFAST, quantity: 3, cardOccurrences: OCCURRENCES },
    { optionId: CLEANING, quantity: 1 },
  ],
  customOptions: [],
  selectedResources: [{ resourceId: NORDIC_BATH, quantity: 1, sessions: SESSIONS }],
};

// The same basket priced by the engine directly — « la vérité se trouve sur la fiche résa ».
function reservationTruth(db, overrides = {}) {
  return calculateReservationQuote({
    db,
    propertyId: 1,
    startDate: BASKET.startDate,
    endDate: BASKET.endDate,
    checkInTime: BASKET.checkInTime,
    checkOutTime: BASKET.checkOutTime,
    adults: BASKET.adults,
    children: 0,
    teens: 0,
    babies: 0,
    selectedOptions: BASKET.selectedOptions,
    customOptions: [],
    selectedResources: BASKET.selectedResources,
    platform: 'direct',
    ...overrides,
  });
}

test('a devis prices the same basket as a reservation, to the cent (rules 6-7)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASKET);
  assert.equal(created.error, undefined);

  const truth = reservationTruth(db);
  assert.equal(created.data.finalPrice, truth.finalPrice);

  const byId = new Map(created.data.options.filter((o) => !o.isCustom).map((o) => [Number(o.optionId), o]));
  assert.equal(byId.get(CLEANING).totalPrice, 80, 'plain option unchanged');
  // 3 mornings × 2 guests × 8 € — the line used to be dropped entirely.
  assert.ok(byId.has(BREAKFAST), 'the planning-card option must survive the save');
  assert.equal(byId.get(BREAKFAST).billedUnits, 6);
  assert.equal(byId.get(BREAKFAST).totalPrice, 48);
  assert.equal(created.data.resources.length, 1, 'the hourly resource must survive the save');
  // 18:00 → 20:00 = 2 h at 30 €/h; the session grid is what prices it.
  assert.equal(created.data.resources[0].totalPrice, 60);
  assert.equal(created.data.resources[0].totalPrice, truth.resourceLines[0].totalPrice);
});

test('the scheduled mornings and the booked hours are stored, not just priced (rule 12)', () => {
  const { model, db } = freshModel();
  const created = model.create(BASKET);

  const stored = db.prepare('SELECT cardOccurrences FROM reservation_options WHERE reservationId = ? AND optionId = ?')
    .get(created.data.id, BREAKFAST);
  const dates = JSON.parse(stored.cardOccurrences).map((o) => o.date);
  assert.deepEqual(dates, ['2027-03-09', '2027-03-10', '2027-03-11']);

  const resource = db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = ?').get(created.data.id);
  assert.deepEqual(JSON.parse(resource.sessions), SESSIONS);
});

test('the devis row carries breakfastTime, the offered surcharge, the tax routing and its tariff (rules 8-11)', () => {
  const { model, db } = freshModel();
  const created = model.create({
    ...BASKET,
    breakfastTime: '08:30',
    extraGuestSurchargeOffered: true,
    touristTaxInComplement: 1,
  });

  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(created.data.id);
  assert.equal(row.breakfastTime, '08:30');
  assert.equal(row.extraGuestSurchargeOffered, 1);
  assert.equal(row.touristTaxInComplement, 1);
  assert.ok(row.tariffSnapshot, 'the tariff the quote was issued under is recorded');
});

test('an update keeps the schedule and the row-level fields (rule 12)', () => {
  const { model, db } = freshModel();
  const created = model.create({ ...BASKET, breakfastTime: '08:30', extraGuestSurchargeOffered: true });

  // Re-save the devis as the fiche does: same lines, one edited field.
  const updated = model.update(created.data.id, {
    ...BASKET,
    breakfastTime: '09:15',
    extraGuestSurchargeOffered: true,
    notes: 'Arrivée tardive',
  });
  assert.equal(updated.error, undefined);

  const breakfast = updated.data.options.find((o) => Number(o.optionId) === BREAKFAST);
  assert.equal(breakfast.totalPrice, 48);
  // The API hands the fiche parsed arrays, exactly like `GET /reservations/:id` does.
  assert.equal(breakfast.cardOccurrences.length, 3);
  assert.equal(updated.data.resources[0].totalPrice, 60);

  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(created.data.id);
  assert.equal(row.breakfastTime, '09:15');
  assert.equal(row.extraGuestSurchargeOffered, 1);
});

test('on a devis an unflagged extra stays OUT of the Complément, even on a platform (rule 17)', () => {
  const { model } = freshModel();
  const created = model.create({ ...BASKET, platform: 'Airbnb' });

  for (const line of created.data.options.filter((o) => !o.isCustom)) {
    assert.equal(Number(line.inComplement || 0), 0, `${line.title} must not default into Complément on a devis`);
  }
  assert.equal(Number(created.data.resources[0].inComplement || 0), 0);
});

test('an explicit « Compl. » on a devis line is persisted (rule 18)', () => {
  const { model } = freshModel();
  const created = model.create({
    ...BASKET,
    selectedOptions: [{ optionId: CLEANING, quantity: 1, inComplement: 1 }],
    selectedResources: [],
  });

  const cleaning = created.data.options.find((o) => Number(o.optionId) === CLEANING);
  assert.equal(Number(cleaning.inComplement), 1);
});

test('converting carries the whole graph and the row fields into the reservation (rules 19-20)', () => {
  const { model, db } = freshModel();
  const created = model.create({
    ...BASKET,
    breakfastTime: '08:30',
    extraGuestSurchargeOffered: true,
    pdfLanguage: 'en',
  });

  const converted = model.convertToReservation(created.data.id);
  assert.equal(converted.error, undefined);
  const reservationId = converted.data.reservationId;

  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  assert.equal(row.kind, 'reservation');
  assert.equal(row.breakfastTime, '08:30');
  assert.equal(row.extraGuestSurchargeOffered, 1);
  assert.ok(row.tariffSnapshot, 'the reservation is sold under the tariff that was quoted');
  assert.equal(row.emailLanguage, 'en', 'an English quote makes an English reservation');

  const breakfast = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?')
    .get(reservationId, BREAKFAST);
  assert.equal(breakfast.totalPrice, 48);
  assert.equal(JSON.parse(breakfast.cardOccurrences).length, 3, 'the planning cards follow the conversion');

  const resource = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').get(reservationId);
  assert.deepEqual(JSON.parse(resource.sessions), SESSIONS, 'the booked hours follow the conversion');
});

test('a reservation turned into a devis keeps its schedule too', () => {
  const { model, db } = freshModel();
  const devis = model.create(BASKET);
  const reservationId = model.convertToReservation(devis.data.id).data.reservationId;

  const back = model.convertFromReservation(reservationId);
  assert.equal(back.error, undefined);
  const breakfast = back.data.options.find((o) => Number(o.optionId) === BREAKFAST);
  assert.equal(breakfast.cardOccurrences.length, 3);
  assert.deepEqual(back.data.resources[0].sessions, SESSIONS);
});

test('the API hands the fiche parsed arrays, like GET /reservations/:id does (§4.3)', () => {
  const { model } = freshModel();
  const created = model.create(BASKET);

  const fresh = model.findById(created.data.id);
  const breakfast = fresh.options.find((o) => Number(o.optionId) === BREAKFAST);
  // A JSON string here is what left the fiche unable to rebuild the occurrence checklist on reopen:
  // `buildGridFromStored` takes an array and silently returns an empty grid for anything else.
  assert.ok(Array.isArray(breakfast.cardOccurrences), 'cardOccurrences must arrive parsed');
  assert.equal(breakfast.cardOccurrences.length, 3);
  assert.ok(Array.isArray(fresh.resources[0].sessions), 'sessions must arrive parsed');
  assert.equal(fresh.resources[0].sessions.length, 1);
});
