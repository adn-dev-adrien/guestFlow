// specs/reservation-payment-ledger.md rule 48 (spec review of 2026-10-27, agent 3 F4) — after a price drop
// below an installment plan (direct-installments rule 8: nothing is lowered), the fiche's headline said
// « Total du séjour 415 · Total perçu 515 » stored and « 415 » live, while 172 € had been collected. The
// plan now counts for the stay (or for what it collected, when more), live and stored alike.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');
const { quoteHeadline, storedNetTotal } = require('../utils/quoteHeadline');

function engineDb() {
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
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservation_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL,
      amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore) VALUES (1, 'Maison', 30, 7)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)').run();
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-13', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  depositPaid: false, balancePaid: false, discountPercent: 0, customPrice: '', bookingDate: '2026-10-01',
};

function planOn(db, bookingId, rows) {
  rows.forEach(([amountCents, paid], i) => db.prepare(
    'INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, ?, ?, ?, ?)',
  ).run(bookingId, i + 1, `2026-1${i}-27`, amountCents, paid ? 1 : 0));
}


test('F4 — a plan above the stay after a drop: live and stored headlines agree on the stay', () => {
  const db = engineDb();
  planOn(db, 42, [[17200, true], [17200, false], [17100, false]]);
  const live = calculateReservationQuote({ ...STAY, db, bookingId: 42 });
  assert.equal(live.preArrivalAmount, 300);
  assert.equal(live.sejourNetTotal, 300, 'the plan counts for the stay, not for the 515 € it schedules');
  const stored = storedNetTotal({ finalPrice: 300, installmentsPaidAmount: 172, installmentsUnpaidAmount: 343, installmentsTarget: 300 });
  assert.equal(stored, live.sejourNetTotal);
  assert.deepEqual(quoteHeadline({ finalPrice: 300, sejourNetTotal: stored }), { label: 'Total du séjour', amount: 300, secondary: null });
});

test('F4 — money collected above the stay stays counted, live and stored', () => {
  const db = engineDb();
  planOn(db, 43, [[17200, true], [17200, true], [17100, false]]);
  const live = calculateReservationQuote({ ...STAY, db, bookingId: 43 });
  assert.equal(live.sejourNetTotal, 344);
  // Rule 33 of direct-installments — a covered plan owes nothing more: unpaid aggregate 0.
  assert.equal(storedNetTotal({ finalPrice: 300, installmentsPaidAmount: 344, installmentsUnpaidAmount: 0, installmentsTarget: 300 }), 344);
});

test('F4 — a plan without a drop is unchanged: every installment counts', () => {
  assert.equal(storedNetTotal({ finalPrice: 500, touristTaxTotal: 15, installmentsPaidAmount: 172, installmentsUnpaidAmount: 343, installmentsTarget: 515 }), 515);
  assert.equal(storedNetTotal({ finalPrice: 500, installmentsPaidAmount: 515, installmentsUnpaidAmount: 0, installmentsTarget: 515 }), 515);
});
