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
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastNote TEXT, departureHandoverNote TEXT,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  // specs/caution-live-from-property.md §3 — commitArrivalSas freezes the property's caution on receipt.
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare("INSERT INTO reservations (id, propertyId, complementAmount, complementPaid, cautionAmount) VALUES (1, 7, 30, 0, 300)").run();
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
    breakfastNote: '  sans lactose  ',
    departureHandoverNote: '  clé sous le pot  ',
  });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastTea, breakfastChocolate, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '09:05');
  assert.equal(r.breakfastCoffee, 3);
  assert.equal(r.breakfastTea, 0);
  assert.equal(r.breakfastChocolate, 1);
  assert.equal(r.breakfastNote, 'sans lactose');
  assert.equal(r.departureHandoverNote, 'clé sous le pot');
});

test('commitArrivalSas: omitted breakfast fields default to 0 / null, breakfastTime untouched', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET breakfastTime = '08:30' WHERE id = 1").run();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { cautionReceived: true });
  const r = db.prepare('SELECT breakfastTime, breakfastCoffee, breakfastNote, departureHandoverNote FROM reservations WHERE id = 1').get();
  assert.equal(r.breakfastTime, '08:30');   // not passed → left as-is
  assert.equal(r.breakfastCoffee, 0);
  assert.equal(r.breakfastNote, null);
  assert.equal(r.departureHandoverNote, null);
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
