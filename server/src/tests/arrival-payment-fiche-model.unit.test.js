// The single arrival payment recorded FROM THE FICHE — specs/single-payment-from-the-fiche.md §3.2.
//
// Same result as the check-in's unified settlement, reached without running a single SAS page —
// which is the point: re-opening the wizard to record one payment costs the « préparé » flags of the
// planning cards, and this path cannot touch them because it never writes an option line.
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
      midStaySettledNotes TEXT,
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
      cardOccurrences TEXT, cardPersons REAL,
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
const seedBoth = (db) => seedStay(db, { complementAmount: 50 });
const YESTERDAY = '2026-07-09';

// specs/single-payment-from-the-fiche.md rule 6
test('« CB / Chèque » from the fiche settles every collectible bucket at the CHOSEN date', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: YESTERDAY });

  assert.deepEqual(res, { buckets: ['balance', 'complement'], total: 250, grouped: true });
  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.balancePaidDate, YESTERDAY, 'the operator’s date, not the clock’s');
  assert.equal(row.balancePaidCash, 0);
  assert.equal(row.complementPaid, 1);
  assert.equal(row.complementPaidDate, YESTERDAY);
  assert.equal(row.balancePaidAtArrival, 1);
  assert.equal(row.complementPaidAtArrival, 1);
  assert.deepEqual(groupOf(db, id), {
    at: YESTERDAY, cash: 0, total: 250, buckets: ['balance', 'complement'],
  });
  // The invariant: no amount moved.
  assert.equal(row.balanceAmount, 200);
  assert.equal(row.complementAmount, 50);
});

// specs/single-payment-from-the-fiche.md rule 5
test('« Caisse interne » flags every bucket off the books', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.settleArrivalBuckets(id, { mode: 'cash', date: TODAY });

  const row = rowOf(db, id);
  assert.equal(row.balancePaidCash, 1);
  assert.equal(row.complementPaidCash, 1);
  assert.equal(groupOf(db, id).cash, 1);
});

// specs/single-payment-from-the-fiche.md rule 6
test('a bucket already paid is left alone and is not named by the group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // The solde was wired by transfer last week; only the complement is still due.
  const id = seedStay(db, {
    balancePaid: 1, balancePaidDate: '2026-07-01', complementAmount: 50, depositAmount: 120,
  });

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  const row = rowOf(db, id);
  assert.equal(row.balancePaidDate, '2026-07-01', 'the transfer keeps its own date');
  assert.equal(row.balancePaidAtArrival, 0, 'and is never claimed by the arrival');
  assert.deepEqual(res.buckets, ['deposit', 'complement']);
  assert.deepEqual(groupOf(db, id).buckets, ['deposit', 'complement']);
});

// specs/single-payment-from-the-fiche.md rule 2
test('a single collectible bucket is settled, but is NOT a group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { complementAmount: 0 }); // only the solde is due

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  assert.equal(rowOf(db, id).balancePaid, 1);
  assert.equal(res.grouped, false);
  assert.equal(groupOf(db, id), null, 'one bucket is an ordinary payment');
});

test('nothing collectible → nothing written', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { balancePaid: 1, complementAmount: 0 });

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  assert.deepEqual(res, { buckets: [], total: 0, grouped: false });
  assert.equal(groupOf(db, id), null);
});

// specs/single-payment-from-the-fiche.md rule 10
test('« Annuler ce paiement » reverts exactly the buckets the group named', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, {
    balancePaid: 1, balancePaidDate: '2026-07-01', complementAmount: 50, depositAmount: 120,
  });
  model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  model.settleArrivalBuckets(id, { mode: 'undo' });

  const row = rowOf(db, id);
  assert.equal(row.depositPaid, 0);
  assert.equal(row.depositPaidDate, null);
  assert.equal(row.complementPaid, 0);
  assert.equal(row.complementPaidAtArrival, 0);
  assert.equal(groupOf(db, id), null);
  // The bucket paid OUTSIDE the group is untouched by the undo.
  assert.equal(row.balancePaid, 1);
  assert.equal(row.balancePaidDate, '2026-07-01');
});

// specs/single-payment-from-the-fiche.md rule 10
test('undo on a reservation with no group does nothing', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  const res = model.settleArrivalBuckets(id, { mode: 'undo' });
  assert.deepEqual(res, { buckets: [], total: 0, grouped: false });
  assert.equal(rowOf(db, id).balancePaid, 0);
});

// specs/single-payment-from-the-fiche.md rule 8
test('the options and their planning occurrences are NOT touched — the whole point', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  // A breakfast sold at check-in, with one morning already ticked « préparé » on the planning.
  db.prepare(`INSERT INTO reservation_options
      (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin, cardOccurrences)
      VALUES (?, 6, 1, 10, 4, 'per_person_per_night', 40, 1, 1, ?)`)
    .run(id, JSON.stringify([{ date: '2026-07-11', time: '09:00', done: true }]));
  db.prepare('UPDATE reservations SET breakfastPastries = 4, breakfastBread = 2 WHERE id = ?').run(id);

  model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  const opt = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = 6').get(id);
  assert.equal(opt.cardOccurrences, JSON.stringify([{ date: '2026-07-11', time: '09:00', done: true }]),
    'the « préparé » flag survives — re-opening the SAS is what loses it');
  assert.equal(opt.totalPrice, 40);
  const row = rowOf(db, id);
  assert.equal(row.breakfastPastries, 4);
  assert.equal(row.breakfastBread, 2);
});

// ── The end-of-stay complement in the group (rule 2bis) ─────────────────────────────────────────

// specs/single-payment-from-the-fiche.md rule 2bis
test('a guest who pays everything on arrival settles the END-OF-STAY complement too', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // Harmen's shape, reported 2026-08-31: platform booking, acompte disabled, nothing sold at
  // check-in, 50 € scheduled for the door on departure — and paid on arrival all the same.
  const id = seedStay(db, {
    depositDisabled: 1, depositAmount: 0, complementAmount: 0, endOfStayComplementAmount: 50,
  });

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: YESTERDAY });

  assert.deepEqual(res.buckets, ['balance', 'endOfStayComplement']);
  assert.equal(res.total, 250);
  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.endOfStayComplementPaid, 1);
  assert.equal(row.endOfStayComplementPaidDate, YESTERDAY, 'booked when the money changed hands');
  assert.equal(row.endOfStayComplementPaidCash, 0);
  assert.deepEqual(groupOf(db, id).buckets, ['balance', 'endOfStayComplement']);
});

// specs/single-payment-from-the-fiche.md rule 10
test('undoing releases the end-of-stay complement as well', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { complementAmount: 0, endOfStayComplementAmount: 50 });
  model.settleArrivalBuckets(id, { mode: 'cash', date: TODAY });
  assert.equal(rowOf(db, id).endOfStayComplementPaidCash, 1);

  model.settleArrivalBuckets(id, { mode: 'undo' });

  const row = rowOf(db, id);
  assert.equal(row.endOfStayComplementPaid, 0);
  assert.equal(row.endOfStayComplementPaidDate, null);
  assert.equal(row.endOfStayComplementPaidCash, 0);
  assert.equal(groupOf(db, id), null);
});

// specs/single-payment-from-the-fiche.md rule 11
test('un-ticking the end-of-stay complement from the fiche dissolves the group', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedStay(db, { complementAmount: 0, endOfStayComplementAmount: 50 });
  model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  model.releaseEndOfStayBucket(id);

  assert.equal(groupOf(db, id), null);
});

// specs/single-payment-from-the-fiche.md rule 7 — l'instantané de contribution tourne sur chaque
// échéance de SÉJOUR basculée, exactement comme le PATCH par échéance. C'est lui qui permettra plus
// tard de dire ce que le solde payait : sans lui, le détail du paiement unique dégrade en une ligne
// « Solde » (specs/arrival-payment-detail-and-adjustment.md rule 8) et aucune réduction n'est
// possible.
test('encaisser le solde depuis la fiche capture sa contribution', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);

  model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  const row = rowOf(db, id);
  assert.equal(row.accommodationSoldeContribTtc, 200, 'les 2 nuits attribuées au solde');
  assert.equal(row.accommodationAcompteContribTtc, null, 'et rien sur une échéance non basculée');
});

// specs/single-payment-from-the-fiche.md rule 7 — « au mieux » : une capture qui LÈVE ne coûte pas
// l'encaissement. En production le cas est une réservation plateforme dont le solde stocké est le
// chiffre de la plateforme ; ici on provoque la levée à la racine, parce que c'est la garde
// elle-même — le `try` autour de la capture, à l'intérieur de la transaction — qui doit tenir.
test('une capture qui échoue ne fait pas perdre le paiement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  db.exec('DROP TABLE reservation_custom_options');

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  assert.deepEqual(res.buckets, ['balance', 'complement'], 'le paiement est enregistré quand même');
  const row = rowOf(db, id);
  assert.equal(row.balancePaid, 1);
  assert.equal(row.accommodationSoldeContribTtc, null, 'sans attribution, plutôt qu’une inventée');
  assert.equal(groupOf(db, id).total, 250);
});

// specs/single-payment-from-the-fiche.md rule 13 — rien n'est re-tarifé. Les montants encaissés sont
// les montants stockés, même si la grille a bougé entre la réservation et l'encaissement.
test('rien n’est re-tarifé : les échéances gardent les montants dus', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  // La nuit passe de 100 € à 500 € : un re-calcul se verrait immédiatement.
  db.prepare('UPDATE pricing_rules SET pricePerNight = 500 WHERE id = 1').run();

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  const row = rowOf(db, id);
  assert.equal(row.balanceAmount, 200);
  assert.equal(row.complementAmount, 50);
  assert.equal(row.finalPrice, 200);
  assert.equal(res.total, 250, 'et le groupe porte ce qui a vraiment été encaissé');
});

// specs/single-payment-from-the-fiche.md rule 14 — les notes de séjour sont hors d'atteinte : chacune
// est sa propre collecte, à sa propre date, et le paiement unique ne les nomme jamais.
test('les notes encaissées en cours de séjour ne sont ni touchées ni regroupées', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = seedBoth(db);
  const notes = JSON.stringify([{ id: 1, paidDate: '2026-07-11', cash: 0, total: 30, items: [] }]);
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(notes, id);

  const res = model.settleArrivalBuckets(id, { mode: 'card', date: TODAY });

  assert.deepEqual(res.buckets, ['balance', 'complement'], 'aucune note dans le groupe');
  assert.equal(res.total, 250, 'et les 30 € de la note n’y sont pas non plus');
  assert.equal(rowOf(db, id).midStaySettledNotes, notes, 'le registre est intact');
});
