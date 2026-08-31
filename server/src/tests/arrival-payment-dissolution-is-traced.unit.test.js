// specs/single-payment-at-check-in.md rule 8bis — la dissolution d'un paiement unique laisse une
// trace dans l'historique de la fiche.
//
// Pourquoi ce fichier existe : depuis la v2.9.0, un groupe pouvait disparaître sans une seule ligne
// d'historique. L'opérateur voyait son encaissement s'évaporer et n'avait AUCUN moyen de savoir ce qui
// l'avait effacé — il a fallu lire la base de production pour diagnostiquer les deux bugs du
// 2026-08-31 (l'enregistrement de la fiche, puis le SAS départ). La trace ne change aucun
// comportement : elle rend le comportement lisible depuis l'application.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');

const GROUP = JSON.stringify({
  at: '2026-08-30', cash: 0, total: 281.98, buckets: ['balance', 'endOfStayComplement'],
});

function makeDb({ withHistory = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, arrivalPaymentGroup TEXT,
      arrivalPaymentReduction REAL, arrivalPaymentTip REAL,
      complementPaidAtArrival INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    );
    ${withHistory ? `CREATE TABLE reservation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL,
      eventType TEXT NOT NULL DEFAULT 'update', changedFields TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT DEFAULT (datetime('now'))
    );` : ''}
  `);
  db.prepare('INSERT INTO reservations (id, arrivalPaymentGroup) VALUES (1, ?)').run(GROUP);
  return db;
}

const lines = (db) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = 1')
  .all().flatMap((r) => JSON.parse(r.changedFields));

test('dissoudre le paiement unique écrit ce qui disparaît, et à cause de quoi', () => {
  const db = makeDb();
  createReservationsModel(db).releaseArrivalPaymentGroup(1, 'balance');

  const [line] = lines(db);
  assert.equal(line.label, "Paiement unique à l'arrivée");
  // Le montant, la date et TOUT ce que la collecte couvrait : sans ça, l'opérateur ne peut pas
  // reconstituer ce qu'il avait encaissé.
  assert.equal(line.from, "281.98 € le 2026-08-30 (solde, complément de fin de séjour)");
  assert.equal(line.to, "dissous — « solde » n'est plus encaissé");
  assert.equal(db.prepare('SELECT arrivalPaymentGroup AS g FROM reservations WHERE id = 1').get().g, null);
});

test('la cause nomme la bonne échéance', () => {
  const db = makeDb();
  createReservationsModel(db).releaseArrivalPaymentGroup(1, 'endOfStayComplement');
  assert.equal(lines(db)[0].to, "dissous — « complément de fin de séjour » n'est plus encaissé");
});

test('une échéance que le groupe ne nomme pas ne dissout rien et n’écrit rien', () => {
  const db = makeDb();
  createReservationsModel(db).releaseArrivalPaymentGroup(1, 'deposit');
  assert.equal(lines(db).length, 0);
  assert.equal(db.prepare('SELECT arrivalPaymentGroup AS g FROM reservations WHERE id = 1').get().g, GROUP);
});

test('sans groupe, il n’y a rien à raconter', () => {
  const db = makeDb();
  db.prepare('UPDATE reservations SET arrivalPaymentGroup = NULL WHERE id = 1').run();
  createReservationsModel(db).releaseArrivalPaymentGroup(1, 'balance');
  assert.equal(lines(db).length, 0);
});

test('une seule ligne par dissolution, même si la relâche est rejouée', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  model.releaseArrivalPaymentGroup(1, 'balance');
  model.releaseArrivalPaymentGroup(1, 'balance');
  assert.equal(lines(db).length, 1);
});

test('sans table d’historique, la dissolution tient quand même', () => {
  // Plusieurs suites construisent un schéma minimal : la trace ne doit jamais faire échouer une
  // écriture d'argent.
  const db = makeDb({ withHistory: false });
  createReservationsModel(db).releaseArrivalPaymentGroup(1, 'balance');
  assert.equal(db.prepare('SELECT arrivalPaymentGroup AS g FROM reservations WHERE id = 1').get().g, null);
});
