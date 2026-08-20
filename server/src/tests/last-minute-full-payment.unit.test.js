// specs/deposit-blocks-the-dates.md §3.2 (implementing specs/online-payments-qonto.md §3.7) — a direct
// stay starting inside the property's solde window has no acompte: the guest owes ONE payment. Every
// explicit intent above the rule (paid, disabled, hand-set acompte, platform) keeps precedence.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { isLastMinuteStay, resolveBalanceDueDate } = require('../utils/paymentSchedule');

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
  db.prepare("INSERT INTO properties (id, name, depositPercent) VALUES (1, 'Gite', 30)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

// 2 nights × 100 € = 200 €. The stay dates move per test; the booking day stays put.
const BASE = {
  propertyId: 1, bookingDate: '2026-03-01',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false, platform: 'direct',
};

// Stay dates relative to the 2026-03-01 booking day.
const AHEAD    = { startDate: '2026-04-01', endDate: '2026-04-03' }; // 31 days out
const ON_EDGE  = { startDate: '2026-03-31', endDate: '2026-04-02' }; // exactly 30 days out
const IMMINENT = { startDate: '2026-03-11', endDate: '2026-03-13' }; // 10 days out

// ── The pure predicate ───────────────────────────────────────────────────────

test('isLastMinuteStay: the threshold is inclusive, and an unusable date never triggers it', () => {
  const at = (startDate) => isLastMinuteStay({ bookingDate: '2026-03-01', startDate, balanceDaysBefore: 30 });
  assert.equal(at('2026-04-01'), false, '31 days out — there is time to collect an acompte');
  assert.equal(at('2026-03-31'), true, 'exactly 30 days out is last-minute (spec §3.7 edge case)');
  assert.equal(at('2026-03-11'), true, '10 days out');
  assert.equal(isLastMinuteStay({ startDate: '2026-03-11', balanceDaysBefore: 30 }), false, 'no booking date → no switch');
  assert.equal(isLastMinuteStay({ bookingDate: '2026-03-01', balanceDaysBefore: 30 }), false, 'no start date → no switch');
  assert.equal(isLastMinuteStay({ bookingDate: '2026-03-01', startDate: '2026-03-11' }), true, 'defaults to the 30-day policy');
});

// ── The engine ───────────────────────────────────────────────────────────────

test('a stay booked with time to spare keeps its acompte', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...AHEAD, db });
  assert.equal(q.depositAmount, 60, '30 % of 200 €');
  assert.equal(q.balanceAmount, 140);
  db.close();
});

test('a stay starting inside the solde window owes one payment, not an acompte + a solde', () => {
  const db = createDb();
  for (const [label, dates] of [['on the threshold', ON_EDGE], ['well inside', IMMINENT]]) {
    const q = calculateReservationQuote({ ...BASE, ...dates, db });
    assert.equal(q.depositAmount, 0, `${label}: no acompte`);
    assert.equal(q.balanceAmount, 200, `${label}: the whole pre-arrival total in one payment`);
    assert.equal(q.depositDueDate, null, `${label}: no deadline for money nobody owes`);
  }
  db.close();
});

test('without a booking date the engine cannot know, and leaves the split alone', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...IMMINENT, db, bookingDate: null });
  assert.equal(q.depositAmount, 60, 'a stateless quote keeps the historic derivation');
  db.close();
});

test('an acompte already paid is never taken away by the rule', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...IMMINENT, db, depositPaid: true, depositAmount: 60, balanceAmount: 140,
  });
  assert.equal(q.depositAmount, 60, 'collected money is frozen, whatever the dates say');
  assert.equal(q.balanceAmount, 140);
  db.close();
});

test('an acompte set by hand wins over the rule — the operator decides', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...IMMINENT, db, depositAmountOverride: 50 });
  assert.equal(q.depositAmount, 50);
  assert.equal(q.balanceAmount, 150);
  db.close();
});

test('a platform booking is untouched: no acompte before, no acompte after, payout schedule intact', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...IMMINENT, db, platform: 'Airbnb' });
  assert.equal(q.depositAmount, 0, 'a platform takes no acompte, as before');
  assert.equal(q.balanceAmount, 200);
  assert.equal(q.balanceDueDate, '2026-03-23', 'departure + the 10-day payout delay, not a quote date');
  db.close();
});

// ── The deadline of the single payment (rule 7) ──────────────────────────────

test('a last-minute DEVIS owes its single payment on its validity date', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...IMMINENT, db, kind: 'devis', validUntil: '2026-03-09',
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceDueDate, '2026-03-09', 'the day up to which the quote promises the dates');
  db.close();
});

test('a devis that still carries an acompte keeps the stay-relative solde date', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...AHEAD, db, kind: 'devis', validUntil: '2026-03-09',
  });
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceDueDate, '2026-03-02', 'arrival − 30 days, unchanged');
  db.close();
});

test('a last-minute RESERVATION owes it on the solde date, clamped to the booking day', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...IMMINENT, db });
  assert.equal(q.balanceDueDate, '2026-03-01', 'the clamp: never before the day it was booked');
  db.close();
});

test('resolveBalanceDueDate: the validity date only applies when the caller asks for it', () => {
  const args = { hasBalance: true, startDate: '2026-03-11', bookingDate: '2026-03-01', validUntil: '2026-03-09' };
  assert.equal(resolveBalanceDueDate({ ...args, dueOnValidUntil: true }), '2026-03-09');
  assert.equal(resolveBalanceDueDate({ ...args, dueOnValidUntil: false }), '2026-03-01', 'clamped derivation');
  assert.equal(resolveBalanceDueDate({ ...args, dueOnValidUntil: true, validUntil: null }), '2026-03-01',
    'no validity date stored → fall back to the derivation rather than to nothing');
});
