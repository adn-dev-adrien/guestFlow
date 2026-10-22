const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { effectiveMinNightsForDate, getRuleNightBaseForDate } = require('../utils/pricing');
const { calculateReservationQuote } = require('../utils/pricing').__test;
const { computeArrivalWindows, addDays } = require('../utils/publicArrivalWindows');
const { toPublicAvailability, toPublicQuote, perPersonPerNight } = require('../utils/publicProjections');

// specs/booking-drawer-friction.md — rules 8 (price per person), 10 (arrival windows) and 13 (night
// prices). The windows must agree with the quote's own minimum-stay rule night for night: a departure
// the calendar offers is never refused, one it hatches is always refused.

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
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1, touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, platformKey TEXT NOT NULL, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  return db;
}

function insertSeason(db, { id, label, pricePerNight, minNights, dateRanges }) {
  db.prepare('INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, minNights, dateRanges) VALUES (?, 1, ?, ?, ?, ?)')
    .run(id, label, pricePerNight, minNights, JSON.stringify(dateRanges));
}

function rulesOf(db) {
  return db.prepare('SELECT * FROM pricing_rules WHERE propertyId = 1 ORDER BY startDate').all();
}

function quote(db, startDate, endDate) {
  return calculateReservationQuote({
    db, propertyId: 1, startDate, endDate, checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 0, teens: 0, babies: 0,
    selectedOptions: [], customOptions: [], selectedResources: [],
    discountPercent: 0, customPrice: '', depositPaid: false, balancePaid: false, platform: 'direct',
  });
}

// Low season at 2 nights (319 €) with a 3-night pont on 07/05, and a July season at 4 nights (451 €).
function seasonedDb() {
  const db = createDb();
  insertSeason(db, { id: 1, label: 'Basse', pricePerNight: 319, minNights: 2, dateRanges: [
    { startDate: '2026-11-01', endDate: '2027-05-06' },
    { startDate: '2027-05-07', endDate: '2027-05-07', minNights: 3 },
    { startDate: '2027-05-08', endDate: '2027-06-30' },
  ] });
  insertSeason(db, { id: 2, label: 'Été', pricePerNight: 451, minNights: 4, dateRanges: [{ startDate: '2027-07-01', endDate: '2027-08-31' }] });
  return db;
}

function windows(db, from, to, blocked = []) {
  const rules = rulesOf(db);
  return computeArrivalWindows({
    from, to, todayIso: '2026-10-19', blockedSet: new Set(blocked),
    minNightsFor: (d) => effectiveMinNightsForDate(rules, d),
  });
}

test('effectiveMinNightsForDate: range override, season default, unpriced night', () => {
  const rules = rulesOf(seasonedDb());
  assert.equal(effectiveMinNightsForDate(rules, '2026-11-20'), 2);
  assert.equal(effectiveMinNightsForDate(rules, '2027-07-14'), 4);
  assert.equal(effectiveMinNightsForDate(rules, '2026-10-25'), null);
});

test('specs/booking-drawer-friction.md rule 10 — arrival windows: a uniform 2-night minimum gives arrival + 2', () => {
  const w = windows(seasonedDb(), '2026-11-20', '2026-11-22');
  assert.deepEqual(w, [
    { date: '2026-11-20', minNights: 2, earliestDeparture: '2026-11-22' },
    { date: '2026-11-21', minNights: 2, earliestDeparture: '2026-11-23' },
  ]);
});

test('arrival windows: a stay running into a stricter season takes its minimum (max over nights)', () => {
  const w = windows(seasonedDb(), '2027-06-29', '2027-06-30');
  // Nights 29/06 (min 2) then 30/06 (min 2) would be enough… but the 2nd night is still June:
  assert.deepEqual(w, [{ date: '2027-06-29', minNights: 2, earliestDeparture: '2027-07-01' }]);
  const into = windows(seasonedDb(), '2027-06-30', '2027-07-01');
  // 30/06 (2) + 01/07 (4) → the stay touches July → 4 nights.
  assert.deepEqual(into, [{ date: '2027-06-30', minNights: 4, earliestDeparture: '2027-07-04' }]);
});

test('arrival windows: an arrival boxed in before a booking is not offered', () => {
  // Booked 13-14/11: arriving 12/11 leaves one free night, under the 2-night minimum.
  const w = windows(seasonedDb(), '2026-11-11', '2026-11-13', ['2026-11-13', '2026-11-14']);
  assert.deepEqual(w.map((a) => a.date), ['2026-11-11']);
  assert.equal(w[0].earliestDeparture, '2026-11-13');
});

test('arrival windows: past days, blocked days and unpriced nights are never arrivals', () => {
  const w = windows(seasonedDb(), '2026-10-15', '2026-11-03', ['2026-11-01']);
  // Before 01/11 no rule prices the nights; 01/11 is blocked; 02/11 is the first arrival.
  assert.equal(w[0].date, '2026-11-02');
  assert.ok(w.every((a) => a.date >= '2026-10-19'));
});

test('arrival windows: a 3-night pont inside the season imposes 3 nights only to stays touching it', () => {
  const w = windows(seasonedDb(), '2027-05-05', '2027-05-08');
  assert.deepEqual(w.map((a) => [a.date, a.minNights, a.earliestDeparture]), [
    ['2027-05-05', 2, '2027-05-07'],
    ['2027-05-06', 3, '2027-05-09'],
    ['2027-05-07', 3, '2027-05-10'],
  ]);
});

test('rule 10 — arrival windows agree with the quote: offered departure accepted, the night before refused', () => {
  const db = seasonedDb();
  for (const a of windows(db, '2027-06-25', '2027-07-05')) {
    assert.equal(quote(db, a.date, a.earliestDeparture).minNightsBreached, false, `${a.date} → ${a.earliestDeparture}`);
    const shorter = addDays(a.earliestDeparture, -1);
    if (shorter > a.date) assert.equal(quote(db, a.date, shorter).minNightsBreached, true, `${a.date} → ${shorter}`);
  }
});

test('rule 13 — night prices: the base nightly price of the rule covering each date', () => {
  const rules = rulesOf(seasonedDb());
  assert.deepEqual(getRuleNightBaseForDate(rules, '2026-11-20').nightlyBase, 319);
  assert.deepEqual(getRuleNightBaseForDate(rules, '2027-07-14').nightlyBase, 451);
  assert.equal(getRuleNightBaseForDate(rules, '2026-10-25').matchedRule, null);
});

test('rule 8 — perPersonPerNight: total with tax over paying guests and nights, rounded to the cent', () => {
  assert.equal(perPersonPerNight(642.8, 2, 2), 160.7);
  assert.equal(perPersonPerNight(652.4, 8, 2), 40.78);
  assert.equal(perPersonPerNight(100, 3, 1), 33.33);
  assert.equal(perPersonPerNight(642.8, 0, 2), null);
  assert.equal(perPersonPerNight(642.8, 2, 0), null);
});

test('toPublicQuote carries perPersonPerNight from the engine persons (babies already excluded)', () => {
  const q = toPublicQuote(
    { propertyId: 1, nights: 2, persons: 8, totalStayPrice: 652.4, finalPrice: 638, totalPrice: 638 },
    { available: true, startDate: '2026-11-20', endDate: '2026-11-22' },
  );
  assert.equal(q.perPersonPerNight, 40.78);
  assert.equal(q.totalStayPrice, 652.4);
  const empty = toPublicQuote({ propertyId: 1, nights: 0, persons: 2 }, { available: true, startDate: 'x', endDate: 'x' });
  assert.equal(empty.perPersonPerNight, null);
});

test('rules 10 + 13 — toPublicAvailability keeps its original fields and adds arrivals and nightPrices', () => {
  const a = toPublicAvailability({
    propertyId: 1, from: '2026-11-01', to: '2026-11-30', blockedDates: ['2026-11-07', '2026-11-06'],
    arrivals: [{ date: '2026-11-20', minNights: 2, earliestDeparture: '2026-11-22' }],
    nightPrices: [{ date: '2026-11-20', price: '319' }],
  });
  assert.deepEqual(a.blockedDates, ['2026-11-06', '2026-11-07']);
  assert.deepEqual(a.blockedRanges, [{ start: '2026-11-06', end: '2026-11-07' }]);
  assert.deepEqual(a.arrivals, [{ date: '2026-11-20', minNights: 2, earliestDeparture: '2026-11-22' }]);
  assert.deepEqual(a.nightPrices, [{ date: '2026-11-20', price: 319 }]);
  const legacy = toPublicAvailability({ propertyId: 1, from: 'a', to: 'b', blockedDates: [] });
  assert.deepEqual(legacy.arrivals, []);
  assert.deepEqual(legacy.nightPrices, []);
});
