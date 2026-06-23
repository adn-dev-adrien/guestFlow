const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-commission-line.md — the platform commission is operator-entered
// (`platformCommissionAmount`, €) and only applies to a non-direct platform. The engine echoes it back
// (clamped ≥ 0, 0 on direct) and returns `platformNetReceivedAmount = total séjour − commission` (null
// when no commission). The fiche summary shows « total séjour − commission = net perçu ».

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12', // 2 nights → finalPrice 200
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('platform reservation with an entered commission → echoed back + net = total séjour − commission', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', platformCommissionAmount: 35 });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.totalStayPrice, 200);
  assert.equal(q.platformCommissionAmount, 35);
  assert.equal(q.platformNetReceivedAmount, 165); // 200 − 35
  db.close();
});

test('direct reservation → no commission even with a value entered', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'direct', platformCommissionAmount: 35 });
  assert.equal(q.platformCommissionAmount, 0);
  assert.equal(q.platformNetReceivedAmount, null);
  db.close();
});

test('platform reservation with no commission entered → commission 0, net null (single-line total)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', platformCommissionAmount: '' });
  assert.equal(q.platformCommissionAmount, 0);
  assert.equal(q.platformNetReceivedAmount, null);
  db.close();
});

test('negative entered commission is clamped to 0 (no commission)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', platformCommissionAmount: -10 });
  assert.equal(q.platformCommissionAmount, 0);
  assert.equal(q.platformNetReceivedAmount, null);
  db.close();
});

test('commission with options/resources → net = full total séjour − commission', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 0 }],
    platformCommissionAmount: 40,
  });
  assert.equal(q.totalStayPrice, 250); // 200 nights + 50 option
  assert.equal(q.platformCommissionAmount, 40);
  assert.equal(q.platformNetReceivedAmount, 210); // 250 − 40
  db.close();
});

// specs/platform-per-echeance-commission.md (2026-06-22) — the acompte/solde now store the GROSS amounts
// (what the guest pays); the commission is tracked separately and booked per échéance. The « net perçu »
// = total − commission is a separate figure, no longer the stored solde.
test('platform reservation: the solde is the gross (commission tracked separately, net perçu = total − commission)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'airbnb', platformCommissionAmount: 35 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);                            // GROSS — no longer net of commission
  assert.equal(q.platformNetReceivedAmount, 165);                // 200 − 35 (separate figure)
  assert.equal(q.complementAmount, 0, 'the commission does NOT leak into the complement');
  db.close();
});

test('platform reservation: a forced-complement extra stays in the complement; the solde is the gross pre-arrival', () => {
  const db = createDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Lit', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'airbnb',
    selectedOptions: [{ optionId: 10, quantity: 1, inComplement: 1 }], // extra forced to complement
    platformCommissionAmount: 40,
  });
  assert.equal(q.totalStayPrice, 250);
  assert.equal(q.complementAmount, 50, 'the extra is the complement');
  assert.equal(q.balanceAmount, 200);                            // gross pre-arrival = 250 − 50 complement
  // The gross échéances sum to the total séjour; the commission is separate.
  assert.equal(q.balanceAmount + q.complementAmount, q.totalStayPrice);
  // Net perçu = the PRE-ARRIVAL the platform settles (200) − commission (40); the 50 complement extra is
  // collected by us on arrival, never by the platform (specs/platform-payment-entry.md — écart bug fix).
  assert.equal(q.platformNetReceivedAmount, 160);                // 200 pre-arrival − 40
  db.close();
});

test('direct reservation: the balance is untouched (no commission deducted)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'direct', platformCommissionAmount: 35 });
  assert.equal(q.platformCommissionAmount, 0);
  // Conservation: nothing is removed from a direct reservation's total.
  assert.equal(q.depositAmount + q.balanceAmount + q.complementAmount, 200);
  db.close();
});
