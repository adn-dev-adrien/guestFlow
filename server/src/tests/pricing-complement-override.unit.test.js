/**
 * specs/adjustable-complement-amounts.md §3.2 — le montant annoncé au client l'emporte sur le calcul,
 * y compris sur un complément déjà encaissé, sans jamais rouvrir la porte que
 * specs/frozen-complement-trusts-client.md a fermée (le `complementAmount` CALCULÉ par le navigateur
 * reste ignoré sur un bucket gelé).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once', planningCardDate TEXT, planningCardTimes TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (9, 'Linge de toilette', 'per_stay', 24)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 9)').run();
  return db;
}

// 2 nuits × 100 € + un linge de toilette à 24 € forcé au complément.
const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  platform: 'direct', depositPaid: true, balancePaid: true,
  depositAmount: 60, balanceAmount: 140,
  selectedOptions: [{ optionId: 9, quantity: 1, inComplement: 1 }],
};

const quote = (extra) => calculateReservationQuote({ ...BASE, db: createDb(), ...extra });

test('règle 3 — pas d\'ajustement : le complément calculé ne bouge pas', () => {
  const q = quote({});
  assert.equal(q.complementAmount, 24);
  assert.equal(q.complementAmountAuto, 24);
});

test('règle 13 — l\'ajustement gagne sur les lignes forcées', () => {
  const q = quote({ complementAmountOverride: 20 });
  assert.equal(q.complementAmount, 20);
  assert.equal(q.complementAmountAuto, 24, 'le calcul auto reste exposé pour l\'aide du champ');
});

test('règles 6 + 13 — l\'ajustement gagne AUSSI sur un complément gelé', () => {
  const frozen = quote({ complementPaid: true, complementAmount: 24 });
  assert.equal(frozen.complementAmount, 24);
  const adjusted = quote({ complementPaid: true, complementAmount: 24, complementAmountOverride: 20 });
  assert.equal(adjusted.complementAmount, 20);
});

test('règle 14 — sans ajustement, le montant CALCULÉ envoyé par le client reste ignoré (gelé)', () => {
  // frozen-complement-trusts-client : sur un bucket gelé le moteur reprend le montant STOCKÉ qu'on lui
  // passe. Ici on lui passe le montant stocké 24 : ajouter une ligne ne le gonfle pas.
  const q = quote({ complementPaid: true, complementAmount: 24, selectedOptions: [{ optionId: 9, quantity: 2, inComplement: 1 }] });
  assert.equal(q.complementAmount, 24);
});

test('règle 4 — ajouter une option après l\'ajustement ne déplace pas le complément', () => {
  const q = quote({ complementAmountOverride: 20, selectedOptions: [{ optionId: 9, quantity: 2, inComplement: 1 }] });
  assert.equal(q.complementAmount, 20);
  assert.equal(q.complementAmountAuto, 48);
});

test('un ajustement négatif est ramené à 0 (le validateur le refuse déjà en amont)', () => {
  assert.equal(quote({ complementAmountOverride: -5 }).complementAmount, 0);
});

test('un ajustement vide / illisible laisse le calcul auto', () => {
  assert.equal(quote({ complementAmountOverride: '' }).complementAmount, 24);
  assert.equal(quote({ complementAmountOverride: null }).complementAmount, 24);
  assert.equal(quote({ complementAmountOverride: 'abc' }).complementAmount, 24);
});

test('règle 15 — le split des trois buckets somme toujours au même total après ajustement', () => {
  const q = quote({ complementAmountOverride: 20, stayStarted: false });
  const s = q.complementSplit;
  assert.equal(Math.round((s.arrival + s.duringStay + s.endOfStay) * 100) / 100, 20);
});

test('specs/defer-arrival-complement-to-checkout §3.3 règle 16 — le marqueur bascule le split avant le séjour', () => {
  const before = quote({ stayStarted: false });
  assert.equal(before.complementSplit.arrival, 24);
  const deferred = quote({ stayStarted: false, complementDeferredToCheckout: true });
  assert.equal(deferred.complementSplit.arrival, 0);
  assert.equal(deferred.complementSplit.endOfStay, 24);
});
