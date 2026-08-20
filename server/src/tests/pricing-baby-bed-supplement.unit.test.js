const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');

// specs/baby-bed-supplement.md — the engine derives ONE option line from `reservations.babyBeds`:
// 5 € per cot, for the whole stay, on every channel. It inherits the offered / Complément / locked
// handling of the other engine-derived options, and it never touches a booking taken before the
// supplement existed (§3.3).

const BABY_BED_OPTION_ID = 30;

function createDb({ price = 5, propertyPrice = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', babyBeds INTEGER);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER, totalPrice REAL);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled)
    VALUES (?, 'Lit bébé', 'per_stay', ?, 'baby_bed', 1)`).run(BABY_BED_OPTION_ID, price);
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (20, 'Ménage', 'per_stay', 80)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(BABY_BED_OPTION_ID);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20)').run();
  if (propertyPrice != null) {
    db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, ?, ?)')
      .run(BABY_BED_OPTION_ID, propertyPrice);
  }
  return db;
}

const BASE = {
  propertyId: 1, adults: 2, children: 0, teens: 0, babies: 1,
  checkInTime: '15:00', checkOutTime: '10:00',
  startDate: '2026-05-01', endDate: '2026-05-04', // 3 nights × 100 € = 300 €
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const cotLine = (q) => q.optionLines.find((l) => Number(l.optionId) === BABY_BED_OPTION_ID);

test('two cots add one 10 € line to a direct booking', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 2, platform: 'direct' });
  const line = cotLine(q);
  assert.equal(line.title, 'Lit bébé');
  assert.equal(line.quantity, 2);
  assert.equal(line.billedUnits, 2);
  assert.equal(line.unitPrice, 5);
  assert.equal(line.totalPrice, 10);
  assert.equal(q.optionsTotal, 10);
  assert.equal(q.finalPrice, 310, '300 € of nights + 10 € of cots');
  db.close();
});

test('the price does not depend on the stay length — 5 € per cot, 2 nights or 10', () => {
  const db = createDb();
  const short = calculateReservationQuote({ ...BASE, db, babyBeds: 1, endDate: '2026-05-03' });
  const long = calculateReservationQuote({ ...BASE, db, babyBeds: 1, endDate: '2026-05-11' });
  assert.equal(cotLine(short).totalPrice, 5);
  assert.equal(cotLine(long).totalPrice, 5);
  db.close();
});

test('no cot on the booking → no line at all', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 0 });
  assert.equal(cotLine(q), undefined);
  assert.equal(q.optionsTotal, 0);
  assert.equal(q.finalPrice, 300);
  db.close();
});

test('a caller that does not know about cots prices exactly as before', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db }); // no babyBeds input at all
  assert.equal(cotLine(q), undefined);
  assert.equal(q.finalPrice, 300);
  db.close();
});

test('a per-property price overrides the catalogue one', () => {
  const db = createDb({ propertyPrice: 8 });
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 2 });
  assert.equal(cotLine(q).unitPrice, 8);
  assert.equal(cotLine(q).totalPrice, 16);
  db.close();
});

test('a per-property price of 0 opts the logement out — no line, no 0,00 € row', () => {
  const db = createDb({ propertyPrice: 0 });
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 2 });
  assert.equal(cotLine(q), undefined);
  assert.equal(q.finalPrice, 300);
  db.close();
});

test('on a platform reservation the cot lands in the Complément, collected on site', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 1, platform: 'Airbnb' });
  assert.equal(cotLine(q).totalPrice, 5);
  assert.equal(cotLine(q).inComplement, 1);
  db.close();
});

test('« Offrir » zeroes the line while keeping its real price visible', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, babyBeds: 2, offeredOptionIds: [BABY_BED_OPTION_ID],
  });
  const line = cotLine(q);
  assert.equal(line.offered, true);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.originalTotalPrice, 10, 'the geste commercial keeps showing what it is worth');
  assert.equal(q.finalPrice, 300);
  db.close();
});

test('a booking sold before the supplement existed never gets the line (§3.3 rule 10)', () => {
  const db = createDb();
  db.prepare('INSERT INTO reservations (id, babyBeds) VALUES (1, 2)').run(); // stored cots, no line
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 2, bookingId: 1 });
  assert.equal(cotLine(q), undefined);
  assert.equal(q.finalPrice, 300, 'the total the guest was quoted cannot move');
  db.close();
});

test('…even when the operator raises the cot count on that booking (rule 10)', () => {
  const db = createDb();
  db.prepare('INSERT INTO reservations (id, babyBeds) VALUES (1, 1)').run();
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 3, bookingId: 1 });
  assert.equal(cotLine(q), undefined);
  db.close();
});

test('a booking stored with NO cot bills the one added afterwards (rule 11)', () => {
  const db = createDb();
  db.prepare('INSERT INTO reservations (id, babyBeds) VALUES (1, 0)').run();
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 1, bookingId: 1 });
  assert.equal(cotLine(q).totalPrice, 5);
  db.close();
});

test('once the line exists it follows the current count (rule 12)', () => {
  const db = createDb();
  db.prepare('INSERT INTO reservations (id, babyBeds) VALUES (1, 2)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (1, ?, 2, 10)')
    .run(BABY_BED_OPTION_ID);
  const q = calculateReservationQuote({ ...BASE, db, babyBeds: 3, bookingId: 1 });
  assert.equal(cotLine(q).quantity, 3);
  assert.equal(cotLine(q).totalPrice, 15);
  db.close();
});

test('a saved booking keeps the unit price it was sold at when the catalogue moves (§3.4)', () => {
  const db = createDb({ price: 9 }); // the catalogue is at 9 € today…
  const q = calculateReservationQuote({
    ...BASE, db, babyBeds: 2, bookingId: 1,
    // …but the booking was sold at 5 €, and its snapshot says so.
    lockedOptionLines: [{ optionId: BABY_BED_OPTION_ID, quantity: 1, billedUnits: 1, unitPrice: 5, totalPrice: 5 }],
  });
  assert.equal(cotLine(q).unitPrice, 5);
  assert.equal(cotLine(q).totalPrice, 10, 'frozen price × the current count');
  db.close();
});

test('the cot is never billed twice when a caller also sends it as a chosen option', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, babyBeds: 2,
    selectedOptions: [{ optionId: BABY_BED_OPTION_ID, quantity: 7 }],
  });
  const lines = q.optionLines.filter((l) => Number(l.optionId) === BABY_BED_OPTION_ID);
  assert.equal(lines.length, 1, 'one line, whatever the payload claims');
  db.close();
});

test('the other options are untouched by the supplement', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, babyBeds: 1, selectedOptions: [{ optionId: 20, quantity: 1 }],
  });
  assert.equal(q.optionLines.find((l) => Number(l.optionId) === 20).totalPrice, 80);
  assert.equal(cotLine(q).totalPrice, 5);
  assert.equal(q.optionsTotal, 85);
  db.close();
});
