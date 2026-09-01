// The stay itself collected at check-in — specs/collect-stay-payment-at-check-in.md §3.3.
//
// Drives `commitArrivalSas` against an in-memory schema carrying both the SAS tables and the
// pricing/contrib ones, because settling the acompte / solde also captures the per-bucket
// contribution snapshot the accounting export reads afterwards.

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

// specs/collect-stay-payment-at-check-in.md rule 13
test('« CB / Chèque » settles the whole remaining stay and captures the contribs', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db);

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });

  const after = rowOf(db, id);
  assert.equal(after.balancePaid, 1);
  assert.equal(after.balancePaidDate, TODAY);
  assert.equal(after.balancePaidCash, 0);
  assert.equal(after.balancePaidAtArrival, 1);
  // The whole solde is accommodation here — the conservation invariant of the capture.
  assert.equal(after.accommodationSoldeContribTtc, 200);
  // Nothing owed on the acompte (0 €, not applicable) → never marked.
  assert.equal(after.depositPaid, 0);
  assert.equal(after.depositPaidAtArrival, 0);
});

// specs/collect-stay-payment-at-check-in.md rule 17
test('« Payé en liquide » flags the caisse interne on the settled bucket', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db);

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: true });

  const after = rowOf(db, id);
  assert.equal(after.balancePaid, 1);
  assert.equal(after.balancePaidCash, 1);
  assert.equal(after.balancePaidAtArrival, 1);
});

// specs/collect-stay-payment-at-check-in.md rule 4
test('both unpaid buckets are settled together — the guest pays « le séjour », not two lines', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { depositAmount: 60, balanceAmount: 140 });

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });

  const after = rowOf(db, id);
  assert.equal(after.depositPaid, 1);
  assert.equal(after.balancePaid, 1);
  assert.equal(after.depositPaidAtArrival, 1);
  assert.equal(after.balancePaidAtArrival, 1);
  assert.equal(after.accommodationAcompteContribTtc, 60);
  // Balance capture = what the line still owes after the acompte snapshot.
  assert.equal(after.accommodationSoldeContribTtc, 140);
});

// specs/collect-stay-payment-at-check-in.md rule 15
test('an acompte already paid before the check-in keeps its date and gets NO marker', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // A deposit collected before the stay carries its own contrib snapshot, captured at that flip.
  const id = seedStay(db, {
    depositAmount: 60, balanceAmount: 140, depositPaid: 1, depositPaidDate: '2026-06-01',
    accommodationAcompteContribTtc: 60,
  });

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: true });

  const after = rowOf(db, id);
  assert.equal(after.depositPaidDate, '2026-06-01');
  assert.equal(after.depositPaidCash, 0);          // the wire transfer is not caisse interne
  assert.equal(after.depositPaidAtArrival, 0);     // not ours
  assert.equal(after.balancePaid, 1);
  assert.equal(after.balancePaidCash, 1);
  assert.equal(after.balancePaidAtArrival, 1);
});

// specs/collect-stay-payment-at-check-in.md rule 1
test('a disabled acompte is not applicable — only the solde is collected', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // `depositDisabled`: the engine already routed the whole pre-arrival total to the solde; the
  // stale `depositAmount` must not resurrect an acompte to collect.
  const id = seedStay(db, { depositAmount: 60, balanceAmount: 200, depositDisabled: 1 });

  model.commitArrivalSas(id, { stayPaid: true });

  const after = rowOf(db, id);
  assert.equal(after.depositPaid, 0);
  assert.equal(after.depositPaidAtArrival, 0);
  assert.equal(after.balancePaid, 1);
});

// specs/collect-stay-payment-at-check-in.md rule 14
test('« Pas maintenant » on a re-opened SAS undoes ITS OWN settlement and clears the contribs', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, {
    depositAmount: 60, balanceAmount: 140, depositPaid: 1, depositPaidDate: '2026-06-01',
    accommodationAcompteContribTtc: 60,
  });

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: true });
  model.commitArrivalSas(id, { stayPaid: false });

  const after = rowOf(db, id);
  // The solde it collected goes back to unpaid, cash flag and marker cleared, contribs released…
  assert.equal(after.balancePaid, 0);
  assert.equal(after.balancePaidDate, null);
  assert.equal(after.balancePaidCash, 0);
  assert.equal(after.balancePaidAtArrival, 0);
  assert.equal(after.accommodationSoldeContribTtc, null);
  // …and the acompte paid by transfer before the stay is untouched.
  assert.equal(after.depositPaid, 1);
  assert.equal(after.depositPaidDate, '2026-06-01');
});

// specs/collect-stay-payment-at-check-in.md rule 14
test('re-committing the same settlement keeps the original paid date (money never moves twice)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db);

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });
  db.prepare("UPDATE reservations SET balancePaidDate = '2026-07-10' WHERE id = ?").run(id);
  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: true });

  const after = rowOf(db, id);
  assert.equal(after.balancePaidDate, '2026-07-10');
  assert.equal(after.balancePaidCash, 1);          // the mode can still be corrected
});

// specs/collect-stay-payment-at-check-in.md rule 6
test('the step never ran (`stayPaid` absent) → the stay buckets are left strictly alone', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { depositAmount: 60, balanceAmount: 140 });

  model.commitArrivalSas(id, { complementItems: [] });

  const after = rowOf(db, id);
  assert.equal(after.depositPaid, 0);
  assert.equal(after.balancePaid, 0);
  assert.equal(after.balancePaidAtArrival, 0);
  assert.equal(after.arrivalSasDoneAt !== null, true);   // the rest of the check-in did commit
});

// specs/collect-stay-payment-at-check-in.md rule 15
test('releaseStayBucket: a bucket written from the fiche stops being the SAS\'s', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db);

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: true });
  model.releaseStayBucket(id, 'balance');

  const after = rowOf(db, id);
  assert.equal(after.balancePaid, 1);              // the payment itself stands
  assert.equal(after.balancePaidCash, 0);          // but it is no longer caisse interne
  assert.equal(after.balancePaidAtArrival, 0);     // and the SAS may no longer undo it
});

// specs/collect-stay-payment-at-check-in.md rule 2
test('a stay whose stored solde disagrees with the engine is STILL collected (contribs left NULL)', () => {
  // The common OTA case: the stored solde is the platform's figure, the engine re-derives another
  // number, and the conservation invariant of the capture cannot hold. Losing the whole check-in over
  // it would cost the caution, the upsells and the planning flags — for something the operator cannot
  // fix at the door (specs/collect-stay-payment-at-check-in.md §3.3 rule 13, revised 2026-08-30).
  const db = makeDb();
  const model = createReservationsModel(db);
  // 2 nights × 100 € priced by the engine, but the platform settles 313,48 €.
  const id = seedStay(db, {
    platform: 'Booking', finalPrice: 313.48, totalPrice: 313.48, balanceAmount: 313.48,
  });

  model.commitArrivalSas(id, { stayPaid: true, stayPaidCash: false });

  const after = rowOf(db, id);
  assert.equal(after.balancePaid, 1, 'the money is recorded');
  assert.equal(after.balancePaidAtArrival, 1);
  assert.equal(after.accommodationSoldeContribTtc, null, 'no per-line freeze — the export derives it');
  assert.equal(after.arrivalSasDoneAt !== null, true, 'and the check-in is not lost');
});

test('captureStayContribs reports whether the snapshot could be taken', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const ok = seedStay(db);
  const ko = seedStay(db, { finalPrice: 313.48, totalPrice: 313.48, balanceAmount: 313.48 });
  assert.equal(model.captureStayContribs(ok, 'balance'), true);
  assert.equal(model.captureStayContribs(ko, 'balance'), false);
});
