// « Offrir » a complement line from the SAS — specs/sas-offer-complement-lines.md.
// A geste commercial puts the line at 0 € without losing its real price, on both SAS ends.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel, __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
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
      touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', propertyId INTEGER, note TEXT);
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, totalPrice REAL DEFAULT 0,
      offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  // Base stay: a 20 € catalogue extra routed to the complement + a 10 € custom line = 30 € to collect.
  db.prepare('INSERT INTO reservations (id, propertyId, adults, complementAmount, cautionAmount) VALUES (1, 7, 2, 30, 300)').run();
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (5, 'Panier gourmand', NULL, 20, 'per_stay')").run();
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (9, 'Ménage', 'cleaning', 80, 'per_stay')").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement) VALUES (1, 5, 1, 20, 1, \'per_stay\', 20, 1)').run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sortOrder) VALUES (1, 'Extra manuel', 10, 1, 0)").run();
  return db;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const complementAmount = (db) => db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount;
const optionRow = (db, id) => db.prepare('SELECT totalPrice, offered, unitPrice FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(id);
const customRow = (db, description) => db.prepare('SELECT id, amount, offered FROM reservation_custom_options WHERE reservationId = 1 AND description = ?').get(description);
const endOfStay = (db) => {
  const row = db.prepare('SELECT endOfStayComplementAmount AS amount, endOfStayComplementDetail AS detail FROM reservations WHERE id = 1').get();
  return { amount: row.amount, detail: JSON.parse(row.detail || '[]') };
};

// ---- arrival: offering a pre-existing complement line ----

test('arrival commit: offering a catalogue line zeroes it and drops it from the complement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'option', id: 5 }] });
  assert.equal(complementAmount(db), 10, '30 − 20 (the offered extra) stays to collect');
  const row = optionRow(db, 5);
  assert.equal(row.offered, 1);
  assert.equal(row.totalPrice, 0, 'billed 0 €');
  assert.equal(row.unitPrice, 20, 'the real unit price is preserved — the gesture is lossless');
});

test('arrival re-commit: un-offering restores exactly the same amount', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'option', id: 5 }, { kind: 'custom', id: customRow(db, 'Extra manuel').id }] });
  assert.equal(complementAmount(db), 0, 'everything offered → nothing to collect');
  model.commitArrivalSas(1, { offeredExtras: [] });
  assert.equal(complementAmount(db), 30, 'both gestures undone → back to the original amount');
  assert.equal(optionRow(db, 5).totalPrice, 20);
  assert.equal(customRow(db, 'Extra manuel').offered, 0);
});

test('arrival commit: a custom line keeps its amount when offered (read layer resolves 0 €)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const id = customRow(db, 'Extra manuel').id;
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'custom', id }] });
  const row = customRow(db, 'Extra manuel');
  assert.equal(row.offered, 1);
  assert.equal(row.amount, 10, 'the stored amount is the real price, never overwritten');
  assert.equal(complementAmount(db), 20);
});

test('arrival commit: an offered linen element is recorded but not billed', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const after = model.commitArrivalSas(1, {
    complementItems: [{ label: 'Taie d\'oreiller', amount: 5, offered: true }, { label: 'Drap-housse', amount: 12 }],
  });
  assert.equal(after, 42, '30 + 12 billed; the offered pillowcase adds nothing');
  const pillow = customRow(db, 'Taie d\'oreiller');
  assert.equal(pillow.offered, 1);
  assert.equal(pillow.amount, 5, 'kept at its real price so the recap can show it struck through');
  // Re-commit billing it: the delta arithmetic must not double-count the offered line.
  const rebilled = model.commitArrivalSas(1, {
    complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Drap-housse', amount: 12 }],
  });
  assert.equal(rebilled, 47, '30 + 5 + 12 once the gesture is undone');
});

test('arrival commit: an offered ménage upsell stays activated at 0 € (« Offrir » ≠ « Non merci »)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const after = model.commitArrivalSas(1, { cleaningAdded: true, cleaningOffered: true });
  assert.equal(after, 30, 'the cleaning is given away — nothing added to the complement');
  const row = db.prepare('SELECT totalPrice, offered, inComplement, sasArrivalOrigin FROM reservation_options WHERE reservationId = 1 AND optionId = 9').get();
  assert.ok(row, 'the catalogue option IS attached (laundry + linen stock keep counting it)');
  assert.equal(row.offered, 1);
  assert.equal(row.totalPrice, 0);
  assert.equal(row.inComplement, 1);
  assert.equal(row.sasArrivalOrigin, 1);
  // Undoing the gesture on a re-commit bills it at the catalogue price.
  assert.equal(model.commitArrivalSas(1, { cleaningAdded: true, cleaningOffered: false }), 110); // 30 + 80
});

test('arrival commit: the tourist tax is never touched by an offer', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // 30 € of extras + 12 € of tourist tax collected at arrival.
  db.prepare('UPDATE reservations SET complementAmount = 42, touristTaxInComplement = 1 WHERE id = 1').run();
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'option', id: 5 }, { kind: 'custom', id: customRow(db, 'Extra manuel').id }] });
  assert.equal(complementAmount(db), 12, 'only the tax is left to collect');
});

test('arrival commit: a collected complement is frozen — no offer applies', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'option', id: 5 }] });
  assert.equal(complementAmount(db), 30, 'untouched');
  assert.equal(optionRow(db, 5).offered, 0);
});

// ---- departure ----

test('departure commit: an offered end-of-stay line is stored at 0 € with its real price', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [
      { label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, amount: 80, offered: true },
      { label: 'Serviette de bain', qty: 2, unitPrice: 8, amount: 16 },
    ],
  });
  const { amount, detail } = endOfStay(db);
  assert.equal(amount, 16, 'only the billed line counts');
  const cleaning = detail.find((l) => l.label === 'Ménage de fin de séjour');
  assert.equal(cleaning.offered, 1);
  assert.equal(cleaning.amount, 0);
  assert.equal(cleaning.unitPrice, 80, 'the real price survives, so the recap can show it struck through');
});

// Régression 2026-08-29 — a « préservée » line (its priced item was renamed or deleted since, so the
// recap carries only a label and a total) has no usable unit price. Stored as 1 × 0 € its real price
// was gone for good, and un-offering it on a later re-open restored 0 € instead of what the guest
// owed — breaking §3.1 rule 3 (« offering is lossless and reversible »).
test('departure commit: an offered line with no unit price keeps its real price', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Drap ancien modèle', qty: 1, unitPrice: 0, amount: 24, offered: true }],
  });
  const { amount, detail } = endOfStay(db);
  assert.equal(amount, 0, 'offered → nothing to collect');
  assert.equal(detail[0].offered, 1);
  assert.equal(detail[0].qty, 1);
  assert.equal(detail[0].unitPrice, 24, 'the total became the unit price, so qty × unitPrice is still the real price');
  assert.equal(round2(detail[0].qty * detail[0].unitPrice), 24);
});

test('departure re-commit: un-offering that line bills it at its real price again', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Drap ancien modèle', qty: 1, unitPrice: 0, amount: 24, offered: true }],
  });
  // What the re-opened recap reads back and re-sends once the gesture is withdrawn.
  const stored = endOfStay(db).detail[0];
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{
      label: stored.label,
      qty: Number(stored.qty) || 1,
      unitPrice: Number(stored.unitPrice) || 0,
      amount: round2((Number(stored.qty) || 1) * (Number(stored.unitPrice) || 0)),
    }],
  });
  assert.equal(endOfStay(db).amount, 24, 'the guest owes the real price again, not 0 €');
});

test('departure commit: an offered extinguisher charge is priced then given away', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price) VALUES ('extinguisher_seal', 'Plomb extincteur', 30)").run();
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [],
    extinguisherSealOkAtDeparture: 0,
    extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1, offered: true }],
  });
  const { amount, detail } = endOfStay(db);
  assert.equal(amount, 0);
  assert.equal(detail.length, 1, 'the line is kept — it is the trace of the gesture');
  assert.equal(detail[0].offered, 1);
  assert.equal(detail[0].unitPrice, 30, 'server-resolved price, not lost');
});

test('departure commit: offering a recalled arrival line reduces the arrival complement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [],
    offeredArrivalExtras: [{ kind: 'option', id: 5 }],
  });
  assert.equal(complementAmount(db), 10, 'the 20 € extra was given away at the door');
  assert.equal(optionRow(db, 5).offered, 1);
});

test('departure commit: everything offered → nothing is marked collected', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Serviette de bain', qty: 2, unitPrice: 8, amount: 16, offered: true }],
    offeredArrivalExtras: [{ kind: 'option', id: 5 }, { kind: 'custom', id: customRow(db, 'Extra manuel').id }],
    complementsSettled: true,
  });
  assert.equal(endOfStay(db).amount, 0);
  assert.equal(complementAmount(db), 0);
  const r = db.prepare('SELECT complementPaid, endOfStayComplementPaid FROM reservations WHERE id = 1').get();
  assert.equal(r.complementPaid, 0, 'an offered complement is not « encaissé »');
  assert.equal(r.endOfStayComplementPaid, 0);
});

// Régression 2026-08-29 (réservation Geuffrard) — a check-out that billed back a geste commercial.
// The Gîte routes its « Linge de lit » to the complement as a property default and OFFERS it (it is
// included in the base price), so the arrival complement is worth 0 €. The recap then shows no recall
// block at all, and the empty offered set it used to send read as « nothing is offered » — billing the
// line back at 70 € on the way out. specs/sas-offer-complement-lines.md §3.2 rule 6.ter.
test('departure commit: an arrival complement made only of gestes commerciaux is not billed back', () => {
  const db = makeDb();
  db.prepare('UPDATE reservation_options SET offered = 1, totalPrice = 0 WHERE reservationId = 1 AND optionId = 5').run();
  db.prepare('UPDATE reservation_custom_options SET offered = 1 WHERE reservationId = 1').run();
  db.prepare('UPDATE reservations SET complementAmount = 0 WHERE id = 1').run();

  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { cautionReturned: true, endOfStayComplementDetail: [], offeredArrivalExtras: [] });

  assert.equal(complementAmount(db), 0, 'nothing was un-offered at the door, so nothing is due');
  assert.equal(optionRow(db, 5).offered, 1);
  assert.equal(optionRow(db, 5).totalPrice, 0, 'the catalogue line is still worth 0 €');
  assert.equal(customRow(db, 'Extra manuel').offered, 1);
});

test('departure commit: a recalled complement can still un-offer a line', () => {
  // The guard above must not cost the feature: as soon as something IS owed, the recap renders every
  // arrival line and its set is authoritative again — a line absent from it goes back to billed.
  const db = makeDb();
  db.prepare('UPDATE reservation_options SET offered = 1, totalPrice = 0 WHERE reservationId = 1 AND optionId = 5').run();
  db.prepare('UPDATE reservations SET complementAmount = 10 WHERE id = 1').run();

  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [],
    offeredArrivalExtras: [{ kind: 'custom', id: customRow(db, 'Extra manuel').id }],
  });

  assert.equal(optionRow(db, 5).offered, 0, 'un-offered at the door');
  assert.equal(optionRow(db, 5).totalPrice, 20, 'and billed at its real price again');
  assert.equal(customRow(db, 'Extra manuel').offered, 1);
  assert.equal(complementAmount(db), 20, '10 € - 10 € (custom offered) + 20 € (extra billed back)');
});

// ---- SAS payload ----

test('arrivalComplementDetailFromReservation: offered lines ride the SAS flavour only, with their real price', () => {
  // The reservation as `getByIdWithDetails` shapes it: the 20 € extra was offered, so it is worth 0 €
  // and `complementAmount` only carries the 10 € custom line.
  const reservation = {
    complementAmount: 10,
    options: [
      { optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 1, totalPrice: 0, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1 },
      { isCustom: 1, customOptionId: 3, title: 'Extra manuel', inComplement: 1, totalPrice: 10, originalTotalPrice: 10, unitPrice: 10 },
    ],
    resources: [],
  };

  const billedOnly = arrivalComplementDetailFromReservation(reservation);
  assert.deepEqual(billedOnly.detail.map((l) => l.label), ['Extra manuel'], 'the J-2 email keeps billed lines only');

  const forSas = arrivalComplementDetailFromReservation(reservation, { includeOffered: true });
  const offeredLine = forSas.detail.find((l) => l.label === 'Panier gourmand');
  assert.equal(offeredLine.amount, 0);
  assert.equal(offeredLine.originalAmount, 20);
  assert.deepEqual(offeredLine.ref, { kind: 'option', id: 5 });
  assert.equal(
    forSas.detail.reduce((s, l) => s + l.amount, 0),
    forSas.amount,
    'the itemised detail still sums to the authoritative complement',
  );
});

test('arrivalComplementDetailFromReservation: every billed line carries the ref of its row', () => {
  const detail = arrivalComplementDetailFromReservation({
    complementAmount: 35,
    options: [
      { optionId: 5, title: 'Panier', inComplement: 1, totalPrice: 20, unitPrice: 20, billedUnits: 1 },
      { isCustom: 1, customOptionId: 3, title: 'Extra', inComplement: 1, totalPrice: 10, originalTotalPrice: 10, unitPrice: 10 },
    ],
    resources: [{ resourceId: 2, name: 'Bain nordique', inComplement: 1, totalPrice: 5, unitPrice: 5, billedUnits: 1 }],
  }).detail;
  assert.deepEqual(detail.map((l) => l.ref), [
    { kind: 'option', id: 5 },
    { kind: 'custom', id: 3 },
    { kind: 'resource', id: 2 },
  ]);
});
