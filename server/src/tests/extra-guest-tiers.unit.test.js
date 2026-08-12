const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  normalizeExtraGuestTiers, resolveTierPrice, totalForNights, describeExtraGuestTiers,
} = require('../utils/extraGuestTiers');
const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-events-and-extra-guest-tiers/spec.md §3.1 — the extra-guest supplement as a per-night
// tier table: 15 € the first night, 8 € from the second, carried forward for ever after.

const AVENTURA = [{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }];

test('the tier table prices each night by its rank in the stay', () => {
  assert.equal(resolveTierPrice(AVENTURA, 1), 15);
  assert.equal(resolveTierPrice(AVENTURA, 2), 8);
  assert.equal(resolveTierPrice(AVENTURA, 3), 8);
});

test('the last tier carries forward — night 12 costs what night 2 costs', () => {
  assert.equal(resolveTierPrice(AVENTURA, 12), 8);
  assert.equal(resolveTierPrice(AVENTURA, 365), 8);
});

test('a three-tier table applies each band', () => {
  const tiers = [{ fromNight: 1, price: 20 }, { fromNight: 3, price: 12 }, { fromNight: 6, price: 5 }];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => resolveTierPrice(tiers, n)), [20, 20, 12, 12, 12, 5, 5]);
});

test('totals: 1 night 15 €, 2 nights 23 €, 7 nights 63 € per guest', () => {
  assert.equal(totalForNights(AVENTURA, 1), 15);
  assert.equal(totalForNights(AVENTURA, 2), 23);
  assert.equal(totalForNights(AVENTURA, 7), 63);
  assert.equal(totalForNights(AVENTURA, 7, 3), 189, 'three extra guests on a week');
});

test('no tiers, empty list, or garbage → null, so the single price keeps applying', () => {
  assert.equal(resolveTierPrice(null, 1), null);
  assert.equal(resolveTierPrice([], 1), null);
  assert.equal(resolveTierPrice([{ fromNight: 0, price: 9 }], 1), null, 'night 0 does not exist');
  assert.equal(resolveTierPrice([{ fromNight: 1.5, price: 9 }], 1), null);
  assert.equal(resolveTierPrice([{ fromNight: 1, price: -3 }], 1), null, 'a negative price is not a discount');
  assert.equal(resolveTierPrice([{ price: 9 }], 1), null);
});

test('unordered input is sorted, and a duplicate night keeps the last declaration', () => {
  assert.deepEqual(
    normalizeExtraGuestTiers([{ fromNight: 3, price: 5 }, { fromNight: 1, price: 15 }]),
    [{ fromNight: 1, price: 15 }, { fromNight: 3, price: 5 }],
  );
  assert.deepEqual(
    normalizeExtraGuestTiers([{ fromNight: 1, price: 15 }, { fromNight: 1, price: 12 }]),
    [{ fromNight: 1, price: 12 }],
  );
});

test('a table that does not start at night 1 still prices night 1 (hand-edited row guard)', () => {
  assert.equal(resolveTierPrice([{ fromNight: 4, price: 6 }], 1), 6);
});

test('the phrased rule is built server-side', () => {
  assert.equal(describeExtraGuestTiers(AVENTURA), '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  assert.equal(describeExtraGuestTiers([{ fromNight: 1, price: 9 }]), '9,00 €/nuit');
  assert.equal(
    describeExtraGuestTiers([{ fromNight: 1, price: 20 }, { fromNight: 3, price: 12 }]),
    '20,00 € de la 1ʳᵉ à la 2ᵉ nuit, puis 12,00 €/nuit',
  );
  assert.equal(describeExtraGuestTiers([]), null);
});

// ── The engine ────────────────────────────────────────────────────────────────
// A high season at 247 € with the Aventura discount curve, so the ratio the tiers REPLACE is a real
// one: without the tier branch, night 2 would be billed 8 × 0,52 = 4,16 € instead of 8 €.

function createDb({ tiers = AVENTURA, extraGuestPrice = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 27, extraGuestPriceUnit TEXT DEFAULT 'per_night');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 247,
      pricingMode TEXT DEFAULT 'progressive', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER,
      extraGuestPrice REAL, extraGuestTiers TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  // The document's cumulative table converted to marginal night prices, high season (247 €).
  const marginal = JSON.stringify([
    { nightNumber: 2, extraNightPrice: 128.44 }, { nightNumber: 3, extraNightPrice: 121.03 },
    { nightNumber: 4, extraNightPrice: 116.09 }, { nightNumber: 5, extraNightPrice: 116.09 },
    { nightNumber: 6, extraNightPrice: 116.09 }, { nightNumber: 7, extraNightPrice: 106.21 },
  ]);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, pricingMode, progressiveTiers, dateRanges, extraGuestPrice, extraGuestTiers)
    VALUES (1, 1, 247, 'progressive', ?, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]', ?, ?)`)
    .run(marginal, extraGuestPrice, tiers ? JSON.stringify(tiers) : null);
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '', selectedOptions: [],
};

test('5 guests (3 extra): 45 € for 1 night, 69 € for 2, 189 € for 7', () => {
  const db = createDb();
  const q = (nights) => calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-07-01',
    endDate: `2026-07-${String(1 + nights).padStart(2, '0')}`,
  });
  assert.equal(q(1).extraGuestSurcharge, 45);
  assert.equal(q(2).extraGuestSurcharge, 69, 'night 2 is a full 8 €, NOT 8 × 0,52');
  assert.equal(q(7).extraGuestSurcharge, 189);
  db.close();
});

test('the quote carries the phrased rule for the summary', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-07-01', endDate: '2026-07-03' });
  assert.equal(q.extraGuestTiersLabel, '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  assert.deepEqual(q.extraGuestTiers, AVENTURA);
  db.close();
});

test('the tiers beat a per-season single price — the season override does not shadow them', () => {
  const db = createDb({ extraGuestPrice: 27 });
  const q = calculateReservationQuote({ ...BASE, db, adults: 3, startDate: '2026-07-01', endDate: '2026-07-03' });
  assert.equal(q.extraGuestSurcharge, 23, '15 + 8 for the single extra guest');
  db.close();
});

test('without tiers the season keeps its ratio-scaled single price (non-regression)', () => {
  const db = createDb({ tiers: null, extraGuestPrice: 27 });
  const q = calculateReservationQuote({ ...BASE, db, adults: 5, startDate: '2026-07-01', endDate: '2026-07-08' });
  assert.equal(q.extraGuestSurcharge, 311.85, 'the pre-tier arithmetic, unchanged');
  assert.equal(q.extraGuestTiers, null);
  assert.equal(q.extraGuestTiersLabel, null);
  db.close();
});

test('no extra guest → no supplement, tiers or not', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 2, startDate: '2026-07-01', endDate: '2026-07-08' });
  assert.equal(q.extraGuestSurcharge, 0);
  db.close();
});

test('a per_stay property never sees a tier', () => {
  const db = createDb();
  db.prepare("UPDATE properties SET extraGuestPriceUnit = 'per_stay', extraGuestPrice = 40").run();
  const q = calculateReservationQuote({ ...BASE, db, adults: 4, startDate: '2026-07-01', endDate: '2026-07-08' });
  assert.equal(q.extraGuestSurcharge, 80, '2 extra × 40 € flat');
  db.close();
});
