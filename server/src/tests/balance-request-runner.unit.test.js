// Balance-request daily pass (specs/public-online-deposit.md §3 rule 8, widened by
// specs/payment-schedule-and-cancellation.md §3.7 rule 38): selects every DIRECT reservation whose
// solde is due — whatever channel took the booking — and sends ONE balance_request each, deduped via
// email_log. Platform bookings are settled by the platform after the stay and never selected.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runBalanceRequestPass, selectEligible } = require('../utils/balanceRequestRunner');

function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', balancePaid INTEGER DEFAULT 0,
      balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, convertedReservationId INTEGER,
      platform TEXT DEFAULT 'direct');
    CREATE TABLE payment_links (id INTEGER PRIMARY KEY, reservationId INTEGER, type TEXT, status TEXT);
    CREATE TABLE email_log (id INTEGER PRIMARY KEY, templateId INTEGER, reservationId INTEGER, status TEXT);
  `);
  return db;
}

function addReservation(db, { resId, balanceAmount = 150, balanceDueDate = '2026-07-01', balancePaid = 0, platform = 'direct' }) {
  db.prepare("INSERT INTO reservations (id, kind, balancePaid, balanceAmount, balanceDueDate, platform) VALUES (?, 'reservation', ?, ?, ?, ?)")
    .run(resId, balancePaid, balanceAmount, balanceDueDate, platform);
}

const template = { id: 7, enabled: true };
const templatesModel = { findByStableKey: () => template };
const logModel = (db) => ({
  existsFor: (templateId, reservationId, statuses) =>
    Boolean(db.prepare(`SELECT 1 FROM email_log WHERE templateId=? AND reservationId=? AND status IN (${statuses.map(() => '?').join(',')}) LIMIT 1`).get(templateId, reservationId, ...statuses)),
});

test('selectEligible: every direct reservation whose solde is due, platforms excluded', () => {
  const db = seed();
  addReservation(db, { resId: 100 });                                  // eligible
  addReservation(db, { resId: 101, balancePaid: 1 });                  // already paid → out
  addReservation(db, { resId: 102, balanceDueDate: '2999-01-01' });    // not due yet → out
  addReservation(db, { resId: 104, balanceAmount: 0 });                // nothing to collect → out
  addReservation(db, { resId: 105, platform: 'Airbnb' });              // settled by the platform → out
  // The booking engine on our own website is a direct channel (platformNameFormat.DIRECT_CHANNELS).
  addReservation(db, { resId: 106, platform: 'Lodgify' });             // eligible
  // A booking taken by phone: no online deposit link anywhere. Used to be excluded, now covered.
  addReservation(db, { resId: 103, balanceAmount: 200 });

  const rows = selectEligible(db, '2026-07-02').map((r) => r.id);
  assert.deepEqual(rows, [100, 103, 106]);
});

test('sends one balance_request per eligible reservation and dedups on re-run', async () => {
  const db = seed();
  addReservation(db, { resId: 100 });
  addReservation(db, { resId: 200 });

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
  addReservation(db, { resId: 100 });
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
  addReservation(db, { resId: 100 });
  const out = await runBalanceRequestPass({ database: db, templatesModel: { findByStableKey: () => ({ id: 7, enabled: false }) }, logModel: logModel(db), sendBalanceRequest: async () => ({ httpStatus: 200 }), today: '2026-07-02' });
  assert.equal(out.sent, 0);
  assert.equal(out.reason, 'template-disabled');
});
