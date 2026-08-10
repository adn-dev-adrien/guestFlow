// Remboursement de taxe de séjour → déclaration à la commune (specs/reservation-refunds.md §3.5).
// Une nuit dont la taxe est rendue au client n'a pas été occupée : elle sort de la déclaration —
// la nuit, les nuitées taxables ET le montant, sur la ligne comme dans les totaux et le récap par
// logement. Tous moyens confondus, caisse interne comprise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const refundsModel = require('../models/refundsModel');
const { buildRefundableLines, validateRefundPayload, refundedTouristTax, round2 } = require('../utils/refunds');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');

function currentMonth() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, year: now.getFullYear(), m: now.getMonth() + 1 };
}

// 3 nuits × 2 adultes × 2,20 € = 13,20 € de taxe, soldée → la résa apparaît dans l'extraction du mois.
function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxPerDayPerPerson, touristTaxMode, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gîte du Pré', 2.20, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  const { year, m, month } = currentMonth();
  const start = `${year}-${pad2(m)}-12`;
  const end = `${year}-${pad2(m)}-15`;
  const paid = `${year}-${pad2(m)}-14`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults,
                touristTaxRate, touristTaxTotal, finalPrice, totalPrice, balanceAmount, balancePaid, balancePaidDate)
              VALUES (1, 'reservation', 1, 1, ?, ?, 'direct', 2, 2.20, 13.20, 300, 300, 313.20, 1, ?)`)
    .run(start, end, paid);
  return { db, month, model: financeModel.buildModel(db), refunds: refundsModel.createModel(db) };
}

const taxRefund = (nights, amount, method = 'transfer') => ({
  refundDate: `${currentMonth().year}-${pad2(currentMonth().m)}-16`,
  method,
  reason: 'Départ anticipé',
  totalTtc: amount,
  lines: [{
    lineKey: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax',
    quantity: nights, unitPrice: 4.4, amountTtc: amount, vatRate: 0,
  }],
});

const only = (extraction) => extraction.data.reservations[0];

test('la taxe est remboursable À LA NUIT : la ligne porte les nuits et le prix par nuit', () => {
  const lines = buildRefundableLines({
    finalPrice: 300, touristTaxTotal: 13.2, vatRate: 10, options: [], resources: [], refunds: [], nights: 3,
  });
  const tax = lines.find((l) => l.key === 'touristTax');
  assert.equal(tax.quantity, 3);
  assert.equal(tax.unitPrice, 4.4);
  assert.equal(tax.unitLabel, 'nuit');
  assert.equal(tax.billedTtc, 13.2);
  assert.equal(tax.vatRate, 0);
});

test('la quantité en nuits est DÉRIVÉE du montant côté serveur, jamais reprise du client', () => {
  const refundableLines = buildRefundableLines({
    finalPrice: 300, touristTaxTotal: 13.2, vatRate: 10, options: [], resources: [], refunds: [], nights: 3,
  });
  const result = validateRefundPayload(
    // Le client prétend 3 nuits pour 4,40 € : le serveur retient 1 nuit, celle que le montant paie.
    { refundDate: '2026-08-14', lines: [{ key: 'touristTax', quantity: 3, amountTtc: 4.4 }] },
    { refundableLines, finalPrice: 300, touristTaxTotal: 13.2, alreadyRefundedTotal: 0, vatRate: 10, today: '2026-08-20' },
  );
  assert.equal(result.refund.lines[0].quantity, 1);
  assert.equal(result.refund.lines[0].amountTtc, 4.4);
});

test('refundedTouristTax cumule tous les moyens et arrondit à la nuit entière', () => {
  const { amount, nights } = refundedTouristTax([
    { method: 'transfer', lines: [{ lineKey: 'touristTax', amountTtc: 4.4, quantity: 1 }] },
    { method: 'internal', lines: [{ lineKey: 'touristTax', amountTtc: 4.4, quantity: 1 }] },
    { method: 'transfer', lines: [{ lineKey: 'opt:7', amountTtc: 24, quantity: 2 }] },
  ]);
  assert.equal(amount, 8.8);
  assert.equal(nights, 2, 'la ligne option ne compte pas');
});

test('rule 30 — une nuit remboursée sort de la nuit, des nuitées taxables et du montant', () => {
  const { model, refunds, month } = seed();
  const before = only(model.getTouristTaxExtraction({ month }));
  assert.deepEqual(
    [before.nightsCount, before.adultNights, before.taxAmount],
    [3, 6, 13.2],
  );

  refunds.create(1, taxRefund(1, 4.4));
  const after = only(model.getTouristTaxExtraction({ month }));
  assert.deepEqual(
    [after.nightsCount, after.adultNights, after.taxAmount],
    [2, 4, 8.8],
  );
  // …et la ligne dit pourquoi (spec §6, « ligne annotée »).
  assert.equal(after.refundedTaxNights, 1);
  assert.equal(after.refundedTaxAmount, 4.4);
});

test('rule 30 — les totaux du mois et le récap par logement suivent le net', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, taxRefund(1, 4.4));
  const { data } = model.getTouristTaxExtraction({ month });

  assert.equal(data.totals.rentedNights, 2);
  assert.equal(data.totals.adultNights, 4);
  assert.equal(data.totals.taxAmount, 8.8);
  assert.deepEqual(
    data.byProperty.map((p) => [p.propertyName, p.nightsCount, p.adultNights, p.taxAmount]),
    [['Gîte du Pré', 2, 4, 8.8]],
  );
});

test('rule 29 — un remboursement en caisse interne sort AUSSI de la déclaration', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, taxRefund(1, 4.4, 'internal'));
  const after = only(model.getTouristTaxExtraction({ month }));
  assert.equal(after.nightsCount, 2);
  assert.equal(after.taxAmount, 8.8);
});

test('rule 31 — toute la taxe rendue : la réservation quitte la déclaration', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, taxRefund(3, 13.2));
  const { data } = model.getTouristTaxExtraction({ month });
  assert.deepEqual(data.reservations, []);
  assert.equal(data.totals.taxAmount, 0);
  assert.equal(data.totals.rentedNights, 0);
  assert.deepEqual(data.byProperty, []);
});

test('un remboursement trop petit pour libérer une nuit ne change RIEN à la déclaration', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, {
    refundDate: `${currentMonth().year}-${pad2(currentMonth().m)}-16`,
    method: 'transfer', reason: 'geste', totalTtc: 1,
    lines: [{ lineKey: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: 0.2273, unitPrice: 4.4, amountTtc: 1, vatRate: 0 }],
  });
  const after = only(model.getTouristTaxExtraction({ month }));
  // La commune est due sur les nuits occupées, pas sur ce que l'exploitant a gardé : un geste
  // commercial qui ne libère aucune nuit ne retire rien.
  assert.equal(after.nightsCount, 3);
  assert.equal(after.adultNights, 6);
  assert.equal(after.taxAmount, 13.2);
  assert.equal(after.refundedTaxAmount, 0);
});

test('la ligne reste cohérente avec sa propre arithmétique : net + retiré = brut', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, taxRefund(1, 4.4));
  const after = only(model.getTouristTaxExtraction({ month }));
  assert.equal(round2(after.taxAmount + after.refundedTaxAmount), 13.2);
  assert.equal(after.taxAmount, round2(after.adultNights * after.taxRate));
});

test('rembourser un petit-déjeuner ne touche pas la déclaration', () => {
  const { model, refunds, month } = seed();
  refunds.create(1, {
    refundDate: `${currentMonth().year}-${pad2(currentMonth().m)}-16`,
    method: 'transfer', reason: 'Petits-déjeuners non pris', totalTtc: 24,
    lines: [{ lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10 }],
  });
  const after = only(model.getTouristTaxExtraction({ month }));
  assert.deepEqual([after.nightsCount, after.adultNights, after.taxAmount], [3, 6, 13.2]);
  assert.equal(after.refundedTaxNights, 0);
});
