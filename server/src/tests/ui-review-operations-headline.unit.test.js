// specs/ui-review-2026-10-19-operations.md rule 10 — the headline figure of a quote, what the fiche's
// sticky total bar prints below 1200 px (decision 6 of the UI/UX review).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { quoteHeadline, stayGross } = require('../utils/quoteHeadline');
const { calculateReservationQuote } = require('../utils/pricing');

test('rule 10 — a platform stay leads with « Vous percevez », the guest-paid total second', () => {
  const h = quoteHeadline({
    finalPrice: 959.39, touristTaxOriginalTotal: 28, sejourNetTotal: 829.42,
  }, { isPlatform: true });
  assert.deepEqual(h, {
    label: 'Vous percevez', amount: 829.42, secondary: { label: 'Total du séjour', amount: 987.39 },
  });
});

test('rule 10 — a direct stay leads with « Total du séjour » and no second figure', () => {
  const h = quoteHeadline({ finalPrice: 500, touristTaxOriginalTotal: 12, touristTaxTotal: 12, sejourNetTotal: 512 }, { isPlatform: false });
  assert.deepEqual(h, { label: 'Total du séjour', amount: 512, secondary: null });
});

test('rule 10 — a refund, a reduction or a tip makes a direct stay name « Total perçu »', () => {
  for (const extra of [{ refundsTotal: 40 }, { arrivalPaymentReduction: 10 }, { arrivalPaymentTip: 5 }]) {
    const h = quoteHeadline({ finalPrice: 500, touristTaxOriginalTotal: 0, sejourNetTotal: 460, ...extra }, { isPlatform: false });
    assert.equal(h.label, 'Total du séjour');
    assert.deepEqual(h.secondary, { label: 'Total perçu', amount: 460 });
  }
});

test('rule 10 — the gross is the summary\'s first line: withheld tax wins, only the SAS half of the end-of-stay', () => {
  assert.equal(stayGross({ finalPrice: 100, touristTaxOriginalTotal: 8, platformTouristTaxWithheld: 6 }), 106);
  assert.equal(stayGross({ finalPrice: 100, touristTaxOriginalTotal: 0, endOfStayComplementTotal: 50, midStayRemainingTotal: 20 }), 130);
  assert.equal(stayGross({ finalPrice: 100, touristTaxOriginalTotal: 0, endOfStayComplementTotal: 10, midStayRemainingTotal: 20 }), 100);
});

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'none',
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
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

const INPUTS = {
  propertyId: 1, startDate: '2026-09-15', endDate: '2026-09-17', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false,
};

test('rule 10 — every quote carries its headline: the net for a platform, the gross for direct', () => {
  const db = createDb();
  const direct = calculateReservationQuote({ ...INPUTS, db, platform: 'direct' });
  assert.equal(direct.headline.label, 'Total du séjour');
  assert.equal(direct.headline.amount, 200);
  const booking = calculateReservationQuote({ ...INPUTS, db, platform: 'Booking', platformCommissionAmount: 30 });
  assert.equal(booking.headline.label, 'Vous percevez');
  assert.equal(booking.headline.amount, booking.sejourNetTotal);
  assert.equal(booking.headline.amount, 170);
  assert.deepEqual(booking.headline.secondary, { label: 'Total du séjour', amount: 200 });
  db.close();
});
