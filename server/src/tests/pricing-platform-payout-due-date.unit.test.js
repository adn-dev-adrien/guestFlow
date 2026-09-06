const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-payout-due-date.md §3.1 — end-to-end through the engine: on a NON-direct booking the
// solde is the platform's payout and falls `payoutDueDays` AFTER the departure, instead of the
// guest-facing `arrival − balanceDaysBefore`. Own channels (direct, Lodgify) are unchanged.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDueDays INTEGER DEFAULT 7, balanceDaysBefore INTEGER DEFAULT 30,
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

// A stay booked well ahead, so the guest-facing rule (arrival − 30) and the payout rule
// (departure + N) land on visibly different dates.
const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  bookingDate: '2026-03-01',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

// specs/platform-payout-due-date.md rules 4 + 5 — le solde bascule après le départ ; l'ACOMPTE, lui,
// n'est pas touché par cette règle et garde son propre calendrier (ici : une plateforme n'en prend pas).
test('a platform booking owes its solde after the departure, not a month before the arrival', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb' });
  assert.equal(q.balanceDueDate, '2026-07-22', 'departure + the default 10 days');
  assert.equal(q.depositDueDate, null, 'a platform takes no acompte by default');
  assert.equal(q.balanceAmount, 200, 'the whole stay rides the solde');
  db.close();
});

test('the platform’s own delay drives the deadline', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Booking', platformPayoutDueDays: 45 });
  assert.equal(q.balanceDueDate, '2026-08-26');
  db.close();
});

test('own channels keep the guest-facing schedule (rule 2)', () => {
  const db = createDb();
  for (const platform of ['direct', 'Lodgify']) {
    const q = calculateReservationQuote({ ...BASE, db, platform, platformPayoutDueDays: 45 });
    assert.equal(q.balanceDueDate, '2026-06-10', `${platform}: arrival − 30, payout delay ignored`);
  }
  db.close();
});

test('the deadline follows the departure when the stay moves (rule 8)', () => {
  const db = createDb();
  const moved = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-18' });
  assert.equal(moved.balanceDueDate, '2026-07-28');
  db.close();
});

test('a devis is never put on the payout schedule (rule 3)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb', kind: 'devis', validUntil: '2026-04-01',
  });
  assert.equal(q.balanceDueDate, '2026-06-10', 'a quote owes its solde on the guest-facing schedule');
  db.close();
});

// specs/platform-payout-due-date.md rule 11
test('nothing left to collect → no deadline at all', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', customPrice: 0 });
  assert.equal(q.balanceAmount, 0);
  assert.equal(q.balanceDueDate, null);
  db.close();
});
