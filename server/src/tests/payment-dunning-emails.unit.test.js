// Dunning emails (specs/payment-schedule-and-cancellation.md §3.7 rule 41): the two payment anchors
// — `depositDueDate` and `balanceDueDate` — in both the manual queue and the auto-send cron.
//
// The point of anchoring on the échéance rather than on the arrival: a reminder must fire relative to
// the money's own deadline, and must stop firing the moment that money arrives.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { performAutoEmailPass } = require('../utils/emailAutoSendRunner');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { buildModel: buildLogModel } = require('../models/emailLogModel');

const DDL = `
  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL,
    anchor TEXT NOT NULL DEFAULT 'start',
    sendMode TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp',
    errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT,
    checkInTime TEXT, checkOutTime TEXT,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    finalPrice REAL, depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    cautionAmount REAL, validUntil TEXT, devisStatus TEXT, convertedReservationId INTEGER
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, titleEn TEXT, autoOptionType TEXT, displayToClient INTEGER DEFAULT 1);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, nameEn TEXT);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL, inComplement INTEGER DEFAULT 0, offered INTEGER DEFAULT 0, sortOrder INTEGER);
`;

const TODAY = '2026-08-19';

function fixture({ sendMode = 'auto' } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Dupont', 'marie@example.com')").run();
  db.prepare(`INSERT INTO email_templates (id, stableKey, name, subject, body, anchor, dayOffset, sendMode)
              VALUES (10, 'deposit_reminder', 'Relance acompte', 'S', 'B', 'depositDueDate', 0, ?)`).run(sendMode);
  db.prepare(`INSERT INTO email_templates (id, stableKey, name, subject, body, anchor, dayOffset, sendMode)
              VALUES (11, 'balance_reminder', 'Relance solde', 'S', 'B', 'balanceDueDate', 3, ?)`).run(sendMode);
  return db;
}

function addReservation(db, { id, depositDueDate = null, depositPaid = 0, depositAmount = 274,
  balanceDueDate = null, balancePaid = 0, balanceAmount = 640, kind = 'reservation' }) {
  db.prepare(`INSERT INTO reservations
    (id, kind, clientId, propertyId, startDate, endDate, finalPrice,
     depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid)
    VALUES (?, ?, 1, 1, '2026-09-18', '2026-09-25', 914, ?, ?, ?, ?, ?, ?)`)
    .run(id, kind, depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid);
}

const emailServiceFactory = (sent) => () => ({
  isConfigured: true,
  send: async (msg) => { sent.push(msg); },
  sendTest: async () => {},
});

const settingsModel = {
  read: () => ({ companyName: 'Solio', companyPhone: '01', companyEmail: 'x@y' }),
  decryptedSmtpSettings: () => ({ host: 'smtp', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'f@x', fromName: 'Solio' }),
};

const runPass = (db, sent) => performAutoEmailPass({
  database: db,
  templatesModel: buildTemplatesModel(db),
  logModel: buildLogModel(db),
  settingsModel,
  emailServiceFactory: emailServiceFactory(sent),
  today: TODAY,
});

test('the acompte reminder fires on the acompte deadline, not on the arrival', async () => {
  const db = fixture();
  addReservation(db, { id: 100, depositDueDate: TODAY });          // due today → chased
  addReservation(db, { id: 101, depositDueDate: '2026-09-01' });   // not due yet
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 1);
  assert.equal(db.prepare("SELECT reservationId FROM email_log WHERE status = 'sent'").get().reservationId, 100);
  db.close();
});

test('the solde reminder fires 3 days after the solde deadline', async () => {
  const db = fixture();
  addReservation(db, { id: 100, balanceDueDate: '2026-08-16' });   // +3 = today
  addReservation(db, { id: 101, balanceDueDate: '2026-08-17' });   // +3 = tomorrow
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 1);
  assert.equal(db.prepare("SELECT reservationId FROM email_log WHERE status = 'sent'").get().reservationId, 100);
  db.close();
});

test('money that arrived is never chased, even on the exact deadline', async () => {
  const db = fixture();
  addReservation(db, { id: 100, depositDueDate: TODAY, depositPaid: 1 });
  addReservation(db, { id: 101, balanceDueDate: '2026-08-16', balancePaid: 1 });
  // Nothing owed at all: a 0 € échéance is not an unpaid one.
  addReservation(db, { id: 102, depositDueDate: TODAY, depositAmount: 0 });
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 0);
  assert.equal(sent.length, 0);
  db.close();
});

test('a devis is never dunned by the reservation anchors', async () => {
  const db = fixture();
  addReservation(db, { id: 200, kind: 'devis', depositDueDate: TODAY });
  const sent = [];
  assert.equal((await runPass(db, sent)).sentCount, 0);
  db.close();
});

test('one send per template × reservation, ever', async () => {
  const db = fixture();
  addReservation(db, { id: 100, depositDueDate: TODAY });
  const sent = [];
  assert.equal((await runPass(db, sent)).sentCount, 1);
  const second = await runPass(db, sent);
  assert.equal(second.sentCount, 0);
  assert.equal(second.skippedCount, 1);
  db.close();
});

test('an anchor the cron cannot query is skipped, not silently mailed to everyone', async () => {
  const db = fixture();
  db.prepare("UPDATE email_templates SET anchor = 'validUntil' WHERE id = 10").run();
  addReservation(db, { id: 100, depositDueDate: TODAY, balanceDueDate: null });
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 0);
  assert.ok(out.results.some((r) => r.status === 'skipped-unsupported-anchor'));
  db.close();
});

test('manual mode: the same anchors drive the pending queue', () => {
  const db = fixture({ sendMode: 'manual' });
  addReservation(db, { id: 100, depositDueDate: TODAY });
  addReservation(db, { id: 101, balanceDueDate: '2026-08-16' });
  addReservation(db, { id: 102, depositDueDate: TODAY, depositPaid: 1 }); // paid → out
  const pending = buildLogModel(db).listPending({ today: TODAY });
  assert.deepEqual(
    pending.map((p) => [p.reservationId, p.templateId]).sort((a, b) => a[0] - b[0]),
    [[100, 10], [101, 11]],
  );
  db.close();
});

test('a reservation with no deadline on the anchor is never scheduled', async () => {
  const db = fixture();
  addReservation(db, { id: 100, depositDueDate: null, balanceDueDate: null });
  const sent = [];
  assert.equal((await runPass(db, sent)).sentCount, 0);
  assert.equal(buildLogModel(db).listPending({ today: TODAY }).length, 0);
  db.close();
});
