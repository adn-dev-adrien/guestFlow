// The logement-level « Acompte » switch (specs/property-deposit-switch.md).
// `properties.depositEnabled = 0` means this property has NO acompte — direct bookings, platform
// bookings and the website alike — so the solde absorbs the whole pre-arrival total. The one thing
// the switch must never do is rewrite an acompte that was already encaissé (rule 4): that money
// produced an accounting entry, and collapsing it afterwards would desynchronise the export.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');
const devisModel = require('../models/devisModel');

// `withColumn: false` reproduces a property row read without the flag (a minimal test DB): the
// engine must then behave as if the switch were ON, so a suite that never heard of it is untouched.
function freshDb({ depositEnabled = 0, depositPercent = 30, withColumn = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      ${withColumn ? 'depositEnabled INTEGER NOT NULL DEFAULT 0,' : ''}
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
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  if (withColumn) {
    db.prepare('INSERT INTO properties (id, name, depositPercent, depositEnabled) VALUES (1, ?, ?, ?)')
      .run('Maison test', depositPercent, depositEnabled);
  } else {
    db.prepare('INSERT INTO properties (id, name, depositPercent) VALUES (1, ?, ?)')
      .run('Maison test', depositPercent);
  }
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-13', // 3 nights × 100 = 300 TTC pre-arrival
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  depositPaid: false, balancePaid: false,
  discountPercent: 0, customPrice: '',
};

test('switch ON: the acompte is the usual percentage of the pre-arrival total', () => {
  const db = freshDb({ depositEnabled: 1, depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE, db, bookingDate: '2026-03-01' });
  assert.equal(q.depositAmount, 90);
  assert.equal(q.balanceAmount, 210);
  assert.equal(q.depositDueDate, '2026-03-08');
  db.close();
});

test('switch OFF: no acompte at all — the solde absorbs the stay and the deadline disappears', () => {
  const db = freshDb({ depositEnabled: 0, depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE, db, bookingDate: '2026-03-01' });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  assert.equal(q.depositAmount + q.balanceAmount, q.finalPrice);
  assert.equal(q.depositDueDate, null, 'a deadline on a €0 line would only confuse the UI');
  assert.notEqual(q.balanceDueDate, null, 'the single payment keeps its échéance');
  db.close();
});

test('switch OFF never rewrites an acompte already encaissé (rule 4)', () => {
  const db = freshDb({ depositEnabled: 0, depositPercent: 30 });
  const q = calculateReservationQuote({
    ...BASE, db, depositPaid: true, depositAmount: 90, balanceAmount: 210,
  });
  assert.equal(q.depositAmount, 90, 'the money left the guest account and was booked');
  assert.equal(q.balanceAmount, 210);
  // And when both échéances are settled, the stored split is preserved wholesale.
  const settled = calculateReservationQuote({
    ...BASE, db, depositPaid: true, balancePaid: true, depositAmount: 90, balanceAmount: 210,
  });
  assert.equal(settled.depositAmount, 90);
  assert.equal(settled.balanceAmount, 210);
  db.close();
});

test('switch OFF outranks a manual acompte override (rule 5)', () => {
  // With the switch OFF the property page offers no acompte setting at all, so a frozen override
  // would be an amount nobody can see or explain.
  const db = freshDb({ depositEnabled: 0, depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE, db, depositAmountOverride: 120 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  db.close();
});

test('switch OFF applies to a platform that takes the acompte too (rule 6)', () => {
  const db = freshDb({ depositEnabled: 0, depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 300);
  // Same guard as the direct branch: a paid acompte stays where it is.
  const paid = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1, depositPaid: true, depositAmount: 90,
  });
  assert.equal(paid.depositAmount, 90);
  assert.equal(paid.balanceAmount, 210);
  db.close();
});

test('switch ON keeps the platform rules intact — regression', () => {
  const db = freshDb({ depositEnabled: 1, depositPercent: 30 });
  const takes = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1 });
  assert.equal(takes.depositAmount, 90);
  const doesNot = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 0 });
  assert.equal(doesNot.depositAmount, 0);
  assert.equal(doesNot.balanceAmount, 300);
  db.close();
});

test('a property row read without the column counts as ON — no suite changes behaviour', () => {
  const db = freshDb({ withColumn: false, depositPercent: 30 });
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(q.depositAmount, 90);
  assert.equal(q.balanceAmount, 210);
  db.close();
});

// Rule 8 — the legacy devis derivation, the one that re-invents a split for an old row storing
// neither depositAmount nor balanceAmount, must not resurrect an acompte the property does not have.
test('the legacy devis derivation returns no acompte when the property is disabled', () => {
  const model = devisModel.buildModel(new Database(':memory:'));
  const row = {
    finalPrice: 300, touristTaxTotal: 0, depositAmount: null, balanceAmount: null,
    startDate: '2026-07-10', createdAt: '2026-03-01', validUntil: '2026-03-31',
  };
  const off = model.resolvePaymentSchedule(row, { depositPercent: 30, depositEnabled: 0, balanceDaysBefore: 30 });
  assert.equal(off.depositAmount, 0);
  assert.equal(off.balanceAmount, 300);
  assert.equal(off.depositDueDate, null);

  const on = model.resolvePaymentSchedule(row, { depositPercent: 30, depositEnabled: 1, balanceDaysBefore: 30 });
  assert.equal(on.depositAmount, 90);
  assert.equal(on.balanceAmount, 210);
});
