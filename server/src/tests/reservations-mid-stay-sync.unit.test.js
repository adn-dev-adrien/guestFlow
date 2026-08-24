// Base de référence + synchronisation du complément de fin de séjour (couche modèle).
// See specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rules 3-4 + §3.4 rule 11 + §3.5.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

const TODAY = '2026-07-11';

// `checkedIn` — specs/arrival-moment-is-the-check-in.md : c'est l'arrivée constatée (check-in ou
// SAS d'arrivée), et non la date du calendrier, qui ouvre la fenêtre « vendu en cours de séjour ».
function makeDb({ startDate = '2026-07-10', checkedIn = true } = {}) {
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
      arrivalExtrasBaseline TEXT DEFAULT NULL, midStaySettledNotes TEXT DEFAULT NULL,
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
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, adults, complementAmount, checkInDone) VALUES (1, 7, ?, '2026-07-15', 2, 30, ?)")
    .run(startDate, checkedIn ? 1 : 0);
  db.prepare("INSERT INTO options (id, title, price) VALUES (9, 'Petit-déjeuner', 12)").run();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, totalPrice) VALUES (1, 9, 1, 12, 1, 12)").run();
  return db;
}

const baselineOf = (db) => db.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = 1').get().arrivalExtrasBaseline;
const eosOf = (db) => db.prepare('SELECT endOfStayComplementAmount AS amount, endOfStayComplementDetail AS detail FROM reservations WHERE id = 1').get();

test('readExtraLines: options + ressources + lignes personnalisées, une offerte vaut 0', () => {
  const db = makeDb();
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (1, 3, 30)").run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered) VALUES (1, 'Ménage', 60, 0)").run();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered) VALUES (1, 'Cadeau', 20, 1)").run();
  const lines = createReservationsModel(db).readExtraLines(1);
  assert.deepEqual(lines.map((l) => l.totalPrice), [12, 30, 60, 0]);
});

test('capture — client pas encore arrivé → aucune base (comportement inchangé)', () => {
  const db = makeDb({ startDate: '2026-08-01', checkedIn: false });
  assert.equal(createReservationsModel(db).captureArrivalExtrasBaselineIfDue(1), null);
  assert.equal(baselineOf(db), null);
});

// specs/arrival-moment-is-the-check-in.md rule 1 — le bug remonté par Adrien : le jour de l'arrivée,
// avant tout check-in, une option ajoutée à la main partait au complément de fin de séjour.
test('capture — jour d\'arrivée atteint mais check-in pas fait → toujours aucune base', () => {
  const db = makeDb({ startDate: TODAY, checkedIn: false });
  assert.equal(createReservationsModel(db).captureArrivalExtrasBaselineIfDue(1), null);
  assert.equal(baselineOf(db), null, "rien n'est « vendu en cours de séjour » tant que le client n'est pas là");
});

test('capture — séjour commencé → la base fige les extras du moment', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1);
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12 });
});

test('capture — idempotente : une base existante n\'est jamais réécrite', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1);
  // Le client prend un 2e petit-déjeuner : la base ne doit PAS l'avaler.
  db.prepare('UPDATE reservation_options SET quantity = 2, totalPrice = 24 WHERE reservationId = 1').run();
  model.captureArrivalExtrasBaselineIfDue(1);
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12 });
});

test('sync — les lignes vendues en cours de séjour alimentent le complément de fin de séjour', () => {
  const db = makeDb();
  createReservationsModel(db).syncMidStayComplement(1, [
    { label: 'Petit-déjeuner', qty: 1, unitPrice: 12, amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
  ]);
  const eos = eosOf(db);
  assert.equal(eos.amount, 12);
  assert.deepEqual(JSON.parse(eos.detail).map((l) => l.label), ['Petit-déjeuner']);
});

test('sync — les lignes du SAS de départ sont préservées et le total recalculé', () => {
  const db = makeDb();
  db.prepare("UPDATE reservations SET endOfStayComplementAmount = 60, endOfStayComplementDetail = ? WHERE id = 1")
    .run(JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 60 }]));
  const model = createReservationsModel(db);
  model.syncMidStayComplement(1, [{ label: 'Petit-déjeuner', amount: 12, qty: 1, unitPrice: 12, source: MID_STAY_SOURCE, key: 'opt:9' }]);
  assert.equal(eosOf(db).amount, 72);

  // La prestation est retirée de la fiche → elle disparaît, le ménage reste.
  model.syncMidStayComplement(1, []);
  const eos = eosOf(db);
  assert.equal(eos.amount, 60);
  assert.deepEqual(JSON.parse(eos.detail).map((l) => l.label), ['Ménage de fin de séjour']);
});

test('sync — gelé dès que le complément de fin de séjour est encaissé (§3.5)', () => {
  for (const settled of ['endOfStayComplementPaid', 'endOfStayComplementPaidCash']) {
    const db = makeDb();
    db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 12, ${settled} = 1, endOfStayComplementDetail = ? WHERE id = 1`)
      .run(JSON.stringify([{ label: 'Petit-déjeuner', amount: 12, source: MID_STAY_SOURCE, key: 'opt:9' }]));
    createReservationsModel(db).syncMidStayComplement(1, [
      { label: 'Petit-déjeuner', amount: 24, qty: 2, unitPrice: 12, source: MID_STAY_SOURCE, key: 'opt:9' },
    ]);
    assert.equal(eosOf(db).amount, 12, `${settled}: un montant encaissé n'est jamais re-tarifé`);
  }
});

test('SAS d\'arrivée — ses propres lignes rejoignent la base (jamais du « vendu en cours de séjour »)', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1); // base capturée AVANT le SAS
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  assert.deepEqual(JSON.parse(baselineOf(db)), { 'opt:9': 12, 'custom:taie d\'oreiller': 5 });
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = 1').get().complementAmount, 35);
});

test('SAS d\'arrivée re-commité — la base suit le nouveau montant, sans avaler les ventes du séjour', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.captureArrivalExtrasBaselineIfDue(1);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  // Le client prend un 2e petit-déjeuner pendant le séjour…
  db.prepare('UPDATE reservation_options SET quantity = 2, totalPrice = 24 WHERE reservationId = 1').run();
  // …puis l'opérateur ré-ouvre le SAS d'arrivée pour corriger le linge.
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }, { label: 'Drap', amount: 9 }] });
  assert.deepEqual(
    JSON.parse(baselineOf(db)),
    { 'opt:9': 12, 'custom:taie d\'oreiller': 5, 'custom:drap': 9 },
    'le petit-déjeuner vendu pendant le séjour reste hors base',
  );
});

test('base absente (résa antérieure à la spec) — le SAS ne crée pas de base', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.commitArrivalSas(1, { complementItems: [{ label: 'Taie d\'oreiller', amount: 5 }] });
  assert.equal(baselineOf(db), null, 'la capture reste paresseuse : à la prochaine sauvegarde de fiche');
});

// ── Notes en séjour (specs/mid-stay-notes.md §3.1-§3.2 + §3.5) ───────────────

const notesOf = (db) => JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = 1').get().midStaySettledNotes || '[]');
const midLines = (db) => JSON.parse(eosOf(db).detail || '[]').filter((l) => l.source === MID_STAY_SOURCE);

// Two prestations sold during the stay and still to collect: 24 € of breakfast + 6 € of coke.
function withRemainder(db) {
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 90, endOfStayComplementDetail = ? WHERE id = 1')
    .run(JSON.stringify([
      { label: 'Ménage de fin de séjour', amount: 60 },
      { label: 'Petit-déjeuner', qty: 2, unitPrice: 12, amount: 24, source: MID_STAY_SOURCE, key: 'opt:9' },
      { label: 'Coca', qty: 2, unitPrice: 3, amount: 6, source: MID_STAY_SOURCE, key: 'opt:14' },
    ]));
  return createReservationsModel(db);
}

test('settle — une note multi-lignes déplace les montants stockés vers le registre', () => {
  const db = makeDb();
  const model = withRemainder(db);
  const note = model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 24 }, { key: 'opt:14', amount: 6 }], cash: false });

  assert.equal(note.id, 1);
  assert.equal(note.total, 30, 'le total est resommé par le serveur, jamais repris du client');
  assert.equal(note.paidCash, 0);
  assert.deepEqual(note.lines.map((l) => [l.label, l.amount]), [['Petit-déjeuner', 24], ['Coca', 6]]);
  assert.deepEqual(notesOf(db).map((n) => n.total), [30]);
  // Le reste à percevoir ne contient plus que la ligne du SAS.
  assert.equal(eosOf(db).amount, 60);
  assert.deepEqual(midLines(db), []);
});

test('settle — règlement PARTIEL d\'une clé : la ligne est scindée (cas du bar)', () => {
  const db = makeDb();
  const model = withRemainder(db);
  // Le client ne paie qu'un seul des deux petits-déjeuners.
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 12 }], cash: true });

  assert.equal(notesOf(db)[0].paidCash, 1);
  assert.equal(notesOf(db)[0].total, 12);
  const rest = midLines(db).find((l) => l.key === 'opt:9');
  assert.equal(rest.amount, 12, 'l\'autre petit-déjeuner reste à percevoir');
  assert.equal(rest.qty, 1, 'la ligne restante est reconstruite proprement');
  assert.equal(eosOf(db).amount, 78, '60 ménage + 12 restant + 6 coca');
});

test('settle — refus quand la clé n\'a plus rien à percevoir ou que le montant dépasse', () => {
  const db = makeDb();
  const model = withRemainder(db);
  assert.throws(() => model.settleMidStayNote(1, { items: [{ key: 'opt:99', amount: 5 }] }), /NOTE_AMOUNT_INVALID|Montant/);
  assert.throws(() => model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 25 }] }), (e) => e.code === 'NOTE_AMOUNT_INVALID');
  assert.deepEqual(notesOf(db), [], 'aucun effet de bord après un refus');
  assert.equal(eosOf(db).amount, 90);
});

test('settle — refus quand le complément de fin de séjour est déjà encaissé globalement', () => {
  const db = makeDb();
  const model = withRemainder(db);
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = 1').run();
  assert.throws(() => model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 24 }] }), (e) => e.code === 'END_OF_STAY_SETTLED');
});

test('cancel — les lignes de la note reviennent à percevoir, fusionnées par clé', () => {
  const db = makeDb();
  const model = withRemainder(db);
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 12 }] });
  // Entre-temps le client reprend un petit-déjeuner : la clé a de nouveau un reste.
  assert.equal(midLines(db).find((l) => l.key === 'opt:9').amount, 12);

  model.cancelMidStayNote(1, 1);
  assert.deepEqual(notesOf(db), []);
  const merged = midLines(db).filter((l) => l.key === 'opt:9');
  assert.equal(merged.length, 1, 'une seule ligne par clé après fusion');
  assert.equal(merged[0].amount, 24);
  assert.equal(eosOf(db).amount, 90, 'retour à l\'état initial');
});

test('cancel — note inconnue → NOTE_NOT_FOUND ; complément encaissé → refus', () => {
  const db = makeDb();
  const model = withRemainder(db);
  model.settleMidStayNote(1, { items: [{ key: 'opt:14', amount: 6 }] });
  assert.throws(() => model.cancelMidStayNote(1, 42), (e) => e.code === 'NOTE_NOT_FOUND');
  db.prepare('UPDATE reservations SET endOfStayComplementPaidCash = 1 WHERE id = 1').run();
  assert.throws(() => model.cancelMidStayNote(1, 1), (e) => e.code === 'END_OF_STAY_SETTLED');
});

test('sync — la resynchronisation du reste ne touche jamais au registre', () => {
  const db = makeDb();
  const model = withRemainder(db);
  model.settleMidStayNote(1, { items: [{ key: 'opt:14', amount: 6 }] });
  model.syncMidStayComplement(1, [{ label: 'Petit-déjeuner', qty: 2, unitPrice: 12, amount: 24, source: MID_STAY_SOURCE, key: 'opt:9' }]);
  assert.deepEqual(notesOf(db).map((n) => n.total), [6], 'la note survit à une sauvegarde de fiche');
  assert.equal(eosOf(db).amount, 84, '60 ménage + 24 restant');
});

test('resolveArrivalExtrasBaseline — base synthétisée pour l\'aperçu tant que rien n\'a été sauvegardé', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  // Séjour commencé, jamais re-sauvegardé : la base n'existe pas encore en base de données…
  assert.equal(baselineOf(db), null);
  // …mais l'aperçu doit déjà voir ce que la prochaine sauvegarde figera.
  assert.deepEqual(JSON.parse(model.resolveArrivalExtrasBaseline(1)), { 'opt:9': 12 });
  assert.equal(baselineOf(db), null, 'le chemin de lecture n\'écrit jamais');

  // Une fois capturée, c'est elle qui fait foi (même si les extras ont bougé depuis).
  model.captureArrivalExtrasBaselineIfDue(1);
  db.prepare('UPDATE reservation_options SET quantity = 3, totalPrice = 36 WHERE reservationId = 1').run();
  assert.deepEqual(JSON.parse(model.resolveArrivalExtrasBaseline(1)), { 'opt:9': 12 });
});

test('resolveArrivalExtrasBaseline — client pas encore arrivé → aucune base (aperçu inchangé)', () => {
  const db = makeDb({ startDate: '2026-08-01', checkedIn: false });
  assert.equal(createReservationsModel(db).resolveArrivalExtrasBaseline(1), null);
});

// Le filet de sécurité (rule 2) : un complément d'arrivée déjà encaissé est figé, donc une vente
// ultérieure doit avoir une base sur laquelle s'appuyer — sans quoi son montant n'atteint aucun bucket.
test('resolveArrivalExtrasBaseline — complément déjà encaissé → base synthétisée même sans check-in', () => {
  const db = makeDb({ startDate: '2026-08-01', checkedIn: false });
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  assert.deepEqual(JSON.parse(createReservationsModel(db).resolveArrivalExtrasBaseline(1)), { 'opt:9': 12 });
});
