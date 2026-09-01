// Indemnités d'annulation dans l'export comptable — specs/cancellation-compensation.md §3.3.
// Money comes IN like an encaissement, but against no séjour: one debit on the client account, one
// credit on the configured produit account, and a VAT line only if the operator made it taxable.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const accountingModel = require('../models/accountingModel');
const compensationsModel = require('../models/cancellationCompensationsModel');
const { buildRows, buildStructuredEntries, CSV_HEADERS, __test } = require('../utils/accountingExport');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const DEBIT = CSV_HEADERS.indexOf('Débit');
const CREDIT = CSV_HEADERS.indexOf('Crédit');
const ACCOUNT = CSV_HEADERS.indexOf('Compte');
const LIBELLE = CSV_HEADERS.indexOf("Libellé de l'écriture");
const PLATFORM = CSV_HEADERS.indexOf('Plateforme');

const money = (rows, index) => rows.map((r) => [String(r[ACCOUNT]), r[index]]).filter(([, v]) => Number(v) > 0);

const DRAFT = {
  propertyName: 'Le Lodge',
  platform: 'Airbnb',
  clientFirstName: 'Claire',
  clientLastName: 'Notin',
  startDate: '2026-09-04',
  endDate: '2026-09-07',
  cancelledStayAmount: 612.5,
  expectedAmount: 84,
  expectedDate: '2026-08-26',
  notes: '',
};

function freshDb({ vatRate = 0, account = null } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate, vatRateCancellationCompensation) VALUES (1, 10, ?)').run(vatRate);
  if (account) db.prepare('UPDATE app_settings SET cancellationCompensationAccount = ? WHERE id = 1').run(account);
  return { db, compensations: compensationsModel.buildModel(db), accounting: accountingModel.create(db) };
}

function banked(env, overrides = {}, receipt = { receivedAmount: 84, receivedDate: '2026-08-28' }) {
  const created = env.compensations.create({ ...DRAFT, ...overrides });
  env.compensations.receive(created.id, receipt);
  return created;
}

// specs/cancellation-compensation.md rule 16
test('the trigger case — an 84 € indemnity is one balanced entry, no VAT', () => {
  const env = freshDb();
  banked(env);

  const entries = env.accounting.compensationsByMonth({ month: 8, year: 2026 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'compensation');
  assert.equal(entries[0].direction, 'compensation');
  assert.equal(entries[0].paidDate, '2026-08-28');

  const rows = buildRows(entries);
  assert.equal(rows.length, 2, 'debit client + credit produit, nothing else');
  assert.deepEqual(money(rows, DEBIT), [['CNOTIN', 84]]);
  assert.deepEqual(money(rows, CREDIT), [['75880000', 84]]);
  assert.equal(rows[0][LIBELLE], 'CLAIRE NOTIN');
  assert.equal(rows[0][PLATFORM], 'Airbnb', 'the payer is reported on the anchor row');
});

// specs/cancellation-compensation.md rule 14
test('a pending compensation is not accounting — no money moved yet', () => {
  const env = freshDb();
  env.compensations.create(DRAFT);
  assert.deepEqual(env.accounting.compensationsByMonth({ month: 8, year: 2026 }), []);
});

// specs/cancellation-compensation.md rule 15
test('the month follows the payment date, not the cancelled stay', () => {
  const env = freshDb();
  banked(env, {}, { receivedAmount: 84, receivedDate: '2026-09-02' });
  assert.deepEqual(env.accounting.compensationsByMonth({ month: 8, year: 2026 }), []);
  assert.equal(env.accounting.compensationsByMonth({ month: 9, year: 2026 }).length, 1);
});

// specs/cancellation-compensation.md rule 19
test('taxable indemnity (10 %) splits HT / TVA and still balances', () => {
  const env = freshDb({ vatRate: 10 });
  banked(env, {}, { receivedAmount: 84, receivedDate: '2026-08-28' });

  const rows = buildRows(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  assert.deepEqual(money(rows, DEBIT), [['CNOTIN', 84]]);
  assert.deepEqual(money(rows, CREDIT), [['75880000', 76.36], ['44571100', 7.64]]);
  const sumDebits = rows.reduce((s, r) => s + Number(r[DEBIT] || 0), 0);
  const sumCredits = rows.reduce((s, r) => s + Number(r[CREDIT] || 0), 0);
  assert.equal(Math.round(sumDebits * 100) / 100, Math.round(sumCredits * 100) / 100);
});

test('a rounding-prone amount still balances to the cent', () => {
  const env = freshDb({ vatRate: 20 });
  banked(env, {}, { receivedAmount: 33.33, receivedDate: '2026-08-28' });
  const rows = buildRows(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  const sumDebits = rows.reduce((s, r) => s + Number(r[DEBIT] || 0), 0);
  const sumCredits = rows.reduce((s, r) => s + Number(r[CREDIT] || 0), 0);
  assert.equal(Math.round(sumDebits * 100) / 100, 33.33);
  assert.equal(Math.round(sumCredits * 100) / 100, 33.33);
});

// specs/cancellation-compensation.md rule 19
test('the produit account follows the setting — the entry is built at read time', () => {
  const env = freshDb({ account: '75880100' });
  banked(env);
  const rows = buildRows(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  assert.deepEqual(money(rows, CREDIT), [['75880100', 84]]);
});

// specs/cancellation-compensation.md rule 17
test('an unnamed client falls back to the compensation id, never to a dead reservation', () => {
  const env = freshDb();
  banked(env, { clientFirstName: '', clientLastName: '' });
  const rows = buildRows(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  assert.match(String(rows[0][LIBELLE]), /^INDEMNITÉ ANNULATION #\d+$/);
  assert.equal(rows[0][ACCOUNT], 'CXXXXX');
});

// specs/cancellation-compensation.md rule 18
test('the structured preview mirrors the CSV and carries the cancelled stay', () => {
  const env = freshDb();
  banked(env);
  const [entry] = buildStructuredEntries(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  assert.equal(entry.direction, 'compensation');
  assert.equal(entry.kind, 'compensation');
  assert.equal(entry.balanced, true);
  assert.equal(entry.sumDebits, 84);
  assert.equal(entry.stayShare, null, 'there is no séjour to take a share of');
  assert.equal(entry.platformName, 'Airbnb');
  assert.deepEqual(entry.compensationStay, { startDate: '2026-09-04', endDate: '2026-09-07' });
  assert.deepEqual(entry.lines.map((l) => [l.compte, l.type]), [['CNOTIN', 'client'], ['75880000', 'revenue']]);
  assert.equal(entry.lines[1].accountLabel, "Indemnité d'annulation");
});

// specs/cancellation-compensation.md rule 20
test('the produit account is classified as revenue, whatever 75xxxx the operator picks', () => {
  assert.equal(__test.classifyLine('75880000'), 'revenue');
  assert.equal(__test.classifyLine('75880100'), 'revenue');
});

test('no commission line, ever — the recorded amount IS the net wired', () => {
  const env = freshDb();
  banked(env);
  const rows = buildRows(env.accounting.compensationsByMonth({ month: 8, year: 2026 }));
  assert.equal(rows.some((r) => String(r[ACCOUNT]).startsWith('6226')), false);
});
