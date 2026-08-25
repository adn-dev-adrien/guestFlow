/**
 * Réparation de l'échéancier « solde = net » — specs/legacy-net-solde-schedule-repair.md.
 *
 * Le bug de production (réservation #7, Gîtes de France) : le solde stocké valait 903 € — le virement
 * réellement reçu — alors que la commission de 91 € était elle aussi enregistrée. Tout lecteur qui
 * déduit la commission de l'échéance la retirait donc une seconde fois : la fiche affichait
 * « encaissé 812 € » quand la banque et le journal comptable disaient 903 €.
 *
 * La migration remet la commission dans son échéance. Le contrat non négociable : le journal produit
 * après réparation est identique au centime près à celui d'avant — la branche de rattrapage de
 * l'export cesse simplement d'être nécessaire.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runLegacyNetSoldeRepair } = require('../utils/legacyNetSoldeRepair');
const { __test: { buildEntry } } = require('../models/accountingModel');
const { buildRows } = require('../utils/accountingExport');

const COMMISSION_CONTEXT = {
  defaultAccount: '622600', vatRateCommission: 20, vatRate: 10, platformByName: new Map(),
};

function repairDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY,
      kind TEXT DEFAULT 'reservation',
      platform TEXT,
      finalPrice REAL DEFAULT 0,
      touristTaxTotal REAL DEFAULT 0,
      depositAmount REAL DEFAULT 0,
      balanceAmount REAL DEFAULT 0,
      complementAmount REAL DEFAULT 0,
      endOfStayComplementAmount REAL DEFAULT 0,
      complementAmountOverride REAL,
      acompteCommissionAmount REAL,
      platformCommissionAmount REAL
    );
  `);
  return db;
}

function insert(db, row) {
  db.prepare(`
    INSERT INTO reservations (id, kind, platform, finalPrice, touristTaxTotal, depositAmount,
      balanceAmount, complementAmount, endOfStayComplementAmount, complementAmountOverride,
      acompteCommissionAmount, platformCommissionAmount)
    VALUES (@id, @kind, @platform, @finalPrice, @touristTaxTotal, @depositAmount, @balanceAmount,
      @complementAmount, @endOfStayComplementAmount, @complementAmountOverride,
      @acompteCommissionAmount, @platformCommissionAmount)
  `).run({
    kind: 'reservation', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 0,
    complementAmount: 0, endOfStayComplementAmount: 0, complementAmountOverride: null,
    acompteCommissionAmount: 0, platformCommissionAmount: 0, ...row,
  });
}

const read = (db, id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

// La forme historique exacte de la #7 : total 994 €, solde 903 € (net), commission 91 €.
const PARRETON = {
  id: 7, platform: 'GitesDeFrance', finalPrice: 994, balanceAmount: 903, platformCommissionAmount: 91,
};

test('le solde net redevient brut : la commission rejoint son échéance', () => {
  const db = repairDb();
  insert(db, PARRETON);

  const { repaired, ids } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 1);
  assert.deepEqual(ids, [7]);
  const row = read(db, 7);
  assert.equal(row.balanceAmount, 994);
  // L'échéancier somme de nouveau au total du séjour — c'est tout l'objet de la réparation.
  assert.equal(row.depositAmount + row.balanceAmount, row.finalPrice + row.touristTaxTotal);
});

test('le journal comptable est inchangé, au centime', () => {
  const before = buildEntry(
    { ...PARRETON, balancePaid: 1, balancePaidDate: '2026-05-21', firstName: 'Yann', lastName: 'Parreton' },
    'balance', null, COMMISSION_CONTEXT, { collectedOnArrival: false },
  );
  const db = repairDb();
  insert(db, PARRETON);
  runLegacyNetSoldeRepair(db);
  const after = buildEntry(
    { ...read(db, 7), balancePaid: 1, balancePaidDate: '2026-05-21', firstName: 'Yann', lastName: 'Parreton' },
    'balance', null, COMMISSION_CONTEXT, { collectedOnArrival: false },
  );

  assert.deepEqual(buildRows([after]), buildRows([before]));
  // Et ce journal est bien celui qu'on attend : 903 € au débit du client, 91 € de commission.
  assert.equal(after.encaissementNetTtc, 903);
});

test('chaque commission rejoint SON échéance', () => {
  const db = repairDb();
  insert(db, {
    id: 11, platform: 'Lodgify', finalPrice: 300, depositAmount: 90, balanceAmount: 190,
    acompteCommissionAmount: 6, platformCommissionAmount: 14,
  });

  runLegacyNetSoldeRepair(db);

  const row = read(db, 11);
  assert.equal(row.depositAmount, 96);
  assert.equal(row.balanceAmount, 204);
});

test('un échéancier déjà brut n\'est pas touché', () => {
  const db = repairDb();
  // La convention actuelle : les échéances portent le brut, la commission vit à côté.
  insert(db, {
    id: 22271, platform: 'Lodgify', finalPrice: 452.04, touristTaxTotal: 8.44,
    balanceAmount: 460.48, platformCommissionAmount: 11.76,
  });

  const { repaired } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 0);
  assert.equal(read(db, 22271).balanceAmount, 460.48);
});

test('une dérive qui ne vaut pas la commission n\'est pas touchée', () => {
  const db = repairDb();
  // #22226 en production : l'échéancier dépasse le total de 58 € (éditions après encaissement),
  // sans rapport avec les 6,82 € de commission. Les livres suivent l'argent, on n'invente rien.
  insert(db, {
    id: 22226, platform: 'Lodgify', finalPrice: 282.44, touristTaxTotal: 2.32,
    depositAmount: 126.38, balanceAmount: 126.38, complementAmount: 60, endOfStayComplementAmount: 30,
    acompteCommissionAmount: 3.41, platformCommissionAmount: 3.41,
  });

  const { repaired } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 0);
  assert.equal(read(db, 22226).balanceAmount, 126.38);
});

test('une réservation directe n\'a pas de commission à rendre', () => {
  const db = repairDb();
  insert(db, { id: 30, platform: 'direct', finalPrice: 500, balanceAmount: 450, platformCommissionAmount: 50 });

  const { repaired } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 0);
  assert.equal(read(db, 30).balanceAmount, 450);
});

test('un complément ajusté par l\'opérateur est laissé tel quel', () => {
  const db = repairDb();
  insert(db, {
    id: 31, platform: 'Lodgify', finalPrice: 300, balanceAmount: 250, complementAmount: 30,
    complementAmountOverride: 30, platformCommissionAmount: 20,
  });

  const { repaired } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 0);
});

test('une commission sans échéance où atterrir est signalée, pas réparée', () => {
  const db = repairDb();
  insert(db, {
    id: 32, platform: 'Lodgify', finalPrice: 300, depositAmount: 0, balanceAmount: 280,
    acompteCommissionAmount: 20, platformCommissionAmount: 0,
  });

  const { repaired, skipped } = runLegacyNetSoldeRepair(db);

  assert.equal(repaired, 0);
  assert.deepEqual(skipped, [32]);
  assert.equal(read(db, 32).depositAmount, 0);
});

test('rejouer la réparation ne change plus rien', () => {
  const db = repairDb();
  insert(db, PARRETON);

  runLegacyNetSoldeRepair(db);
  const afterFirst = read(db, 7);
  const second = runLegacyNetSoldeRepair(db);

  assert.equal(second.repaired, 0);
  assert.deepEqual(read(db, 7), afterFirst);
});
