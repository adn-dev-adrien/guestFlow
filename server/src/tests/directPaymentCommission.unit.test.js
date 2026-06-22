const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/direct-payment-method-commission.md §3.3 — per-échéance payment-method commission on DIRECT
// reservations: commission_k = round(amount_k TTC × rate(method_k) / 100); net = finalPrice − Σ.

function createDb() {
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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  // 100 €/night × 2 = 200 TTC; depositPercent 30 → deposit 60, balance 140.
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12',
  checkInTime: '15:00',
  checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
};

// Method 1 = Virement 0 % (default), Method 2 = CB 1,5 %, Method 3 = SumUp 1,75 % (with VAT account).
const RATES = {
  1: { rate: 0, account: null, hasVat: false },
  2: { rate: 1.5, account: '622600', hasVat: false },
  3: { rate: 1.75, account: '622610', hasVat: true },
};

test('direct: same method (CB 1,5 %) on every échéance → per-échéance commission + net', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'direct',
    paymentMethodRates: RATES, defaultPaymentMethodId: 1,
    depositPaymentMethodId: 2, balancePaymentMethodId: 2, complementPaymentMethodId: 2,
  });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.depositCommissionAmount, 0.9);   // 60 × 1.5 %
  assert.equal(q.balanceCommissionAmount, 2.1);   // 140 × 1.5 %
  assert.equal(q.complementCommissionAmount, 0);  // complément 0 → 0
  assert.equal(q.totalPaymentCommission, 3);
  assert.equal(q.paymentNetReceivedAmount, 197);  // 200 − 3
  // Invariant: net = (sum of échéances, tax included) − commissions — NOT finalPrice − commissions
  // (which would silently drop any tourist tax riding in an échéance).
  const echeanceSum = Math.round((q.depositAmount + q.balanceAmount + q.complementAmount) * 100) / 100;
  assert.equal(q.paymentNetReceivedAmount, Math.round((echeanceSum - q.totalPaymentCommission) * 100) / 100);
  db.close();
});

test('direct: mixed methods — only the CB-paid acompte carries a commission', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'direct',
    paymentMethodRates: RATES, defaultPaymentMethodId: 1,
    depositPaymentMethodId: 2, balancePaymentMethodId: 1, complementPaymentMethodId: 1,
  });
  assert.equal(q.depositCommissionAmount, 0.9);
  assert.equal(q.balanceCommissionAmount, 0);
  assert.equal(q.totalPaymentCommission, 0.9);
  assert.equal(q.paymentNetReceivedAmount, 199.1);
  db.close();
});

test('direct: unset échéance methods fall back to the catalogue default', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'direct',
    paymentMethodRates: RATES, defaultPaymentMethodId: 2, // default = CB 1,5 %
    // no per-échéance ids supplied
  });
  assert.equal(q.depositPaymentMethodId, 2);
  assert.equal(q.balancePaymentMethodId, 2);
  assert.equal(q.complementPaymentMethodId, 2);
  assert.equal(q.totalPaymentCommission, 3); // 0.9 + 2.1
  db.close();
});

test('direct: a 0 % method produces no commission and a null net (summary collapses)', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'direct',
    paymentMethodRates: RATES, defaultPaymentMethodId: 1,
    depositPaymentMethodId: 1, balancePaymentMethodId: 1, complementPaymentMethodId: 1,
  });
  assert.equal(q.totalPaymentCommission, 0);
  assert.equal(q.paymentNetReceivedAmount, null);
  db.close();
});

test('platform reservation ignores payment-method commissions entirely', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb',
    paymentMethodRates: RATES, defaultPaymentMethodId: 1,
    depositPaymentMethodId: 2, balancePaymentMethodId: 2, complementPaymentMethodId: 2,
  });
  assert.equal(q.depositCommissionAmount, 0);
  assert.equal(q.balanceCommissionAmount, 0);
  assert.equal(q.complementCommissionAmount, 0);
  assert.equal(q.totalPaymentCommission, 0);
  assert.equal(q.paymentNetReceivedAmount, null);
  assert.equal(q.depositPaymentMethodId, null);
  db.close();
});

test('direct: no rate map at all → zero commission, behaviour unchanged', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'direct' });
  assert.equal(q.totalPaymentCommission, 0);
  assert.equal(q.paymentNetReceivedAmount, null);
  assert.equal(q.depositAmount + q.balanceAmount, q.totalStayPrice);
  db.close();
});
