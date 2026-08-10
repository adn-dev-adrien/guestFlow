// Remboursements dans l'export comptable — specs/reservation-refunds.md §3.4 (rules 21–26).
// One avoir per non-internal refund, dated at the transfer, mirroring an encaissement: credit on the
// client auxiliary account, debits on the revenue accounts + VAT + the tourist-tax pass-through.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const accountingModel = require('../models/accountingModel');
const refundsModel = require('../models/refundsModel');
const { buildRows, buildStructuredEntries, CSV_HEADERS } = require('../utils/accountingExport');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const DEBIT = CSV_HEADERS.indexOf('Débit');
const CREDIT = CSV_HEADERS.indexOf('Crédit');
const ACCOUNT = CSV_HEADERS.indexOf('Compte');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)')
    .run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Pré')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, finalPrice, touristTaxTotal)
    VALUES (1, 1, 1, '2026-08-10', '2026-08-17', 'direct', 480, 13.2)
  `).run();
  return { db, refunds: refundsModel.createModel(db), accounting: accountingModel.create(db) };
}

const breakfastRefund = (overrides = {}) => ({
  refundDate: '2026-08-14',
  method: 'transfer',
  reason: 'Départ anticipé',
  totalTtc: 24,
  lines: [{ lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10 }],
  ...overrides,
});

const money = (rows, index) => rows.map((r) => [String(r[ACCOUNT]), r[index]]).filter(([, v]) => Number(v) > 0);

test('the trigger case — 2 breakfasts refunded produce one balanced avoir', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, breakfastRefund());

  const entries = accounting.refundsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'refund');
  assert.equal(entries[0].direction, 'refund');
  assert.equal(entries[0].paidDate, '2026-08-14');

  const rows = buildRows(entries);
  // Credit on the client account for the whole TTC…
  assert.deepEqual(money(rows, CREDIT), [['CDURAND', 24]]);
  // …and the mirrored debits: revenue HT on « prestations complémentaires » + the 10 % VAT.
  assert.deepEqual(money(rows, DEBIT), [['70600010', 21.82], ['44571100', 2.18]]);
  // Balanced to the cent.
  const sum = (i) => rows.reduce((s, r) => s + (Number(r[i]) || 0), 0);
  assert.equal(Math.round(sum(DEBIT) * 100) / 100, Math.round(sum(CREDIT) * 100) / 100);
});

test('each bucket lands on its own account; the tourist tax rides the pass-through with no VAT', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, {
    refundDate: '2026-08-14',
    method: 'transfer',
    totalTtc: 145.2,
    lines: [
      { lineKey: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, amountTtc: 110, vatRate: 10 },
      { lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 1, unitPrice: 12, amountTtc: 12, vatRate: 10 },
      { lineKey: 'res:2', label: 'Vélos', bucket: 'resources', quantity: null, unitPrice: null, amountTtc: 10, vatRate: 10 },
      { lineKey: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: null, unitPrice: null, amountTtc: 13.2, vatRate: 0 },
    ],
  });

  const rows = buildRows(accounting.refundsByMonth({ month: 8, year: 2026 }));
  const debits = Object.fromEntries(money(rows, DEBIT));
  assert.equal(debits['70600000'], 100);    // hébergement HT (110 TTC)
  assert.equal(debits['70600010'], 10.91);  // petit-déjeuner HT
  assert.equal(debits['70601000'], 9.09);   // vélos HT
  assert.equal(debits['46710000'], 13.2);   // taxe de séjour, sans TVA
  assert.equal(debits['44571100'], 12);     // TVA 10 % des trois lignes de revenu
  assert.deepEqual(money(rows, CREDIT), [['CDURAND', 145.2]]);
});

test('rule 26 — a caisse-interne refund never reaches the export', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, breakfastRefund({ method: 'internal' }));
  assert.deepEqual(accounting.refundsByMonth({ month: 8, year: 2026 }), []);
});

test('the month filter follows the refund date, not the stay', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, breakfastRefund({ refundDate: '2026-09-02' }));
  assert.equal(accounting.refundsByMonth({ month: 8, year: 2026 }).length, 0);
  assert.equal(accounting.refundsByMonth({ month: 9, year: 2026 }).length, 1);
});

test('rule 23 — a platform booking gets no commission line on its avoir', () => {
  const { db, refunds, accounting } = freshDb();
  db.prepare("UPDATE reservations SET platform = 'airbnb', platformCommissionAmount = 40 WHERE id = 1").run();
  refunds.create(1, breakfastRefund());

  const [entry] = accounting.refundsByMonth({ month: 8, year: 2026 });
  assert.equal(entry.commission, null);
  const rows = buildRows([entry]);
  assert.equal(rows.some((r) => String(r[ACCOUNT]).startsWith('6226')), false);
  assert.equal(rows.length, 3); // credit client + revenue HT + TVA
});

test('the structured preview mirrors the CSV and flags the entry as a refund', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, breakfastRefund());

  const entries = accounting.refundsByMonth({ month: 8, year: 2026 });
  const [structured] = buildStructuredEntries(entries);
  assert.equal(structured.direction, 'refund');
  assert.equal(structured.refundReason, 'Départ anticipé');
  assert.equal(structured.refundMethod, 'transfer');
  assert.equal(structured.stayShare, null, 'a refund covers no share of the séjour');
  assert.equal(structured.balanced, true);
  assert.equal(structured.sumDebits, 24);
  assert.equal(structured.sumCredits, 24);
  assert.equal(structured.lines.length, buildRows(entries).length);
  assert.deepEqual(structured.lines.map((l) => l.type), ['client', 'revenue', 'vat']);
});

test('an avoir whose HT/VAT split rounds off still balances to the cent', () => {
  const { refunds, accounting } = freshDb();
  // 0,05 € splits into 0,05 HT + 0,00 VAT — the residue lands on the last debit.
  refunds.create(1, breakfastRefund({ totalTtc: 0.05, lines: [{ lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: null, unitPrice: null, amountTtc: 0.05, vatRate: 10 }] }));
  const rows = buildRows(accounting.refundsByMonth({ month: 8, year: 2026 }));
  const sum = (i) => Math.round(rows.reduce((s, r) => s + (Number(r[i]) || 0), 0) * 100) / 100;
  assert.equal(sum(DEBIT), 0.05);
  assert.equal(sum(CREDIT), 0.05);
});

test('a devis is never refundable through the export', () => {
  const { db, refunds, accounting } = freshDb();
  db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = 1").run();
  refunds.create(1, breakfastRefund());
  assert.deepEqual(accounting.refundsByMonth({ month: 8, year: 2026 }), []);
});
