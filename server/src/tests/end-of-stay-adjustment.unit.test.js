/**
 * specs/adjustable-complement-amounts.md §3.3 — ajustement du complément de fin de séjour.
 * L'invariant vérifié partout : `endOfStayComplementAmount` reste EXACTEMENT la somme de
 * `endOfStayComplementDetail`, ligne « Ajustement » comprise (et elle peut être négative).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { reconcileEndOfStayLines, isAdjustmentLine } = require('../utils/endOfStayAdjustment');
const { create: createReservationsModel } = require('../models/reservationsModel');
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

const round2 = (n) => Math.round(n * 100) / 100;
const total = (lines) => round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));

// ── util pur ────────────────────────────────────────────────────────────────

test('sans ajustement, les lignes et le total ne bougent pas', () => {
  const out = reconcileEndOfStayLines({ lines: [{ label: 'Ménage', amount: 60 }], override: null });
  assert.equal(out.amount, 60);
  assert.equal(out.lines.length, 1);
});

test('règle 18 — un ajustement à la baisse pose une ligne NÉGATIVE', () => {
  const out = reconcileEndOfStayLines({ lines: [{ label: 'Ménage', amount: 60 }], override: 45 });
  assert.equal(out.amount, 45);
  assert.equal(total(out.lines), 45, 'amount == Σ détail');
  const adj = out.lines.find(isAdjustmentLine);
  assert.equal(adj.amount, -15);
});

test('un ajustement à la hausse pose une ligne positive', () => {
  const out = reconcileEndOfStayLines({ lines: [{ label: 'Ménage', amount: 60 }], override: 75 });
  assert.equal(total(out.lines), 75);
  assert.equal(out.lines.find(isAdjustmentLine).amount, 15);
});

test('règle 21 — l\'ancienne ligne d\'ajustement est remplacée, jamais empilée', () => {
  const first = reconcileEndOfStayLines({ lines: [{ label: 'Ménage', amount: 60 }], override: 45 });
  const second = reconcileEndOfStayLines({ lines: first.lines, override: 50 });
  assert.equal(second.lines.filter(isAdjustmentLine).length, 1);
  assert.equal(total(second.lines), 50);
  const cleared = reconcileEndOfStayLines({ lines: second.lines, override: null });
  assert.equal(cleared.lines.filter(isAdjustmentLine).length, 0);
  assert.equal(cleared.amount, 60, 'vider l\'ajustement restitue la somme des vraies lignes');
});

test('aucune ligne réelle → la ligne « Ajustement » porte seule le montant', () => {
  const out = reconcileEndOfStayLines({ lines: [], override: 30 });
  assert.equal(out.lines.length, 1);
  assert.equal(total(out.lines), 30);
});

test('un ajustement égal aux lignes ne pose aucune ligne', () => {
  const out = reconcileEndOfStayLines({ lines: [{ label: 'Ménage', amount: 60 }], override: 60 });
  assert.equal(out.lines.filter(isAdjustmentLine).length, 0);
  assert.equal(out.amount, 60);
});

// ── point d'écriture unique (couche modèle) ─────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER, startDate TEXT, endDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementAmountOverride REAL, endOfStayComplementAmountOverride REAL, complementAllocation TEXT,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT DEFAULT NULL, midStaySettledNotes TEXT DEFAULT NULL,
      updatedAt TEXT
    );
  `);
  db.prepare("INSERT INTO reservations (id, startDate, endDate, endOfStayComplementAmount, endOfStayComplementDetail) VALUES (1, '2026-07-10', '2026-07-15', 60, ?)")
    .run(JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 60 }]));
  return db;
}
const stored = (db) => db.prepare('SELECT endOfStayComplementAmount AS amount, endOfStayComplementDetail AS detail FROM reservations WHERE id = 1').get();

test('règle 20 — l\'ajustement passe par le point d\'écriture unique : amount == Σ détail', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET endOfStayComplementAmountOverride = 45 WHERE id = 1').run();
  model.applyEndOfStayAdjustment(1);
  const row = stored(db);
  assert.equal(row.amount, 45);
  assert.equal(total(JSON.parse(row.detail)), 45);
  assert.equal(JSON.parse(row.detail).find(isAdjustmentLine).amount, -15);
});

test('règle 20 — la synchro des ventes en séjour ré-applique l\'ajustement', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET endOfStayComplementAmountOverride = 45 WHERE id = 1').run();
  model.applyEndOfStayAdjustment(1);
  // Une prestation vendue pendant le séjour arrive : les vraies lignes montent, l'ajustement suit.
  model.syncMidStayComplement(1, [{ label: 'Bière', unitPrice: 6.5, amount: 6.5, key: 'opt:12', source: MID_STAY_SOURCE }]);
  const row = stored(db);
  assert.equal(row.amount, 45, 'le montant annoncé tient');
  assert.equal(total(JSON.parse(row.detail)), 45);
  assert.equal(JSON.parse(row.detail).find(isAdjustmentLine).amount, -21.5); // 60 + 6,50 − 45
});

test('règle 22 — l\'ajustement s\'applique même sur un complément DÉJÀ encaissé', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementAmountOverride = 50 WHERE id = 1').run();
  model.applyEndOfStayAdjustment(1);
  assert.equal(stored(db).amount, 50);
});

test('vider l\'ajustement rend la main à la somme des lignes réelles', () => {
  const db = makeDb();
  const model = createReservationsModel(db);
  db.prepare('UPDATE reservations SET endOfStayComplementAmountOverride = 45 WHERE id = 1').run();
  model.applyEndOfStayAdjustment(1);
  db.prepare('UPDATE reservations SET endOfStayComplementAmountOverride = NULL WHERE id = 1').run();
  model.applyEndOfStayAdjustment(1);
  const row = stored(db);
  assert.equal(row.amount, 60);
  assert.equal(JSON.parse(row.detail).filter(isAdjustmentLine).length, 0);
});
