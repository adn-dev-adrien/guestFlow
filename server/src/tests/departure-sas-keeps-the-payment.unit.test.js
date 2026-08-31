// specs/recall-unpaid-arrival-complement-at-checkout.md rule 9bis — le SAS départ ne défait que ce
// qu'il a encaissé lui-même.
//
// Le bug épinglé ici, constaté en production sur la réservation 22281 et **rejoué à l'identique dans
// le navigateur en dev** le 2026-08-31 : le client règle tout à la porte (« Encaisser en une fois »
// couvre le complément de fin de séjour depuis la v2.10.1), puis l'opérateur déroule le SAS départ.
// Le récap ne savait pas que l'argent était déjà rentré : aucun mode de règlement n'était
// pré-sélectionné, « Valider et terminer » envoyait donc `complementsSettled: false`, et le commit
// effaçait l'encaissement — laissant le groupe promettre une collecte dont une moitié était redevenue
// due, et deux écritures en comptabilité au lieu d'une carte.
//
// Le marqueur `endOfStayComplementPaidAtDeparture` est le miroir exact de `complementPaidAtArrival`
// côté arrivée : « pas maintenant » ne peut défaire qu'un encaissement que CE SAS a fait.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');

const GROUP = '{"at":"2026-08-30","cash":0,"total":184.95,"buckets":["balance","endOfStayComplement"]}';

function makeDb({ withMarker = true } = {}) {
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
      ${withMarker ? 'endOfStayComplementPaidAtDeparture INTEGER NOT NULL DEFAULT 0,' : ''}
      balanceAmount REAL NOT NULL DEFAULT 0, balancePaid INTEGER NOT NULL DEFAULT 0, balancePaidDate TEXT,
      arrivalPaymentGroup TEXT,
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
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 500)').run();
  return db;
}

// La forme exacte de la production : plateforme directe, acompte désactivé, aucun complément
// d'arrivée, 50 € de complément de fin de séjour — le tout encaissé à la porte le 30/08.
function seedPaidAtTheDoor(db) {
  db.prepare(`INSERT INTO reservations
    (id, propertyId, adults, startDate, endDate, balanceAmount, balancePaid, balancePaidDate,
     endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidDate,
     endOfStayComplementDetail, arrivalPaymentGroup, arrivalSasDoneAt)
    VALUES (1, 7, 2, '2026-08-30', '2026-08-31', 134.95, 1, '2026-08-30',
     50, 1, '2026-08-30',
     '[{"label":"Le repas des trappeurs","qty":2,"unitPrice":25,"amount":50,"source":"midStayExtra","key":"opt:16"}]',
     ?, '2026-08-30 16:30:00')`).run(GROUP);
  return db;
}

const read = (db) => db.prepare(`SELECT endOfStayComplementPaid AS paid, endOfStayComplementPaidDate AS date,
  endOfStayComplementAmount AS amount, endOfStayComplementPaidAtDeparture AS mine,
  arrivalPaymentGroup AS grp FROM reservations WHERE id = 1`).get();

// Ce que le récap envoie quand aucun mode de règlement n'est sélectionné : le geste EXACT qui a
// détruit le paiement de Harmen.
const VALIDATED_WITH_NO_MODE = { complementsSettled: false, extinguisherSealOkAtDeparture: 1 };

test('un complément encaissé À LA PORTE survit à un départ validé sans mode de règlement', () => {
  const db = seedPaidAtTheDoor(makeDb());
  createReservationsModel(db).commitDepartureSas(1, VALIDATED_WITH_NO_MODE);
  const r = read(db);
  assert.equal(r.paid, 1, 'toujours encaissé');
  assert.equal(r.date, '2026-08-30', "et à SA date, pas à celle du départ");
  // Le MONTANT du complément n'est pas assuré ici : le commit reconstruit le détail à partir de ce
  // que le récap renvoie, et la conservation d'une ligne vendue en séjour passe par la machinerie
  // mid-stay (baseline + notes) absente de ce schéma minimal. Vérifié dans le navigateur à la place —
  // les 50 € survivent au départ et se retrouvent dans la carte de la Comptabilité (§7 de la spec).
  assert.equal(r.mine, 0, "le SAS départ n'en est jamais devenu propriétaire");
  assert.equal(r.grp, GROUP, 'le paiement unique reste vrai');
});

test('le SAS départ encaisse : il devient propriétaire, et peut donc se dédire', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO reservations (id, propertyId, adults, endOfStayComplementAmount, endOfStayComplementPaid)
              VALUES (1, 7, 2, 50, 0)`).run();
  const model = createReservationsModel(db);

  model.commitDepartureSas(1, {
    complementsSettled: true,
    complementsPaidCash: false,
    endOfStayComplementDetail: [{ label: 'Ménage de fin de séjour', amount: 50 }],
  });
  assert.equal(read(db).paid, 1);
  assert.equal(read(db).amount, 50);
  assert.equal(read(db).mine, 1, "c'est bien lui qui a encaissé");

  // Il se ravise en rouvrant le SAS : là, et là seulement, il a le droit de défaire.
  model.commitDepartureSas(1, VALIDATED_WITH_NO_MODE);
  const r = read(db);
  assert.equal(r.paid, 0, 'il défait ce qu’il a fait');
  assert.equal(r.date, null);
  assert.equal(r.mine, 0, 'et il rend la propriété');
});

test('re-valider un départ sur un complément déjà réglé ailleurs n’en fait pas le propriétaire', () => {
  // Sinon le bug reviendrait d’un cran plus loin : le passage SUIVANT se croirait autorisé à
  // dé-payer l’argent de la porte. Trouvé au test de bout en bout, pas par le raisonnement.
  const db = seedPaidAtTheDoor(makeDb());
  const model = createReservationsModel(db);
  model.commitDepartureSas(1, { complementsSettled: true, complementsPaidCash: false });
  assert.equal(read(db).mine, 0, 'aucun encaissement n’a eu lieu ici');
  assert.equal(read(db).date, '2026-08-30', 'la date de la collecte réelle est conservée');

  model.commitDepartureSas(1, VALIDATED_WITH_NO_MODE);
  assert.equal(read(db).paid, 1, 'et le passage suivant ne peut toujours pas l’effacer');
});

test('le montant du complément n’est pas re-daté par un départ qui ne l’encaisse pas', () => {
  const db = seedPaidAtTheDoor(makeDb());
  createReservationsModel(db).commitDepartureSas(1, { complementsSettled: true });
  assert.equal(read(db).date, '2026-08-30');
});

test('sans la colonne marqueur, le comportement d’avant la règle 9bis est conservé', () => {
  // Plusieurs suites construisent un schéma minimal : elles ne connaissent aucun autre encaisseur
  // que le SAS, et doivent continuer de passer.
  const db = makeDb({ withMarker: false });
  db.prepare(`INSERT INTO reservations (id, propertyId, adults, endOfStayComplementAmount, endOfStayComplementPaid, endOfStayComplementPaidDate)
              VALUES (1, 7, 2, 50, 1, '2026-08-30')`).run();
  createReservationsModel(db).commitDepartureSas(1, VALIDATED_WITH_NO_MODE);
  const r = db.prepare('SELECT endOfStayComplementPaid AS paid FROM reservations WHERE id = 1').get();
  assert.equal(r.paid, 0);
});
