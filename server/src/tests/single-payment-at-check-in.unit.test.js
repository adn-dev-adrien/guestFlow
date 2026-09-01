// ONE payment at check-in — specs/single-payment-at-check-in.md §3.2.
//
// The guest hands over one card for the stay AND the arrival complement. What must hold: every
// bucket keeps its own amount, its own date and its own accounting — nothing moves between them —
// and on top of that the collection is recorded as a group, which dies the moment any bucket it
// names stops being settled.
//
// Same in-memory harness as `sas-stay-payment.unit.test.js` (the contribution capture needs the
// pricing tables), plus the two columns this spec adds.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');

const TODAY = new Date().toISOString().slice(0, 10);

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Logement', defaultCautionAmount REAL DEFAULT 0,
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      discountPercent REAL DEFAULT 0, customPrice REAL, finalPrice REAL DEFAULT 0, totalPrice REAL DEFAULT 0,
      touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
      extraGuestSurchargeOffered INTEGER DEFAULT 0,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      depositPaidCash INTEGER NOT NULL DEFAULT 0, depositPaidAtArrival INTEGER NOT NULL DEFAULT 0, depositDisabled INTEGER NOT NULL DEFAULT 0,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      balancePaidCash INTEGER NOT NULL DEFAULT 0, balancePaidAtArrival INTEGER NOT NULL DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      complementAmountOverride REAL, endOfStayComplementAmountOverride REAL,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      arrivalPaymentGroup TEXT, complementPaidAtArrival INTEGER NOT NULL DEFAULT 0,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservation_resources (
      reservationId INTEGER, resourceId INTEGER, quantity REAL DEFAULT 0, unitPrice REAL DEFAULT 0,
      billedUnits REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', totalPrice REAL DEFAULT 0,
      offered INTEGER DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (
      reservationId INTEGER, date TEXT, seasonLabel TEXT DEFAULT 'Standard',
      pricingMode TEXT DEFAULT 'fixed', price REAL DEFAULT 0,
      PRIMARY KEY (reservationId, date)
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare('INSERT INTO properties (id, name) VALUES (1, ?)').run('Logement');
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  return db;
}

// Default stay: 2 nights × 100 €. A last-minute booking carries NO acompte — the whole
// pre-arrival total sits in the solde (pricing.js via isLastMinuteStay).
function seedStay(db, overrides = {}) {
  const merged = {
    propertyId: 1, clientId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
    adults: 2, finalPrice: 200, totalPrice: 200,
    depositAmount: 0, balanceAmount: 200, depositPaid: 0, balancePaid: 0,
    ...overrides,
  };
  const cols = Object.keys(merged).join(', ');
  const holes = Object.keys(merged).map(() => '?').join(', ');
  const res = db.prepare(`INSERT INTO reservations (${cols}) VALUES (${holes})`).run(...Object.values(merged));
  db.prepare('INSERT INTO reservation_nights (reservationId, date, price) VALUES (?, ?, 100), (?, ?, 100)')
    .run(res.lastInsertRowid, '2026-07-10', res.lastInsertRowid, '2026-07-11');
  return res.lastInsertRowid;
}

const rowOf = (db, id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

const groupOf = (db, id) => {
  const raw = rowOf(db, id).arrivalPaymentGroup;
  return raw ? JSON.parse(raw) : null;
};

// A last-minute stay (200 € in the solde) that also owes a 50 € arrival complement — the shape the
// whole spec is about.
const seedBoth = (db) => seedStay(db, { complementAmount: 50 });

// specs/single-payment-at-check-in.md rule 6
test('« CB / Chèque » once: both sides settled, one group, and no amount moved', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.commitArrivalSas(id, {
    stayPaid: true, stayPaidCash: false,
    complementSettled: true, complementPaidCash: false,
    groupArrivalPayment: true,
  });

  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.balancePaidDate, TODAY);
  assert.equal(row.balancePaidCash, 0);
  assert.equal(row.complementPaid, 1);
  assert.equal(row.complementPaidDate, TODAY);
  assert.equal(row.complementPaidCash, 0);
  // Ownership: both sides are the SAS's own, so a re-open may undo them.
  assert.equal(row.balancePaidAtArrival, 1);
  assert.equal(row.complementPaidAtArrival, 1);
  // The group says what really happened — 200 € of solde + 50 € of complément.
  assert.deepEqual(groupOf(db, id), {
    at: TODAY, cash: 0, total: 250, buckets: ['balance', 'complement'],
  });
  // The invariant this feature must never break: the buckets keep their own amounts.
  assert.equal(row.balanceAmount, 200);
  assert.equal(row.complementAmount, 50);
});

// specs/single-payment-at-check-in.md rule 15
test('« Payé en liquide » once: both sides off the books, and the group says so', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.commitArrivalSas(id, {
    stayPaid: true, stayPaidCash: true,
    complementSettled: true, complementPaidCash: true,
    groupArrivalPayment: true,
  });

  const row = rowOf(db, id);
  assert.equal(row.balancePaidCash, 1);
  assert.equal(row.complementPaidCash, 1);
  assert.equal(groupOf(db, id).cash, 1);
});

// specs/single-payment-at-check-in.md rule 2
test('« Plus tard » writes nothing on either side, and no group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.commitArrivalSas(id, {
    stayPaid: false, complementSettled: false, groupArrivalPayment: false,
  });

  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 0);
  assert.equal(row.complementPaid, 0);
  assert.equal(groupOf(db, id), null);
  // Each side keeps its own meaning of « later »: the complement is recalled at the check-out.
  assert.equal(row.complementDeferredToCheckout, 1);
});

// specs/single-payment-at-check-in.md rule 9
test('re-opening the SAS and choosing « Plus tard » undoes BOTH sides and dissolves the group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.commitArrivalSas(id, {
    stayPaid: true, complementSettled: true, groupArrivalPayment: true,
  });
  assert.notEqual(groupOf(db, id), null);

  model.commitArrivalSas(id, {
    stayPaid: false, complementSettled: false, groupArrivalPayment: false,
  });

  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 0);
  assert.equal(row.balancePaidDate, null);
  assert.equal(row.balancePaidAtArrival, 0);
  assert.equal(row.complementPaid, 0);
  assert.equal(row.complementPaidAtArrival, 0);
  assert.equal(groupOf(db, id), null, 'the fiche must stop announcing a payment that was undone');
});

// specs/single-payment-at-check-in.md rule 4
test('« Régler séparément » keeps the v2.8.0 behaviour: two settlements, no group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  // The stay collected, the complement deferred to the check-out — the case rule 22 exists for.
  model.commitArrivalSas(id, {
    stayPaid: true, complementSettled: false, groupArrivalPayment: undefined,
  });

  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.complementPaid, 0);
  assert.equal(groupOf(db, id), null, 'nothing was collected in one gesture');
});

// specs/single-payment-at-check-in.md rule 7
test('a single bucket settled alone is not a group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // Nothing owed on the stay: only the complement is collectible.
  const id = seedStay(db, { balanceAmount: 0, balancePaid: 1, complementAmount: 50 });

  model.commitArrivalSas(id, {
    stayPaid: true, complementSettled: true, groupArrivalPayment: true,
  });

  assert.equal(groupOf(db, id), null, 'one bucket is an ordinary payment, not a « paiement unique »');
  assert.equal(rowOf(db, id).complementPaid, 1);
});

// specs/single-payment-at-check-in.md rule 8
test('un-ticking the solde from the fiche dissolves the group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  model.commitArrivalSas(id, { stayPaid: true, complementSettled: true, groupArrivalPayment: true });

  model.releaseStayBucket(id, 'balance');

  assert.equal(groupOf(db, id), null);
  assert.equal(rowOf(db, id).balancePaidAtArrival, 0);
});

// specs/single-payment-at-check-in.md rule 8
test('un-ticking the complement from the fiche dissolves the group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  model.commitArrivalSas(id, { stayPaid: true, complementSettled: true, groupArrivalPayment: true });

  model.releaseComplementBucket(id);

  assert.equal(groupOf(db, id), null);
  assert.equal(rowOf(db, id).complementPaidAtArrival, 0);
});

// specs/single-payment-at-check-in.md rule 8
test('releasing a bucket the group never named leaves it alone', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  model.commitArrivalSas(id, { stayPaid: true, complementSettled: true, groupArrivalPayment: true });

  // The acompte is 0 € on a last-minute stay: it is not part of the collection.
  model.releaseStayBucket(id, 'deposit');

  assert.notEqual(groupOf(db, id), null, 'a group only dies with a bucket it actually named');
});

test('omitting groupArrivalPayment leaves an existing group untouched', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  model.commitArrivalSas(id, { stayPaid: true, complementSettled: true, groupArrivalPayment: true });
  const before = groupOf(db, id);

  // A later commit that never ran the settlement steps (the operator only fixed a breakfast count).
  model.commitArrivalSas(id, { breakfastPastries: 2 });

  assert.deepEqual(groupOf(db, id), before);
});
