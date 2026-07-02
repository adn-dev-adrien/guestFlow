// devisQuote — the online full-payment amount for a public devis (specs/public-online-payment.md).
// SENSITIVE: the guest must be charged EXACTLY the quote they agreed to — the stored finalPrice
// (accommodation + the options/resources THEY selected) + the stored tourist tax — never a fresh engine
// recompute (which can drift, e.g. auto-add a "Linge de lit" option the quote never showed). The tax is
// included EXCEPT when collected on arrival.
//
// Part A: fullPaymentCents (stubbed) — locks the agreed-amount rule, the tax decision, the anti-drift
//         guarantee, and the fallback.
// Part B: recomputeDevisQuote over the REAL pricing engine — proves the engine prices options/resources
//         and the tourist tax correctly (this is what feeds the stored devis finalPrice at creation).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { recomputeDevisQuote, fullPaymentCents } = require('../utils/devisQuote');
const { calculateReservationQuote } = require('../utils/pricing');

// ---------- Part A: agreed amount + tax decision + anti-drift + fallback ----------

// devisModel.findById returns the SAVED devis row (the amounts the guest saw); calc only feeds the
// collectedOnArrival flag.
const deps = ({ devis, onArrival = false, recomputeFinalPrice }) => ({
  database: {},
  devisModel: { findById: () => devis },
  calc: () => ({ finalPrice: recomputeFinalPrice != null ? recomputeFinalPrice : (devis && devis.finalPrice), touristTaxCollectedOnArrival: onArrival }),
});

test('charges the stored finalPrice + stored tourist tax (tax included by default)', () => {
  const devis = { finalPrice: 782.40, touristTaxTotal: 7.20 };
  assert.equal(fullPaymentCents(deps({ devis }), 1, devis), 78960); // 789,60 €
});

test('collected on arrival → charges finalPrice only (tax excluded)', () => {
  const devis = { finalPrice: 782.40, touristTaxTotal: 7.20 };
  assert.equal(fullPaymentCents(deps({ devis, onArrival: true }), 1, devis), 78240);
});

test('options + resources are already baked into the stored finalPrice → included in the charge', () => {
  const devis = { finalPrice: 440, touristTaxTotal: 6 }; // 360 + option 50 + resource 30, tax 6
  assert.equal(fullPaymentCents(deps({ devis }), 1, devis), 44600);
});

test('REGRESSION: a drifting engine recompute (auto-added option) must NOT change the charge', () => {
  // The guest agreed to 782,40 + 7,20. A recompute would add a 14 € "Linge de lit" auto-option (796,40).
  // We must still charge the agreed 789,60 — never the recompute.
  const devis = { finalPrice: 782.40, touristTaxTotal: 7.20 };
  assert.equal(fullPaymentCents(deps({ devis, recomputeFinalPrice: 796.40 }), 1, devis), 78960);
});

test('no devis found → falls back to the passed row finalPrice (payment never blocked)', () => {
  const cents = fullPaymentCents({ database: {}, devisModel: { findById: () => null }, calc: () => null }, 1, { finalPrice: 500 });
  assert.equal(cents, 50000);
});

test('no devis found → the fallback row STILL carries the tourist tax (no silent tax-free undercharge)', () => {
  // paymentRequestService now selects touristTaxTotal onto the fallback row; the tax must be charged.
  const cents = fullPaymentCents({ database: {}, devisModel: { findById: () => null }, calc: () => null }, 1, { finalPrice: 500, touristTaxTotal: 12 });
  assert.equal(cents, 51200);
});

test('engine throws (flag unknown) → defaults to tax included', () => {
  const devis = { finalPrice: 782.40, touristTaxTotal: 7.20 };
  const cents = fullPaymentCents({ database: {}, devisModel: { findById: () => devis }, calc: () => { throw new Error('boom'); } }, 1, devis);
  assert.equal(cents, 78960);
});

test('recomputeDevisQuote: passes the devis options + resources to the engine (so they are priced)', () => {
  let input = null;
  const calc = (i) => { input = i; return {}; };
  const devisModel = { findById: () => ({ propertyId: 1, startDate: '2026-09-15', endDate: '2026-09-18', adults: 2, options: [{ optionId: 7, quantity: 2 }], resources: [{ resourceId: 3, quantity: 1 }] }) };
  recomputeDevisQuote({ database: {}, devisModel, calc }, 1);
  assert.deepEqual(input.selectedOptions, [{ optionId: 7, quantity: 2, unitPrice: undefined }]);
  assert.deepEqual(input.selectedResources, [{ resourceId: 3, quantity: 1, unitPrice: undefined, offered: false }]);
});

// ---------- Part B: real pricing engine — options / resources / tourist tax ----------

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
  db.prepare("INSERT INTO properties (id, name, touristTaxPerDayPerPerson) VALUES (1, 'Gîte test', 1)").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (7, 'Ménage', 'per_stay', 50)").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, 7)").run();
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyIds) VALUES (10, 'Forfait', 1, 30, 'per_stay', '[1]')").run();
  db.prepare("INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, 10, 30)").run();
  return db;
}

const STAY = { propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 2, children: 0, teens: 0, babies: 0 };
const engineDeps = (db, devis) => ({ database: db, devisModel: { findById: () => devis }, calc: calculateReservationQuote });

test('real engine — base: finalPrice excl. tax; totalStayPrice = finalPrice + tourist tax', () => {
  const q = recomputeDevisQuote(engineDeps(seedDb(), { ...STAY, options: [], resources: [] }), 1);
  assert.equal(q.finalPrice, 360);
  assert.equal(q.touristTaxTotal, 6); // 1 € x 2 adultes x 3 nuits
  assert.equal(q.totalStayPrice, 366);
});

test('real engine — with an option: option included in finalPrice', () => {
  const q = recomputeDevisQuote(engineDeps(seedDb(), { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [] }), 1);
  assert.equal(q.finalPrice, 410); // 360 + 50
});

test('real engine — with a resource: resource included in finalPrice', () => {
  const q = recomputeDevisQuote(engineDeps(seedDb(), { ...STAY, options: [], resources: [{ resourceId: 10, quantity: 1 }] }), 1);
  assert.equal(q.finalPrice, 390); // 360 + 30
});

test('real engine — options + resources: finalPrice = accommodation + options + resources; totalStayPrice adds the tax', () => {
  const q = recomputeDevisQuote(engineDeps(seedDb(), { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [{ resourceId: 10, quantity: 1 }] }), 1);
  assert.equal(q.finalPrice, 440); // 360 + 50 + 30
  assert.equal(q.touristTaxTotal, 6);
  assert.equal(q.totalStayPrice, 446);
});

test('real engine — invariant: totalStayPrice always = finalPrice + touristTaxTotal', () => {
  const db = seedDb();
  for (const devis of [
    { ...STAY, options: [], resources: [] },
    { ...STAY, options: [{ optionId: 7, quantity: 1 }], resources: [{ resourceId: 10, quantity: 1 }] },
  ]) {
    const q = recomputeDevisQuote(engineDeps(db, devis), 1);
    assert.equal(Math.round(q.totalStayPrice * 100), Math.round((q.finalPrice + q.touristTaxTotal) * 100));
  }
});
