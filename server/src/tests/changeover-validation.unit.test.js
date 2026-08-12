const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { resolveChangeover, checkChangeover } = require('../utils/changeover');
const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.4 rules 21-24 — arrival resolved on the FIRST night, departure on
// the LAST night; per-range override wins over the season default; unrestricted by default; the quote
// exposes the breach beside the min-nights fields. (2026-08-15 is a samedi.)

const SAT = 6; const SUN = 0; const WED = 3;

const rule = (over = {}) => ({
  id: 1, pricePerNight: 100, pricingMode: 'fixed',
  dateRanges: JSON.stringify([{ startDate: '2026-08-01', endDate: '2026-08-31' }]),
  changeoverArrival: null, changeoverDeparture: null, ...over,
});

test('unrestricted by default: no rule constraint → never breached', () => {
  const out = checkChangeover([rule()], '2026-08-12', '2026-08-14');
  assert.equal(out.breached, false);
  assert.equal(out.requiredArrivalWeekday, null);
  assert.equal(out.requiredDepartureWeekday, null);
});

test('Saturday-to-Saturday: a Saturday week passes, a Wednesday arrival breaches', () => {
  const rules = [rule({ changeoverArrival: SAT, changeoverDeparture: SAT })];
  const ok = checkChangeover(rules, '2026-08-15', '2026-08-22'); // sam → sam
  assert.equal(ok.breached, false);
  const bad = checkChangeover(rules, '2026-08-12', '2026-08-19'); // mer → mer
  assert.equal(bad.breached, true);
  assert.equal(bad.arrivalBreached, true);
  assert.equal(bad.departureBreached, true);
  assert.equal(bad.requiredArrivalDayLabel, 'samedi');
});

test('departure weekday applies to the CHECKOUT date, resolved on the last night', () => {
  const rules = [rule({ changeoverDeparture: SUN })];
  // 2026-08-15 (sam) → 2026-08-16 (dim): last night sam 15, checkout dimanche → OK.
  assert.equal(checkChangeover(rules, '2026-08-15', '2026-08-16').breached, false);
  // checkout samedi → breach.
  assert.equal(checkChangeover(rules, '2026-08-14', '2026-08-15').departureBreached, true);
});

test('a stay spanning two seasons takes the arrival rule from the first, the departure from the last', () => {
  const rules = [
    { id: 1, pricePerNight: 100, dateRanges: JSON.stringify([{ startDate: '2026-08-01', endDate: '2026-08-15' }]), changeoverArrival: SAT, changeoverDeparture: SAT },
    { id: 2, pricePerNight: 120, dateRanges: JSON.stringify([{ startDate: '2026-08-16', endDate: '2026-08-31' }]), changeoverArrival: WED, changeoverDeparture: WED },
  ];
  // Arrive sam 15/08 (season 1 wants samedi ✓), leave mer 19/08 (last night 18/08 in season 2, wants mercredi ✓).
  const out = checkChangeover(rules, '2026-08-15', '2026-08-19');
  assert.equal(out.breached, false);
  assert.equal(out.requiredArrivalWeekday, SAT);
  assert.equal(out.requiredDepartureWeekday, WED);
});

test('per-range override wins over the season default, blank inherits', () => {
  const rules = [{
    id: 1, pricePerNight: 100, changeoverArrival: SAT,
    dateRanges: JSON.stringify([
      { startDate: '2026-08-01', endDate: '2026-08-15', changeoverArrival: WED },
      { startDate: '2026-08-16', endDate: '2026-08-31' },
    ]),
  }];
  assert.equal(resolveChangeover(rules, '2026-08-12', '2026-08-14').requiredArrivalWeekday, WED); // override
  assert.equal(resolveChangeover(rules, '2026-08-22', '2026-08-24').requiredArrivalWeekday, SAT); // inherit
});

test('the quote exposes the breach beside the min-nights fields', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1,
      changeoverArrival INTEGER, changeoverDeparture INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges, changeoverArrival)
    VALUES (1, 1, 100, '[{"startDate":"2026-08-01","endDate":"2026-08-31"}]', 6)`).run();

  const q = calculateReservationQuote({
    propertyId: 1, db, startDate: '2026-08-12', endDate: '2026-08-14',
    checkInTime: '16:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
    selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  });
  assert.equal(q.changeoverBreached, true);
  assert.equal(q.changeoverArrivalBreached, true);
  assert.equal(q.changeoverDepartureBreached, false);
  assert.equal(q.requiredArrivalDayLabel, 'samedi');
  // The price is still computed — the breach is a save-time guard, not a quote failure.
  assert.equal(q.finalPrice, 200);
  db.close();
});
