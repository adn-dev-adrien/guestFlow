// Shared fixture of the bank reconciliation suites: the app's own database (temp file, full schema), the
// real core ledger and the real payment mark, the plugin's tables. No Qonto call anywhere.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = process.env.DB_PATH || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reco-')), 'reco.db');
const silent = console.log;
console.log = () => {};
const db = require('../../../database');
console.log = silent;

const { up } = require('../reconciliation/schema');
const { createBankTransactionsModel } = require('../reconciliation/bankTransactionsModel');
const { createReconciliationModel } = require('../reconciliation/reconciliationModel');
const { createFicheWriter } = require('../reconciliation/ficheWriter');
const { createReconciliationController } = require('../reconciliation/controller');
const { buildLedger } = require('../../../utils/reservationLedger');
const { parseGroup } = require('../../../utils/arrivalPaymentGroup');
const { platformDisplay } = require('../../../utils/platformDisplay');
const { applyPaymentMark, computePlatformCommission } = require('../../../utils/reservationPaymentMark');
const reservations = require('../../../models/reservationsModel');
const paymentLinks = require('../../../models/paymentLinksModel');

up(db);
db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gîte')").run();
db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName, email) VALUES (2, 'Lucia', 'Rossi', 'lucia@x.fr')").run();

db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Booking')").run();
db.prepare("UPDATE platforms SET commissionPercent = 16.44 WHERE name = 'Booking'").run();

const USER = { id: 1, role: 'admin' };
const TODAY = '2026-10-23';

let nextId = 100;
function addReservation(over = {}) {
  const id = over.id || (nextId += 1);
  const row = {
    id, kind: 'reservation', propertyId: 1, clientId: 1, startDate: '2026-11-10', endDate: '2026-11-12', adults: 2, platform: 'direct',
    finalPrice: 700, depositAmount: 0, balanceAmount: 700, depositDueDate: null, balanceDueDate: '2026-11-01', ...over,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  return id;
}

function credit(id, cents, over = {}) {
  return {
    id, amountCents: cents, currency: 'EUR', settledAt: '2026-10-12T08:00:00.000Z', emittedAt: '2026-10-12T07:00:00.000Z',
    updatedAt: '2026-10-12T08:00:00.000Z', operationType: 'income', label: 'ACME', counterpartyName: 'ACME', reference: '', note: '', ...over,
  };
}

function build({ connected = true, startDate = '2026-10-01', mark = applyPaymentMark, withQonto } = {}) {
  const store = new Map([['reconciliationBankAccountId', 'acc-1'], ['reconciliationStartDate', startDate]]);
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const transactions = createBankTransactionsModel(db);
  const model = createReconciliationModel(db);
  const writer = createFicheWriter({ model, applyPaymentMark: mark, computePlatformCommission, reservations });
  const calls = { qonto: 0, read: 0 };
  const controller = createReconciliationController({
    db, settings, transactions, model, writer,
    read: async () => { calls.read += 1; return { ok: true }; },
    connected: () => connected,
    withQonto: withQonto || (async () => { calls.qonto += 1; throw new Error('no Qonto call expected'); }),
    core: {
      buildLedger, parseGroup, platformDisplay, todayIso: () => TODAY,
      listLinks: (id) => paymentLinks.listForReservation(id),
    },
  });
  return { controller, transactions, model, settings, store, calls };
}

function reset() {
  ['bank_reconciliation_lines', 'bank_reconciliation_fiche_writes', 'bank_reconciliation_discards', 'bank_transactions_outside', 'bank_transactions']
    .forEach((t) => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare('DELETE FROM reservation_history').run();
  db.prepare('DELETE FROM payment_links WHERE reservationId >= 100').run();
  db.prepare('DELETE FROM reservations WHERE id >= 100').run();
}

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

module.exports = { db, USER, TODAY, addReservation, credit, build, reset, row };
