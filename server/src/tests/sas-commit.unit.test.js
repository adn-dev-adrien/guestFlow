// Arrival / departure SAS commit logic + priced linen items.
// See specs/arrival-departure-sas.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel, __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');
const { buildModel: buildLinenItems } = require('../models/linenItemsModel');

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
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  // specs/caution-live-from-property.md §3 — commitArrivalSas freezes the property's caution on receipt.
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare("INSERT INTO reservations (id, propertyId, adults, teens, children, complementAmount, complementPaid, cautionAmount) VALUES (1, 7, 2, 0, 1, 30, 0, 300)").run();
  return db;
}

// ---- linen items model ----

test('linenItemsModel.replaceAll: drops empty labels, re-numbers per category, list ordered', () => {
  const db = makeDb();
  const m = buildLinenItems(db);
  const out = m.replaceAll([
    { label: 'Taie d\'oreiller', price: 5, category: 'bed' },
    { label: '', price: 9, category: 'bed' },             // dropped
    { label: 'Serviette de bain', price: 8, category: 'towel' },
    { label: 'Housse de couette', price: 15, category: 'bed' },
  ]);
  assert.equal(out.length, 3);
  const bed = out.filter((i) => i.category === 'bed').map((i) => i.label);
  assert.deepEqual(bed, ['Taie d\'oreiller', 'Housse de couette']);
  assert.equal(out.find((i) => i.category === 'towel').label, 'Serviette de bain');
});

// ---- cleaning price ----

test('getCleaningPriceForProperty: per-property override wins over base price', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price) VALUES (50, 'Ménage', 'cleaning', 40)").run();
  assert.equal(model.getCleaningPriceForProperty(7), 40);
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (7, 50, 55)').run();
  assert.equal(model.getCleaningPriceForProperty(7), 55);
});

test('getCleaningPriceForProperty: null when no cleaning option exists', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  assert.equal(model.getCleaningPriceForProperty(7), null);
});

// ---- arrival commit ----

test('commitArrivalSas: caution marked received + items added inComplement + complement bumped', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const newComplement = model.commitArrivalSas(1, {
    cautionReceived: true,
    complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Ménage', amount: 40 }],
  });
  assert.equal(newComplement, 75); // 30 + 5 + 40
  const r = db.prepare('SELECT cautionReceived, cautionReceivedDate, cautionAmount, complementAmount, arrivalSasDoneAt FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReceived, 1);
  assert.ok(r.cautionReceivedDate);
  // specs/caution-live-from-property.md §3 rule 2 — the live property caution (500) is frozen on receipt,
  // overwriting the stale stored 300.
  assert.equal(r.cautionAmount, 500);
  assert.equal(r.complementAmount, 75);
  assert.ok(r.arrivalSasDoneAt, 'arrival SAS marked done');
  const customs = db.prepare("SELECT description, amount, inComplement, offered FROM reservation_custom_options WHERE reservationId = 1 ORDER BY sortOrder").all();
  assert.equal(customs.length, 2);
  assert.ok(customs.every((c) => c.inComplement === 1 && c.offered === 0));
});

// specs/adjustable-complement-amounts.md §3.1 rule 4 + §3.2 — le SAS écrit `complementAmount` EN
// DIRECT, hors moteur de prix. Sans rappel de l'ajustement, un passage au SAS effacerait
// silencieusement le montant annoncé au client jusqu'au prochain enregistrement de la fiche.
test('commitArrivalSas: un montant de complément ajusté survit au commit', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET complementAmountOverride = 50 WHERE id = 1').run();

  model.commitArrivalSas(1, {
    complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Ménage', amount: 40 }],
  });

  const r = db.prepare('SELECT complementAmount, complementAmountOverride FROM reservations WHERE id = 1').get();
  assert.equal(r.complementAmount, 50, 'le montant annoncé a le dernier mot, pas la somme des lignes du SAS');
  assert.equal(r.complementAmountOverride, 50);
  // (La ventilation comptable qui suit ce rappel a son propre schéma de test : elle demande la
  // réservation détaillée, que ce schéma minimal ne porte pas — colonne `complementAllocation` absente
  // ici, donc la synchro se désactive d'elle-même comme sur une base de test réduite.)
});

test('commitArrivalSas: sans ajustement, le commit est strictement inchangé', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Ménage', amount: 40 }] });
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount, 70);
});

test('commitArrivalSas re-commit: REPLACES the SAS-origin complement (no double-charge)', () => {
  // specs/reopen-completed-sas.md §4 rule 4 — re-opening + re-validating must not stack lines.
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount, 35); // 30 + 5
  // Re-open + add the cleaning charge; the pillow line must be replaced, not duplicated.
  const after = model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Ménage', amount: 40 }] });
  assert.equal(after, 75, 'complement = base 30 + 5 + 40 (not cumulated)');
  const rows = db.prepare('SELECT description, sasArrivalOrigin FROM reservation_custom_options WHERE reservationId = 1 ORDER BY sortOrder').all();
  assert.equal(rows.length, 2, 'old SAS line replaced, not appended');
  assert.ok(rows.every((x) => x.sasArrivalOrigin === 1), 'SAS-origin lines tagged');
  // Re-open again and remove everything → complement falls back to the base.
  const cleared = model.commitArrivalSas(1, { complementItems: [] });
  assert.equal(cleared, 30, 'emptying the SAS complement returns to the base amount');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 1').get().n, 0);
});

test('commitArrivalSas re-commit: preserves non-SAS complement lines + caution untick clears', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // A manually-added complement line (not SAS-origin) must survive the SAS replace pass.
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin) VALUES (1, 'Extra manuel', 10, 1, 0)").run();
  db.prepare('UPDATE reservations SET complementAmount = 40 WHERE id = 1').run(); // 30 base + 10 manual
  model.commitArrivalSas(1, { cautionReceived: true, complementItems: [{ label: 'Drap', amount: 12 }] });
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount, 52); // 40 + 12
  // Re-open: untick caution + drop the linen line.
  model.commitArrivalSas(1, { cautionReceived: false, complementItems: [] });
  const r = db.prepare('SELECT cautionReceived, cautionReceivedDate, complementAmount FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReceived, 0, 'untick clears the caution marker');
  assert.equal(r.cautionReceivedDate, null);
  assert.equal(r.complementAmount, 40, 'manual line preserved (30 + 10); only the SAS line removed');
  const remaining = db.prepare('SELECT description FROM reservation_custom_options WHERE reservationId = 1').all();
  assert.deepEqual(remaining.map((x) => x.description), ['Extra manuel']);
});

test('commitArrivalSas: a paid complement is fully frozen — amount unchanged + no lines written', () => {
  // specs/reopen-completed-sas.md §4.3 — a settled complement is left untouched (no insert / no
  // re-compute), so a re-opened SAS can't alter a paid complement.
  const db = makeDb();
  db.prepare('UPDATE reservations SET complementPaid = 1, complementAmount = 30 WHERE id = 1').run();
  const model = createReservationsModel(db);
  const newComplement = model.commitArrivalSas(1, { complementItems: [{ label: 'Drap-housse', amount: 12 }] });
  assert.equal(newComplement, 30); // frozen
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 1').get().n, 0);
});

test('commitArrivalSas: ignores zero/blank items', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const c = model.commitArrivalSas(1, { complementItems: [{ label: 'x', amount: 0 }, { label: '', amount: 9 }] });
  assert.equal(c, 30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = 1').get().n, 0);
});

test('commitArrivalSas: writes breakfast composition (clamped) + breakfastTime + handover note', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {
    breakfastTime: '9:05',         // normalised to 09:05
    breakfastCoffee: 2.7,          // → 3 (round, non-negative)
    breakfastTea: -1,              // → 0 (clamp)
    breakfastChocolate: 1,
    breakfastMilk: 1.2,            // → 1 (round)
    breakfastPastries: 2,
    breakfastCereals: -3,          // → 0 (clamp)
    breakfastBread: 1.3,           // → 1.5 (nearest half-baguette)
    breakfastNote: '  sans lactose  ',
    departureHandoverNote: '  clé sous le pot  ',
  });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastMilk, breakfastPastries, breakfastCereals, breakfastBread, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '09:05');
  assert.equal(r.breakfastCoffee, 3);
  assert.equal(r.breakfastTea, 0);
  assert.equal(r.breakfastChocolate, 1);
  assert.equal(r.breakfastMilk, 1);
  assert.equal(r.breakfastPastries, 2);
  assert.equal(r.breakfastCereals, 0);
  assert.equal(r.breakfastBread, 1.5);
  assert.equal(r.breakfastNote, 'sans lactose');
  assert.equal(r.departureHandoverNote, 'clé sous le pot');
});

test('commitArrivalSas: omitted breakfast fields default to 0 / null, breakfastTime untouched', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET breakfastTime = '08:30' WHERE id = 1").run();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastMilk, breakfastPastries, breakfastCereals, breakfastBread, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '08:30');   // not passed → left as-is
  assert.equal(r.breakfastCoffee, 0);
  assert.equal(r.breakfastMilk, 0);
  assert.equal(r.breakfastPastries, 0);
  assert.equal(r.breakfastCereals, 0);
  assert.equal(r.breakfastBread, 0);
  assert.equal(r.breakfastNote, null);
  assert.equal(r.departureHandoverNote, null);
});

// ---- arrival bath-linen upsell (specs/sas-bath-linen-upsell.md) ----

// Reservation 1 = 2 adults + 1 child = 3 persons. Seed a per-person bath-linen option at 4 € → 12 €.
function seedBathLinen(db, { price = 4, priceType = 'per_person' } = {}) {
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (60, 'Linge de toilette', 'bathroom_linen', ?, ?)").run(price, priceType);
  return 60;
}

// specs/sas-bath-linen-ghost-line.md §1.1 — everything the arrival SAS sells is a line ON THE FICHE.
// The « réglé en fin de séjour » path that wrote a parallel billing line is gone, and every commit
// erases what it left behind.

test('commitArrivalSas: never writes a bath-linen line into the end-of-stay complement', () => {
  const db = makeDb();
  seedBathLinen(db);
  const model = createReservationsModel(db);
  const arrivalComplement = model.commitArrivalSas(1, { bathLinenAdded: true });
  assert.equal(arrivalComplement, 42, 'the upsell rides the arrival complement (30 + 3 × 4)');
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 0);
  assert.equal(r.endOfStayComplementDetail, null);
  // …and the service exists once, as a catalogue option on the fiche.
  const opts = db.prepare('SELECT optionId, totalPrice, inComplement, sasArrivalOrigin FROM reservation_options WHERE reservationId = 1').all();
  assert.deepEqual(opts, [{ optionId: 60, totalPrice: 12, inComplement: 1, sasArrivalOrigin: 1 }]);
});

test('commitArrivalSas: drops a legacy ghost line even when the bath-linen step is not part of the run', () => {
  const db = makeDb();
  seedBathLinen(db);
  // The stuck production shape: the option is on the fiche AND the old deferred line is still stored,
  // so the dialog hides the step — the commit must clean up regardless.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice, inComplement) VALUES (1, 60, 12, 1)').run();
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 52, endOfStayComplementDetail = ? WHERE id = 1')
    .run(JSON.stringify([
      { label: 'Ménage de fin de séjour', amount: 40 },
      { label: 'Linge de toilette', amount: 12, qty: 3, unitPrice: 4, source: 'arrivalBathLinen' },
    ]));

  createReservationsModel(db).commitArrivalSas(1, {});
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 40, 'only the departure line remains');
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((l) => l.label), ['Ménage de fin de séjour']);
});

test('commitArrivalSas: leaves a ghost-free end-of-stay complement untouched, and is idempotent', () => {
  const db = makeDb();
  seedBathLinen(db);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 40, endOfStayComplementDetail = ? WHERE id = 1')
    .run(JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 40 }]));
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {});
  model.commitArrivalSas(1, {});
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 40);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((l) => l.label), ['Ménage de fin de séjour']);
});

test('commitDepartureSas: preserves an arrival-added bath-linen line (source tag) sent back in the detail', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [
      { label: 'Ménage de fin de séjour', amount: 40 },
      { label: 'Linge de toilette', amount: 12, qty: 3, unitPrice: 4, source: 'arrivalBathLinen' },
    ],
  });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 52); // 40 + 12, server sums all detail lines
  const carried = JSON.parse(r.endOfStayComplementDetail).find((l) => l.source === 'arrivalBathLinen');
  assert.ok(carried, 'bath-linen line preserved with its source tag');
  assert.equal(carried.amount, 12);
});

// ---- departure commit ----

test('commitDepartureSas: caution returned + end-of-stay complement + detail set', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    cautionReturned: true,
    endOfStayComplementAmount: 48,
    endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }, { label: 'Serviette', amount: 8 }],
  });
  const r = db.prepare('SELECT cautionReturned, cautionReturnedDate, endOfStayComplementAmount, endOfStayComplementDetail, departureSasDoneAt FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReturned, 1);
  assert.ok(r.departureSasDoneAt, 'departure SAS marked done');
  assert.ok(r.cautionReturnedDate);
  assert.equal(r.endOfStayComplementAmount, 48);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((d) => d.label), ['Ménage', 'Serviette']);
});

test('commitDepartureSas: cautionReturned=false clears the marker + its date (faithful edit)', () => {
  // specs/reopen-completed-sas.md §6 — re-opening a departure and un-ticking « caution rendue »
  // reverts the marker (e.g. a litige / dégât found after the fact).
  const db = makeDb();
  db.prepare("UPDATE reservations SET cautionReturned = 1, cautionReturnedDate = '2026-06-10' WHERE id = 1").run();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { cautionReturned: false, endOfStayComplementAmount: 0 });
  const r = db.prepare('SELECT cautionReturned, cautionReturnedDate FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReturned, 0);
  assert.equal(r.cautionReturnedDate, null);
});

test('commitDepartureSas: cautionReturned omitted leaves the marker untouched', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET cautionReturned = 1, cautionReturnedDate = '2026-06-10' WHERE id = 1").run();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { endOfStayComplementAmount: 0 });
  const r = db.prepare('SELECT cautionReturned, cautionReturnedDate FROM reservations WHERE id = 1').get();
  assert.equal(r.cautionReturned, 1);
  assert.equal(r.cautionReturnedDate, '2026-06-10');
});

test('commitDepartureSas: end-of-stay re-commit OVERWRITES amount + detail (no accumulation)', () => {
  // specs/reopen-completed-sas.md §4 — the end-of-stay complement is already overwrite-based.
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { endOfStayComplementAmount: 48, endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }, { label: 'Serviette', amount: 8 }] });
  model.commitDepartureSas(1, { endOfStayComplementAmount: 20, endOfStayComplementDetail: [{ label: 'Serviette', amount: 20 }] });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 20);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((d) => d.label), ['Serviette']);
});

// ---- fire-extinguisher seal (specs/extinguisher-seal-and-repair-amounts.md) ----

test('commitArrivalSas: records the seal baseline + never bills for it', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  const before = db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount;
  const after = model.commitArrivalSas(1, { extinguisherSealOkAtArrival: 0 }); // missing at arrival
  const r = db.prepare('SELECT extinguisherSealOkAtArrival, complementAmount FROM reservations WHERE id = 1').get();
  assert.equal(r.extinguisherSealOkAtArrival, 0, 'baseline recorded');
  assert.equal(after, before, 'arrival never bills the seal (complement unchanged)');
});

test('commitArrivalSas: omitted seal field leaves the column untouched (NULL)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  assert.equal(db.prepare('SELECT extinguisherSealOkAtArrival FROM reservations WHERE id = 1').get().extinguisherSealOkAtArrival, null);
});

test('commitDepartureSas: records the departure seal state (the bill rides endOfStayComplementDetail)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    extinguisherSealOkAtDeparture: 0,
    endOfStayComplementAmount: 25,
    endOfStayComplementDetail: [{ label: 'Plomb extincteur', amount: 25 }],
  });
  const r = db.prepare('SELECT extinguisherSealOkAtDeparture, endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.extinguisherSealOkAtDeparture, 0);
  assert.equal(r.endOfStayComplementAmount, 25);
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((d) => d.label), ['Plomb extincteur']);
});

// ---- extinguisher condition tariffs, server-priced (specs/extinguisher-seal-and-repair-amounts.md §3.2) ----

test('commitDepartureSas: not-OK extinguisher prices each tariff × qty from repair_amounts and adds it to the end-of-stay complement', () => {
  const db = makeDb();
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price, sortOrder) VALUES ('extinguisher_seal', 'Plomb manquant', 30, 0), ('extinguisher_use', 'Utilisation', 15, 1)").run();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    extinguisherSealOkAtDeparture: 0,
    endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 40, qty: 1 }],
    extinguisherCharges: [
      { repairKey: 'extinguisher_seal', qty: 1 },  // 30 × 1 = 30
      { repairKey: 'extinguisher_use', qty: 2 },   // 15 × 2 = 30
    ],
  });
  const r = db.prepare('SELECT extinguisherSealOkAtDeparture, endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.extinguisherSealOkAtDeparture, 0);
  // 40 (ménage) + 30 (plomb) + 30 (utilisation) — amount is the authoritative server-computed sum.
  assert.equal(r.endOfStayComplementAmount, 100);
  const detail = JSON.parse(r.endOfStayComplementDetail);
  assert.deepEqual(detail.map((d) => d.label), ['Ménage de fin de séjour', 'Plomb manquant', 'Utilisation']);
  const use = detail.find((d) => d.repairKey === 'extinguisher_use');
  assert.equal(use.amount, 30);
  assert.equal(use.qty, 2);
});

test('commitDepartureSas: extinguisher in good condition bills nothing even if charges are sent', () => {
  const db = makeDb();
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price) VALUES ('extinguisher_seal', 'Plomb manquant', 30)").run();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    extinguisherSealOkAtDeparture: 1,
    endOfStayComplementDetail: [],
    extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1 }],
  });
  const r = db.prepare('SELECT extinguisherSealOkAtDeparture, endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.extinguisherSealOkAtDeparture, 1);
  assert.equal(r.endOfStayComplementAmount, 0);
  assert.equal(r.endOfStayComplementDetail, null);
});

test('commitDepartureSas: a 0-qty or 0-priced extinguisher tariff produces no line', () => {
  const db = makeDb();
  db.prepare("INSERT INTO repair_amounts (repairKey, label, price) VALUES ('extinguisher_seal', 'Plomb manquant', 0), ('extinguisher_use', 'Utilisation', 15)").run();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    extinguisherSealOkAtDeparture: 0,
    endOfStayComplementDetail: [],
    extinguisherCharges: [
      { repairKey: 'extinguisher_seal', qty: 2 },   // priced 0 → no line
      { repairKey: 'extinguisher_use', qty: 0 },     // qty 0 → no line
    ],
  });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 0);
  assert.equal(r.endOfStayComplementDetail, null);
});

// ── planning coche + dashboard status flags (specs/arrival-departure-sas.md §3.6) ──────────────────

test('commitArrivalSas: completing the arrival SAS validates checkInReady (coche/Prêt) + checkInDone (Arrivé)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  let r = db.prepare('SELECT checkInReady, checkInDone FROM reservations WHERE id = 1').get();
  assert.equal(r.checkInReady, 0);
  assert.equal(r.checkInDone, 0);
  model.commitArrivalSas(1, { cautionReceived: true });
  r = db.prepare('SELECT checkInReady, checkInDone FROM reservations WHERE id = 1').get();
  assert.equal(r.checkInReady, 1, 'planning coche + dashboard « Prêt » validated');
  assert.equal(r.checkInDone, 1, 'dashboard « Arrivé » validated');
});

test('commitArrivalSas: does not touch the departure « Parti » flag', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, {});
  assert.equal(db.prepare('SELECT checkOutDone FROM reservations WHERE id = 1').get().checkOutDone, 0);
});

test('commitArrivalSas: re-committing keeps the flags validated (never auto-unticked)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  // Operator manually unchecks « Arrivé » on the dashboard, then re-opens + re-commits the SAS.
  db.prepare('UPDATE reservations SET checkInDone = 0 WHERE id = 1').run();
  model.commitArrivalSas(1, { cautionReceived: false });
  const r = db.prepare('SELECT checkInReady, checkInDone FROM reservations WHERE id = 1').get();
  assert.equal(r.checkInReady, 1);
  assert.equal(r.checkInDone, 1, 'completing the SAS re-affirms « Arrivé »');
});

test('commitDepartureSas: completing the departure SAS validates checkOutDone (coche/Parti)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  assert.equal(db.prepare('SELECT checkOutDone FROM reservations WHERE id = 1').get().checkOutDone, 0);
  model.commitDepartureSas(1, { cautionReturned: true });
  assert.equal(db.prepare('SELECT checkOutDone FROM reservations WHERE id = 1').get().checkOutDone, 1, 'planning coche + dashboard « Parti » validated');
});

test('commitDepartureSas: does not touch the arrival « Prêt »/« Arrivé » flags', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {});
  const r = db.prepare('SELECT checkInReady, checkInDone FROM reservations WHERE id = 1').get();
  assert.equal(r.checkInReady, 0);
  assert.equal(r.checkInDone, 0);
});

// ── specs/recall-unpaid-arrival-complement-at-checkout.md ──────────────────────────────────────────

test('commitArrivalSas: complementSettled marks the arrival complement paid (+ date); false clears it', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementSettled: true, complementPaidCash: true });
  let r = db.prepare('SELECT complementPaid, complementPaidDate, complementPaidCash FROM reservations WHERE id = 1').get();
  assert.equal(r.complementPaid, 1, 'marked paid');
  assert.ok(r.complementPaidDate, 'a paid date was set');
  assert.equal(r.complementPaidCash, 1, 'caisse interne flag follows the choice');
  // Reversible: re-commit with false clears the marker + date.
  model.commitArrivalSas(1, { complementSettled: false });
  r = db.prepare('SELECT complementPaid, complementPaidDate FROM reservations WHERE id = 1').get();
  assert.equal(r.complementPaid, 0);
  assert.equal(r.complementPaidDate, null);
});

// ── specs/defer-arrival-complement-to-checkout.md ─────────────────────────────────────────────────

test('commitArrivalSas: « En fin de séjour » sets the deferral marker; settling on the spot clears it', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementSettled: false });
  assert.equal(db.prepare('SELECT complementDeferredToCheckout d FROM reservations WHERE id = 1').get().d, 1);
  model.commitArrivalSas(1, { complementSettled: true });
  assert.equal(db.prepare('SELECT complementDeferredToCheckout d FROM reservations WHERE id = 1').get().d, 0);
});

test('commitArrivalSas: omitting complementSettled leaves the deferral marker untouched', () => {
  const db = makeDb();
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1 WHERE id = 1').run();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  assert.equal(db.prepare('SELECT complementDeferredToCheckout d FROM reservations WHERE id = 1').get().d, 1);
});

test('isCleaningSoldForReservation: booked option (tag), custom « Ménage » line, property default, else false', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  assert.equal(model.isCleaningSoldForReservation(1), false);
  // Tagged catalogue option.
  db.prepare("INSERT INTO options (id, title, autoOptionType, price) VALUES (50, 'Ménage', 'cleaning', 40)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (1, 50)').run();
  assert.equal(model.isCleaningSoldForReservation(1), true);
  // Untagged custom line added by the arrival SAS → matched by name.
  const db2 = makeDb();
  const model2 = createReservationsModel(db2);
  db2.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin) VALUES (1, 'Ménage', 40, 1, 1)").run();
  assert.equal(model2.isCleaningSoldForReservation(1), true);
});

test('commitDepartureSas: never bills the cleaning when it is already sold (double-charge guard)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price) VALUES (50, 'Ménage', 'cleaning', 40)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (1, 50)').run();
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 40 }, { label: 'Serviette', amount: 8 }],
  });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 8, 'only the linen line is billed');
  assert.deepEqual(JSON.parse(r.endOfStayComplementDetail).map((l) => l.label), ['Serviette']);
});

test('commitDepartureSas: bills the cleaning normally when it is NOT sold', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 40 }] });
  assert.equal(db.prepare('SELECT endOfStayComplementAmount a FROM reservations WHERE id = 1').get().a, 40);
});

test('commitDepartureSas: re-running on an over-billed stay drops the duplicate cleaning line', () => {
  // specs/defer-arrival-complement-to-checkout.md §3.1 rule 4 — self-healing, no data migration.
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 40 }] });
  assert.equal(db.prepare('SELECT endOfStayComplementAmount a FROM reservations WHERE id = 1').get().a, 40);
  // The cleaning is sold afterwards (arrival SAS re-run / option added), then the departure SAS re-runs.
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin) VALUES (1, 'Ménage', 40, 1, 1)").run();
  model.commitDepartureSas(1, { endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 40 }] });
  const r = db.prepare('SELECT endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementAmount, 0);
  assert.equal(r.endOfStayComplementDetail, null);
});

test('commitArrivalSas: omitting complementSettled leaves the paid marker untouched', () => {
  const db = makeDb();
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = 1').run('2026-06-10');
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  const r = db.prepare('SELECT complementPaid, complementPaidDate FROM reservations WHERE id = 1').get();
  assert.equal(r.complementPaid, 1);
  assert.equal(r.complementPaidDate, '2026-06-10');
});

test('commitDepartureSas: an UNPAID arrival complement is recalled — BOTH complements marked paid, amounts kept separate', () => {
  const db = makeDb();
  // reservation 1 seeded with complementAmount = 30, complementPaid = 0 (the forgotten check-in).
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }],
    complementsSettled: true,
  });
  const r = db.prepare(`SELECT complementAmount, complementPaid, complementPaidDate,
    endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidDate FROM reservations WHERE id = 1`).get();
  // Both collected at checkout.
  assert.equal(r.complementPaid, 1, 'recalled arrival complement marked paid');
  assert.ok(r.complementPaidDate, 'arrival paid date set');
  assert.equal(r.endOfStayComplementPaid, 1, 'end-of-stay complement marked paid');
  assert.ok(r.endOfStayComplementPaidDate, 'end-of-stay paid date set');
  // Amounts stay SEPARATE (never merged) — the tourist tax keeps its own accounting routing.
  assert.equal(r.complementAmount, 30, 'arrival amount unchanged');
  assert.equal(r.endOfStayComplementAmount, 40, 'end-of-stay amount unchanged (not summed into one)');
});

test('commitDepartureSas: an ALREADY-PAID arrival complement is NOT recalled (no re-collection)', () => {
  const db = makeDb();
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = 1').run('2026-06-10');
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, {
    endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }],
    complementsSettled: true,
  });
  const r = db.prepare('SELECT complementPaid, complementPaidDate, endOfStayComplementPaid FROM reservations WHERE id = 1').get();
  assert.equal(r.complementPaid, 1);
  assert.equal(r.complementPaidDate, '2026-06-10', 'the original arrival paid date is untouched');
  assert.equal(r.endOfStayComplementPaid, 1, 'only the end-of-stay complement is freshly collected');
});

test('commitDepartureSas: complementsSettled=false clears the end-of-stay paid marker (reversible)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }], complementsSettled: true });
  model.commitDepartureSas(1, { endOfStayComplementDetail: [{ label: 'Ménage', amount: 40 }], complementsSettled: false });
  const r = db.prepare('SELECT endOfStayComplementPaid, endOfStayComplementPaidDate FROM reservations WHERE id = 1').get();
  assert.equal(r.endOfStayComplementPaid, 0);
  assert.equal(r.endOfStayComplementPaidDate, null);
});

test('arrivalComplementDetailFromReservation: itemises in-complement lines + tax + remainder, summing to complementAmount', () => {
  const detail = arrivalComplementDetailFromReservation({
    complementAmount: 64.8,
    complementPaid: 0,
    touristTaxInComplementAmount: 4.8,
    options: [
      { title: 'Lit bébé', totalPrice: 20, inComplement: 1, offered: 0 },
      { title: 'Petit déj (offert)', totalPrice: 0, inComplement: 1, offered: 1 }, // offered → skipped
      { title: 'Ménage (pré-arrivée)', totalPrice: 80, inComplement: 0, offered: 0 }, // not in complement → skipped
    ],
    resources: [{ name: 'Kit linge', totalPrice: 15, inComplement: 1, offered: 0 }],
  });
  assert.equal(detail.amount, 64.8);
  assert.equal(detail.paid, 0);
  const labels = detail.detail.map((l) => l.label);
  assert.deepEqual(labels, ['Lit bébé', 'Kit linge', 'Taxe de séjour', "Complément d'arrivée"]);
  // 20 + 15 + 4.8 = 39.8 listed; remainder = 64.8 − 39.8 = 25 (auto-gap) → the listed detail sums to the total.
  assert.equal(detail.detail.find((l) => l.label === "Complément d'arrivée").amount, 25);
  assert.equal(Math.round(detail.detail.reduce((s, l) => s + l.amount, 0) * 100) / 100, 64.8);
});

test('arrivalComplementDetailFromReservation: carries qty/unitPrice/kind for the SAS-style email list', () => {
  // specs/j2-email-coffee-and-sas-complement.md — additive fields so the J-2 email can render
  // « label : qté × prix = total » and localise the system labels (tax / remainder) per language.
  const detail = arrivalComplementDetailFromReservation({
    complementAmount: 50.8, complementPaid: 0, touristTaxInComplementAmount: 4.8,
    options: [
      { title: 'Ménage', totalPrice: 30, unitPrice: 30, quantity: 1, billedUnits: 1, inComplement: 1, offered: 0 },
      { title: 'Petit déjeuner', totalPrice: 16, unitPrice: 8, quantity: 2, billedUnits: 2, inComplement: 1, offered: 0 },
    ],
    resources: [],
  });
  const byLabel = Object.fromEntries(detail.detail.map((l) => [l.label, l]));
  assert.equal(byLabel['Ménage'].kind, 'option');
  assert.equal(byLabel['Ménage'].qty, 1);
  assert.equal(byLabel['Ménage'].unitPrice, 30);
  assert.equal(byLabel['Petit déjeuner'].qty, 2);   // billedUnits wins → « 2 × 8 = 16 »
  assert.equal(byLabel['Petit déjeuner'].unitPrice, 8);
  assert.equal(byLabel['Taxe de séjour'].kind, 'tax');
  // 30 + 16 + 4.80 = 50.80 = total → no remainder line.
  assert.ok(!detail.detail.some((l) => l.kind === 'remainder'));
});

// ── specs/sas-upsells-activate-catalogue-option.md ────────────────────────────────────────────────
// The ménage and the linge de toilette activate the CATALOGUE option instead of writing a custom
// line — otherwise the laundry + linen stock (which join `reservation_options → options`) never see
// the towels sold at check-in.

function seedCleaning(db, price = 40) {
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (50, 'Ménage', 'cleaning', ?, 'per_stay')").run(price);
  return 50;
}
function seedBathLinenOption(db, price = 8) {
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (60, 'Linge de toilette', 'bathroom_linen', ?, 'per_person')").run(price);
  return 60;
}

test('commitArrivalSas: « Ajouter le ménage » activates the catalogue option (no custom line)', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });

  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId);
  assert.ok(row, 'the catalogue option is attached');
  assert.equal(row.inComplement, 1, 'collected in the arrival complement');
  assert.equal(row.sasArrivalOrigin, 1, 'tagged as the SAS own line');
  assert.equal(row.totalPrice, 40);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reservation_custom_options WHERE reservationId = 1 AND description = 'Ménage'").get().n, 0);
  // 30 (pre-existing complement) + 40
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 70);
});

test('commitArrivalSas: bath linen is billed per person by the engine (2 adults + 1 child × 8 €)', () => {
  const db = makeDb();
  const optId = seedBathLinenOption(db, 8);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { bathLinenAdded: true });

  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId);
  assert.equal(row.billedUnits, 3, '3 persons (babies excluded)');
  assert.equal(row.unitPrice, 8);
  assert.equal(row.totalPrice, 24);
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 54); // 30 + 24
});

test('commitArrivalSas: the per-property price override wins', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (7, ?, 55)').run(optId);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });
  assert.equal(db.prepare('SELECT totalPrice t FROM reservation_options WHERE reservationId = 1').get().t, 55);
});

test('commitArrivalSas: « Non merci » on a re-run removes the SAS option and its amount', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 70);

  model.commitArrivalSas(1, { cleaningAdded: false });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId).n, 0);
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 30, 'back to the pre-SAS complement');
});

test('commitArrivalSas: re-running with the same answer never double-counts', () => {
  const db = makeDb();
  seedCleaning(db, 40);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });
  model.commitArrivalSas(1, { cleaningAdded: true });
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 70);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = 1').get().n, 1);
});

test('commitArrivalSas: an option the OPERATOR sold from the fiche is never removed by the SAS', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin) VALUES (1, ?, 1, 40, 1, ?, 40, 0, 0)')
    .run(optId, 'per_stay');
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: false });

  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId);
  assert.ok(row, 'operator line untouched');
  assert.equal(row.inComplement, 0, 'and its routing is untouched too');
});

test('commitArrivalSas: linen elements still ride the custom lines', () => {
  const db = makeDb();
  seedCleaning(db, 40);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true, complementItems: [{ label: "Taie d'oreiller", amount: 5 }] });
  const customs = db.prepare('SELECT description, amount FROM reservation_custom_options WHERE reservationId = 1').all();
  assert.deepEqual(customs, [{ description: "Taie d'oreiller", amount: 5 }]);
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 75); // 30 + 40 + 5
});

test('commitArrivalSas: a PAID complement freezes the upsell writes', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId).n, 0);
  assert.equal(db.prepare('SELECT complementAmount a FROM reservations WHERE id = 1').get().a, 30);
});

test('getSasUpsellOptions: resolves both offers, their engine price and where the row comes from', () => {
  const db = makeDb();
  seedCleaning(db, 40);
  const bathId = seedBathLinenOption(db, 8);
  const model = createReservationsModel(db);

  let out = model.getSasUpsellOptions(1);
  assert.equal(out.cleaning.totalPrice, 40);
  assert.equal(out.bathLinen.totalPrice, 24);
  assert.equal(out.bathLinen.present, false);
  assert.equal(out.bathLinen.sasOrigin, false);

  model.commitArrivalSas(1, { bathLinenAdded: true });
  out = model.getSasUpsellOptions(1);
  assert.equal(out.bathLinen.present, true);
  assert.equal(out.bathLinen.sasOrigin, true, 'ours → the step stays visible so it can be undone');

  db.prepare('UPDATE reservation_options SET sasArrivalOrigin = 0 WHERE reservationId = 1 AND optionId = ?').run(bathId);
  assert.equal(model.getSasUpsellOptions(1).bathLinen.sasOrigin, false, 'operator line → the step hides');
});

test('replaceOptions: the SAS marker survives a fiche save (delete + re-insert)', () => {
  const db = makeDb();
  const optId = seedCleaning(db, 40);
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cleaningAdded: true });

  // A fiche save re-writes every option line from the engine quote.
  model.replaceOptions(1, [{ optionId: optId, quantity: 1, unitPrice: 40, billedUnits: 1, priceType: 'per_stay', totalPrice: 40, inComplement: 1 }]);
  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = ?').get(optId);
  assert.equal(row.sasArrivalOrigin, 1, 'still removable from the SAS after a save');
});
