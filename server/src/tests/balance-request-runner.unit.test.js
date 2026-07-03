// Balance-request daily pass (specs/public-online-deposit.md §3 rule 8): selects reservations whose
// online deposit is paid but whose solde is due, sends ONE balance_request each, deduped via email_log.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runBalanceRequestPass, selectEligible } = require('../utils/balanceRequestRunner');

function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', balancePaid INTEGER DEFAULT 0,
      balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, convertedReservationId INTEGER);
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, reservationId INTEGER, type TEXT, status TEXT);
    CREATE TABLE email_log (id INTEGER PRIMARY KEY, templateId INTEGER, reservationId INTEGER, status TEXT);
  `);
  return db;
}

// A devis (kind='devis') with a PAID deposit link that converted into a reservation `resId`.
function addDepositPaidReservation(db, { resId, devisId, balanceAmount = 150, balanceDueDate = '2026-07-01', balancePaid = 0 }) {
  db.prepare("INSERT INTO reservations (id, kind, balancePaid, balanceAmount, balanceDueDate) VALUES (?, 'reservation', ?, ?, ?)").run(resId, balancePaid, balanceAmount, balanceDueDate);
  db.prepare("INSERT INTO reservations (id, kind, convertedReservationId) VALUES (?, 'devis', ?)").run(devisId, resId);
  db.prepare("INSERT INTO payment_links (reservationId, type, status) VALUES (?, 'deposit', 'paid')").run(devisId);
}

const template = { id: 7, enabled: true };
const templatesModel = { findByStableKey: () => template };
const logModel = (db) => ({
  existsFor: (templateId, reservationId, statuses) =>
    Boolean(db.prepare(`SELECT 1 FROM email_log WHERE templateId=? AND reservationId=? AND status IN (${statuses.map(() => '?').join(',')}) LIMIT 1`).get(templateId, reservationId, ...statuses)),
});

test('selectEligible: only balance-due reservations with a paid deposit link', () => {
  const db = seed();
  addDepositPaidReservation(db, { resId: 100, devisId: 1 });               // eligible
  addDepositPaidReservation(db, { resId: 101, devisId: 2, balancePaid: 1 }); // already paid → out
  addDepositPaidReservation(db, { resId: 102, devisId: 3, balanceDueDate: '2999-01-01' }); // not due yet → out
  // A reservation with NO paid deposit link (deposit paid offline) → out.
  db.prepare("INSERT INTO reservations (id, kind, balancePaid, balanceAmount, balanceDueDate) VALUES (103, 'reservation', 0, 200, '2026-07-01')").run();

  const rows = selectEligible(db, '2026-07-02').map((r) => r.id);
  assert.deepEqual(rows, [100]);
});

test('sends one balance_request per eligible reservation and dedups on re-run', async () => {
  const db = seed();
  addDepositPaidReservation(db, { resId: 100, devisId: 1 });
  addDepositPaidReservation(db, { resId: 200, devisId: 2 });

  const sentTo = [];
  const sendBalanceRequest = async (id) => {
    sentTo.push(id);
    db.prepare("INSERT INTO email_log (templateId, reservationId, status) VALUES (?, ?, 'sent')").run(template.id, id);
    return { httpStatus: 200 };
  };
  const deps = { database: db, templatesModel, logModel: logModel(db), sendBalanceRequest, today: '2026-07-02' };

  const first = await runBalanceRequestPass(deps);
  assert.equal(first.sent, 2);
  assert.deepEqual(sentTo.sort(), [100, 200]);

  const second = await runBalanceRequestPass(deps); // both already 'sent' → skipped
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 2);
});

test('a failed send is not deduped → retried next run', async () => {
  const db = seed();
  addDepositPaidReservation(db, { resId: 100, devisId: 1 });
  let attempts = 0;
  const sendBalanceRequest = async () => { attempts++; return { httpStatus: 502 }; }; // fails, logs nothing
  const deps = { database: db, templatesModel, logModel: logModel(db), sendBalanceRequest, today: '2026-07-02' };

  const first = await runBalanceRequestPass(deps);
  assert.equal(first.failed, 1);
  const second = await runBalanceRequestPass(deps);
  assert.equal(second.failed, 1, 'retried (no sent row logged)');
  assert.equal(attempts, 2);
});

test('disabled/absent template → no-op', async () => {
  const db = seed();
  addDepositPaidReservation(db, { resId: 100, devisId: 1 });
  const out = await runBalanceRequestPass({ database: db, templatesModel: { findByStableKey: () => ({ id: 7, enabled: false }) }, logModel: logModel(db), sendBalanceRequest: async () => ({ httpStatus: 200 }), today: '2026-07-02' });
  assert.equal(out.sent, 0);
  assert.equal(out.reason, 'template-disabled');
});
