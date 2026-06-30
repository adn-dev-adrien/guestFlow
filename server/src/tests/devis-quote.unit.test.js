// devisQuote — the online full-payment amount for a public devis (specs/public-online-payment.md).
// SENSITIVE: the amount charged must = accommodation + options + resources + tourist tax, and must NOT
// regress when options/resources are added. The tourist tax is included EXCEPT when collected on arrival.
//
// Part A: pure logic (stubbed engine) — locks the tax decision + fallback.
// Part B: REAL pricing engine over a seeded property — verifies the actual euro amounts.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { recomputeDevisQuote, fullPaymentCents } = require('../utils/devisQuote');
const { calculateReservationQuote } = require('../utils/pricing');

// ---------- Part A: tax decision + fallback (stubbed engine) ----------

const devisStub = (over = {}) => ({ findById: () => ({ propertyId: 1, startDate: '2026-09-15', endDate: '2026-09-18', adults: 2, options: [], resources: [], ...over }) });

test('fullPaymentCents: NOT collected on arrival → charges the tax-INCLUSIVE total (totalStayPrice)', () => {
  const calc = () => ({ finalPrice: 782.40, totalStayPrice: 789.60, touristTaxCollectedOnArrival: false });
  const cents = fullPaymentCents({ database: {}, devisModel: devisStub(), calc }, 1, { finalPrice: 782.40 });
  assert.equal(cents, 78960); // 789,60 € = hébergement+options+ressources + taxe de séjour
});

test('fullPaymentCents: collected on arrival → charges finalPrice (tax excluded)', () => {
  const calc = () => ({ finalPrice: 782.40, totalStayPrice: 789.60, touristTaxCollectedOnArrival: true });
  const cents = fullPaymentCents({ database: {}, devisModel: devisStub(), calc }, 1, { finalPrice: 782.40 });
  assert.equal(cents, 78240);
});

test('fullPaymentCents: engine returns null → falls back to the stored finalPrice column', () => {
  const cents = fullPaymentCents({ database: {}, devisModel: { findById: () => null }, calc: () => null }, 1, { finalPrice: 500 });
  assert.equal(cents, 50000);
});

test('fullPaymentCents: engine throws → falls back to the stored finalPrice column (payment never blocked)', () => {
  const calc = () => { throw new Error('engine boom'); };
  const cents = fullPaymentCents({ database: {}, devisModel: devisStub(), calc }, 1, { finalPrice: 500 });
  assert.equal(cents, 50000);
});

test('recomputeDevisQuote: passes the devis options + resources to the engine (so they are priced in)', () => {
  let input = null;
  const calc = (i) => { input = i; return { finalPrice: 0, totalStayPrice: 0 }; };
  const devisModel = devisStub({ options: [{ optionId: 7, quantity: 2 }], resources: [{ resourceId: 3, quantity: 1 }] });
  recomputeDevisQuote({ database: {}, devisModel, calc }, 1);
  assert.deepEqual(input.selectedOptions, [{ optionId: 7, quantity: 2, unitPrice: undefined }]);
  assert.deepEqual(input.selectedResources, [{ resourceId: 3, quantity: 1, unitPrice: undefined, offered: false }]);
});

// ---------- Part B: real pricing engine over a seeded property ----------

function seedDb() {
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
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30,
      hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0,
      openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  // 120 €/night; tourist tax 1 €/adult/night.
  db.prepare("INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, 'Gîte test', 1)").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (7, 'Ménage', 'per_stay', 50)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 7)").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyIds) VALUES (10, 'Forfait', 1, 30, 'per_stay', '[1]')").run();
  db.prepare("INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, 10, 30)").run();
  return db;
}

// 3 nights, 2 adults → accommodation 360 ; tourist tax 1 x 2 adults x 3 nights = 6.
const STAY = { propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 2, children: 0, teens: 0, babies: 0 };
const deps = (db, devis) => ({ database: db, devisModel: { findById: () => devis }, calc: calculateReservationQuote });

test('real engine — base stay: finalPrice excl. tax, totalStayPrice = finalPrice + tourist tax', () => {
  const db = seedDb();
  const q = recomputeDevisQuote(deps(db, { ...STAY, options: [], resources: [] }), 1);
  assert.equal(q.finalPrice, 360, 'accommodation only (3 x 120), tax-exclusive');
  assert.equal(q.touristTaxTotal, 6, '1 € x 2 adultes x 3 nuits');
  assert.equal(q.totalStayPrice, 366, 'finalPrice + tourist tax');
  // The online full payment charges the tax-INCLUSIVE total.
  assert.equal(fullPaymentCents(deps(db, { ...STAY, options: [], resources: [] }), 1, { finalPrice: 360 }), 36600);
});

test('real engine — with an option: amount includes the option AND the tourist tax', () => {
  const db = seedDb();
  const devis = { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [] };
  const q = recomputeDevisQuote(deps(db, devis), 1);
  assert.equal(q.finalPrice, 410, 'accommodation 360 + option 50');
  assert.equal(q.touristTaxTotal, 6);
  assert.equal(q.totalStayPrice, 416, 'finalPrice + tax');
  assert.equal(fullPaymentCents(deps(db, devis), 1, { finalPrice: 410 }), 41600);
});

test('real engine — with a resource: amount includes the resource AND the tourist tax', () => {
  const db = seedDb();
  const devis = { ...STAY, options: [], resources: [{ resourceId: 10, quantity: 1 }] };
  const q = recomputeDevisQuote(deps(db, devis), 1);
  assert.equal(q.finalPrice, 390, 'accommodation 360 + resource 30');
  assert.equal(q.totalStayPrice, 396, 'finalPrice + tax 6');
  assert.equal(fullPaymentCents(deps(db, devis), 1, { finalPrice: 390 }), 39600);
});

test('real engine — options + resources together: full amount = accommodation + options + resources + tax (no regression)', () => {
  const db = seedDb();
  const devis = { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [{ resourceId: 10, quantity: 1 }] };
  const q = recomputeDevisQuote(deps(db, devis), 1);
  assert.equal(q.finalPrice, 440, '360 + 50 + 30');
  assert.equal(q.touristTaxTotal, 6);
  assert.equal(q.totalStayPrice, 446);
  assert.equal(fullPaymentCents(deps(db, devis), 1, { finalPrice: 440 }), 44600, 'paiement = 446,00 € (tout inclus + taxe)');
});

test('real engine — invariant: totalStayPrice is always finalPrice + touristTaxTotal', () => {
  const db = seedDb();
  for (const devis of [
    { ...STAY, options: [], resources: [] },
    { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [] },
    { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [{ resourceId: 10, quantity: 1 }] },
  ]) {
    const q = recomputeDevisQuote(deps(db, devis), 1);
    assert.equal(Math.round(q.totalStayPrice * 100), Math.round((q.finalPrice + q.touristTaxTotal) * 100));
  }
});
