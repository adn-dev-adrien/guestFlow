/**
 * Un complément d'arrivée encaissé est CLOS — specs/mid-stay-extras-to-end-of-stay-complement.md
 * §3.1 rule 3 (élargi le 2026-08-22).
 *
 * Le bug de production qui a motivé la règle : sur une réservation dont le complément d'arrivée était
 * marqué encaissé, ajouter une option de 30 € montait le total du séjour de 30 € **sans qu'aucune
 * échéance ne les réclame**. Le moteur gèle un complément encaissé (il ne peut donc pas l'absorber) et
 * la base de référence des ventes en séjour n'existait que si le séjour avait commencé — entre les
 * deux, l'argent tombait dans un trou.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { create: createReservationsModel } = require('../models/reservationsModel');

function pricingDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7, defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person', touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0, basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT DEFAULT 'S', pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#000', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT DEFAULT 'once', planningCardDate TEXT, planningCardTimes TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight) VALUES (1, 1, 100)').run();
  db.prepare("INSERT INTO options (id, title, price) VALUES (9, 'Linge', 24), (12, 'Bain nordique', 30)").run();
  db.prepare('INSERT INTO property_options VALUES (1, 9), (1, 12)').run();
  return db;
}

// Séjour EN OCTOBRE (non commencé), acompte + solde + complément encaissés, 24 € de linge dans le
// complément. On ajoute ensuite un bain nordique à 30 €.
const BASE = {
  propertyId: 1, startDate: '2026-10-10', endDate: '2026-10-12',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  platform: 'direct', depositPaid: true, balancePaid: true, complementPaid: true,
  depositAmount: 60, balanceAmount: 140, complementAmount: 24,
  selectedOptions: [
    { optionId: 9, quantity: 1, inComplement: 1 },
    { optionId: 12, quantity: 1, inComplement: 1 },
  ],
};
const buckets = (q) => Math.round(
  (q.depositAmount + q.balanceAmount + q.complementAmount + q.endOfStayComplementTotal) * 100,
) / 100;

test('sans base de référence, une option vendue sur un complément encaissé ne tombe dans aucune échéance', () => {
  // Le témoin du bug : c'est l'état que produisait la version précédente (base gated sur le calendrier).
  const q = calculateReservationQuote({ ...BASE, db: pricingDb() });
  assert.equal(q.complementAmount, 24, 'le complément encaissé reste gelé');
  assert.equal(q.endOfStayComplementTotal, 0);
  assert.equal(q.totalStayPrice, 254);
  assert.equal(buckets(q), 224, '30 € vendus que personne ne réclame');
});

test('avec la base figée à l\'encaissement, les 30 € partent au complément de fin de séjour', () => {
  const q = calculateReservationQuote({
    ...BASE, db: pricingDb(), arrivalExtrasBaseline: JSON.stringify({ 'opt:9': 24 }),
  });
  assert.equal(q.complementAmount, 24);
  assert.equal(q.endOfStayComplementTotal, 30);
  assert.deepEqual(q.midStayExtrasLines.map((l) => [l.label, l.amount]), [['Bain nordique', 30]]);
  assert.equal(buckets(q), q.totalStayPrice, 'chaque euro vendu est réclamé par une échéance');
});

// ── la base est-elle posée au bon moment ? (couche modèle) ──────────────────

function modelDb({ complementPaid = 0, startDate = '2026-10-10' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      startDate TEXT, endDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidCash INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT DEFAULT NULL, midStaySettledNotes TEXT DEFAULT NULL,
      updatedAt TEXT
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0);
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL DEFAULT 0, offered INTEGER DEFAULT 0);
  `);
  db.prepare("INSERT INTO reservations (id, startDate, endDate, complementPaid) VALUES (1, ?, '2026-10-12', ?)")
    .run(startDate, complementPaid);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice) VALUES (1, 9, 24)').run();
  return db;
}
const TODAY = '2026-08-22';

test('séjour à venir, complément NON encaissé → toujours pas de base (comportement inchangé)', () => {
  const model = createReservationsModel(modelDb());
  assert.equal(model.resolveArrivalExtrasBaseline(1, TODAY), null);
  assert.equal(model.captureArrivalExtrasBaselineIfDue(1, TODAY), null);
});

test('séjour à venir mais complément ENCAISSÉ → la base existe, le bucket est clos', () => {
  const model = createReservationsModel(modelDb({ complementPaid: 1 }));
  assert.deepEqual(JSON.parse(model.resolveArrivalExtrasBaseline(1, TODAY)), { 'opt:9': 24 });
  assert.deepEqual(JSON.parse(model.captureArrivalExtrasBaselineIfDue(1, TODAY)), { 'opt:9': 24 });
});

test('séjour commencé → la base existe comme avant, encaissé ou non', () => {
  const model = createReservationsModel(modelDb({ startDate: '2026-08-01' }));
  assert.deepEqual(JSON.parse(model.resolveArrivalExtrasBaseline(1, TODAY)), { 'opt:9': 24 });
});
