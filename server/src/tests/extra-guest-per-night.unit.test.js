const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { computeExtraGuestSurcharge } = require('../utils/pricing');

// specs/tariff-recipes/spec.md §3.6 rules 37-38 + §3.10 rule 55 — the per-night extra-guest
// supplement follows the season curve; the six D-cases must match to the cent. Tiers are provided
// explicitly for nights 2..7 here; the single-tier + carry-forward form is covered by
// tier-carry-forward.unit.test.js.

const RATIO = 0.70;
const tiersFor = (base) => JSON.stringify(
  [2, 3, 4, 5, 6, 7].map((n) => ({ nightNumber: n, extraNightPrice: Math.round(base * RATIO * 100) / 100 }))
);

function createDb({ perNight = true, seasonOverride = null } = {}) {
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
      extraGuestPrice REAL DEFAULT NULL);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit) VALUES (1, 'Aventura Lodge', 2, 27, ?)")
    .run(perNight ? 'per_night' : 'per_stay');
  const seasons = [
    { id: 1, label: 'Basse saison', price: 179, ranges: [
      { startDate: '2026-01-01', endDate: '2026-07-03' }, { startDate: '2026-08-29', endDate: '2026-12-31' }] },
    { id: 2, label: 'Moyenne saison', price: 216, ranges: [
      { startDate: '2026-07-04', endDate: '2026-07-10' }, { startDate: '2026-08-22', endDate: '2026-08-28' }] },
    { id: 3, label: 'Haute saison', price: 247, ranges: [{ startDate: '2026-07-11', endDate: '2026-08-21' }] },
  ];
  for (const s of seasons) {
    db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, extraGuestPrice)
      VALUES (?, 1, ?, ?, 'progressive', ?, ?, ?)`)
      .run(s.id, s.label, s.price, tiersFor(s.price), JSON.stringify(s.ranges),
        seasonOverride && seasonOverride.seasonId === s.id ? seasonOverride.price : null);
  }
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const CASES = [
  // [label, adults, children, start, end, accommodation, extraSurcharge, total]
  ['D1 2p 1n LOW', 2, 0, '2026-04-06', '2026-04-07', 179.00, 0, 179.00],
  ['D2 2p 2n LOW', 2, 0, '2026-04-06', '2026-04-08', 304.30, 0, 304.30],
  ['D3 2p 3n MID', 2, 0, '2026-07-04', '2026-07-07', 518.40, 0, 518.40],
  ['D4 4p 3n HIGH (2 adults + 2 children billed alike)', 2, 2, '2026-07-13', '2026-07-16', 592.80, 129.60, 722.40],
  ['D5 5p 7n HIGH', 5, 0, '2026-07-13', '2026-07-20', 1284.40, 421.20, 1705.60],
  ['D6 3p 2n MID', 3, 0, '2026-07-04', '2026-07-06', 367.20, 45.90, 413.10],
];

for (const [label, adults, children, startDate, endDate, accommodation, surcharge, total] of CASES) {
  test(`engine total — ${label}`, () => {
    const db = createDb();
    const q = calculateReservationQuote({ ...BASE, db, adults, children, startDate, endDate });
    assert.equal(q.baseAccommodationPrice, accommodation);
    assert.equal(q.extraGuestSurcharge, surcharge);
    assert.equal(q.finalPrice, total);
    assert.equal(q.extraGuestPriceUnit, 'per_night');
    db.close();
  });
}

test('ratio total exposed for the client label: 3 nights → 2.4, 7 nights → 5.2', () => {
  const db = createDb();
  const q3 = calculateReservationQuote({ ...BASE, db, adults: 4, startDate: '2026-07-13', endDate: '2026-07-16' });
  assert.equal(q3.extraGuestNightlyRatioTotal, 2.4);
  const q7 = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-07-13', endDate: '2026-07-20' });
  assert.equal(q7.extraGuestNightlyRatioTotal, 5.2);
  db.close();
});

test('per_stay property keeps the legacy flat surcharge (regression guarantee)', () => {
  const db = createDb({ perNight: false });
  const q = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-07-13', endDate: '2026-07-20' });
  assert.equal(q.extraGuestSurcharge, 81); // 3 × 27, no nights multiplier, no discount
  assert.equal(q.extraGuestPriceUnit, 'per_stay');
  assert.equal(q.extraGuestNightlyRatioTotal, null);
  db.close();
});

test('per-season extraGuestPrice override wins over the property unit price', () => {
  const db = createDb({ seasonOverride: { seasonId: 3, price: 30 } }); // HIGH bills 30 instead of 27
  const q = calculateReservationQuote({ ...BASE, db, adults: 3, startDate: '2026-07-13', endDate: '2026-07-15' });
  // 1 extra guest × 30 × (1 + 0.7) = 51
  assert.equal(q.extraGuestSurcharge, 51);
  db.close();
});

test('offered surcharge still zeroes the billed amount but keeps the original', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-07-13', endDate: '2026-07-20', extraGuestSurchargeOffered: true,
  });
  assert.equal(q.extraGuestSurcharge, 0);
  assert.equal(q.extraGuestSurchargeOriginal, 421.20);
  db.close();
});

test('pure helper: fixed-mode season yields ratio 1 per night (plain per-night fee)', () => {
  const rules = [{ id: 1, pricePerNight: 100, pricingMode: 'fixed', dateRanges: JSON.stringify([{ startDate: '2026-05-01', endDate: '2026-05-31' }]) }];
  const nights = [
    { date: '2026-05-01', price: 100 }, { date: '2026-05-02', price: 100 }, { date: '2026-05-03', price: 100 },
  ];
  const out = computeExtraGuestSurcharge({ unit: 'per_night', extraGuestCount: 2, propertyUnitPrice: 10, nightlyBreakdown: nights, rules });
  assert.equal(out.total, 60); // 2 × 10 × 3 nights
  assert.equal(out.ratioTotal, 3);
});
