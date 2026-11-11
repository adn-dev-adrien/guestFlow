// specs/reservation-save-keeps-pricing.md rule 4 — the refund of a collected complement's excess is booked
// in the accounts when it goes back by transfer, and not at all when it goes back « caisse interne »
// (Adrien, 2026-10-29: the prefill defaults to the caisse interne when the complement was taken there).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const accountingModel = require('../accountingModel');
const refundsModel = require('../../../models/refundsModel');
const { buildRows, CSV_HEADERS } = require('../accountingExport');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');
const DEBIT = CSV_HEADERS.indexOf('Débit');
const ACCOUNT = CSV_HEADERS.indexOf('Compte');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Pré')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, finalPrice, touristTaxTotal)
              VALUES (1, 1, 1, '2026-08-10', '2026-08-17', 'direct', 480, 13.2)`).run();
  return { refunds: refundsModel.createModel(db), accounting: accountingModel.create(db) };
}

const linenExcess = (method) => ({
  refundDate: '2026-08-14', method, reason: 'Trop-perçu',
  totalTtc: 21,
  lines: [{ lineKey: 'free:0', label: 'Trop-perçu', bucket: 'options', quantity: 1, unitPrice: 21, amountTtc: 21, vatRate: 10 }],
});

test('the excess refunded by transfer is booked on the options account', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, linenExcess('transfer'));
  const rows = buildRows(accounting.refundsByMonth({ month: 8, year: 2026 }));
  assert.deepEqual(rows.map((r) => [String(r[ACCOUNT]), r[DEBIT]]).filter(([, v]) => Number(v) > 0), [['70600010', 19.09], ['44571100', 1.91]]);
});

test('the excess refunded « caisse interne » is booked nowhere', () => {
  const { refunds, accounting } = freshDb();
  refunds.create(1, linenExcess('internal'));
  assert.deepEqual(accounting.refundsByMonth({ month: 8, year: 2026 }), []);
});
