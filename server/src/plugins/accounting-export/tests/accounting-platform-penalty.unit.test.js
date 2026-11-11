// specs/reconciliation-assisted-matching.md rule 28 (and specs/accountant-accounting-export.md rule 36) —
// a platform penalty is an entry of its own: debit the penalty account, credit the client's account, no VAT,
// no 70xxx line, dated on the penalty; the balance entry only carries the lowered commission when the
// declaration moved the penalty out of the payout. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = process.env.DB_PATH || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-acc-pen-')), 'a.db');
const silent = console.log;
console.log = () => {};
const db = require('../../../database');
console.log = silent;

const accountingModel = require('../accountingModel');
const { entryToRows, entryToStructured, CSV_HEADERS, __test: { classifyLine } } = require('../accountingExport');
const { __test: { buildEntry } } = accountingModel;
const accountingController = require('../controller');
const penaltiesModel = require('../../../models/platformPenaltiesModel');

const ACCOUNT = CSV_HEADERS.indexOf('Compte');
const DEBIT = CSV_HEADERS.indexOf('Débit');
const CREDIT = CSV_HEADERS.indexOf('Crédit');

db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Booking')").run();
db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, adults, platform, finalPrice, balanceAmount, balancePaid, balancePaidDate)
  VALUES (7001, 'reservation', 1, 1, '2026-06-02', '2026-06-04', 2, 'Booking', 800, 800, 1, '2026-06-20')`).run();

const model = accountingModel.create(db);
const penaltyId = penaltiesModel.insert({ reservationId: 7001, amountCents: 4000, reason: 'Frais de relogement', date: '2026-06-26' });

test('rule 28 — a penalty is its own entry, dated on the penalty, in its month only', () => {
  const june = model.platformPenaltiesByMonth({ month: 6, year: 2026 });
  assert.equal(june.length, 1);
  assert.equal(june[0].paidDate, '2026-06-26');
  assert.equal(june[0].direction, 'penalty');
  assert.equal(june[0].penaltyId, penaltyId);
  assert.deepEqual(model.platformPenaltiesByMonth({ month: 7, year: 2026 }), []);
  assert.deepEqual(model.platformPenaltiesByMonth({ month: 5, year: 2026 }), []);
});

test('rule 28 — debit 658000, credit the client\'s account, balanced, no VAT and no 70xxx line', () => {
  const [entry] = model.platformPenaltiesByMonth({ month: 6, year: 2026 });
  const rows = entryToRows(entry);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0][ACCOUNT], rows[0][DEBIT]], ['658000', 40]);
  assert.deepEqual([rows[1][ACCOUNT], rows[1][CREDIT]], ['CDUPONT', 40]);
  assert.equal(rows.filter((r) => /^(70|4457|44566)/.test(String(r[ACCOUNT]))).length, 0);
  const structured = entryToStructured(entry);
  assert.equal(structured.balanced, true);
  assert.equal(structured.direction, 'penalty');
  assert.equal(structured.lines[0].accountLabel, 'Pénalité plateforme');
  assert.equal(classifyLine('658000'), 'other');
});

test('rule 28 — the penalty account is the plan\'s setting', () => {
  db.prepare("INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value) VALUES ('accounting-export', 'platformPenaltyAccount', '6580000')").run();
  try {
    const [entry] = accountingModel.create(db).platformPenaltiesByMonth({ month: 6, year: 2026 });
    assert.equal(entryToRows(entry)[0][ACCOUNT], '6580000');
  } finally {
    db.prepare("DELETE FROM plugin_settings WHERE plugin_id = 'accounting-export' AND key = 'platformPenaltyAccount'").run();
  }
});

test('rule 28 — the month\'s stream and the CSV carry the penalty entry, the two outputs agree', () => {
  const controller = accountingController.create(model);
  const json = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.salesJson({ query: { month: '6', year: '2026' } }, json);
  const penalty = json.body.entries.find((e) => e.direction === 'penalty');
  assert.ok(penalty);
  assert.equal(penalty.balanced, true);
  const csv = { headers: {}, sent: null, status() { return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.sent = b; return this; } };
  controller.salesCsv({ query: { month: '6', year: '2026' } }, csv);
  assert.ok(csv.sent.toString('latin1').split('\n').some((l) => l.split(';')[ACCOUNT] === '658000'));
});

test('rule 28 — a month without penalties is exactly what it was before', () => {
  const controller = accountingController.create(model);
  const json = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.salesJson({ query: { month: '3', year: '2026' } }, json);
  assert.equal(json.body.entries.filter((e) => e.direction === 'penalty').length, 0);
});

test('rule 28 — case « after »: the balance entry carries the lowered commission, nothing else of it changes', () => {
  const commissionContext = { defaultAccount: '622600', vatRateCommission: 20, platformByName: new Map([['booking', { name: 'Booking', commissionAccountNumber: '62260300', hasVatOnCommission: 1 }]]) };
  const base = {
    id: 7002, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Gîte', platform: 'Booking', finalPrice: 800, totalPrice: 800, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: 800, depositAmount: 0, depositPaid: 0, balanceAmount: 800, balancePaid: 1, balancePaidDate: '2026-06-20',
    complementAmount: 0, complementPaid: 0, accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
  const swallowed = buildEntry({ ...base, platformCommissionAmount: 229.98 }, 'balance', null, commissionContext);
  const declared = buildEntry({ ...base, platformCommissionAmount: 189.98 }, 'balance', null, commissionContext);
  assert.equal(swallowed.commission.ttc - declared.commission.ttc, 40);
  assert.equal(swallowed.encaissementTtc, declared.encaissementTtc, 'the revenue lines do not move');
  assert.deepEqual(entryToRows(swallowed).filter((r) => String(r[ACCOUNT]).startsWith('70')), entryToRows(declared).filter((r) => String(r[ACCOUNT]).startsWith('70')));
  assert.equal(entryToStructured(declared).balanced, true);
});

test('rule 28 — a removed penalty leaves the journal', () => {
  const id = penaltiesModel.insert({ reservationId: 7001, amountCents: 1000, reason: 'Non-conformité', date: '2026-08-02' });
  assert.equal(model.platformPenaltiesByMonth({ month: 8, year: 2026 }).length, 1);
  penaltiesModel.remove(id);
  assert.equal(model.platformPenaltiesByMonth({ month: 8, year: 2026 }).length, 0);
});
