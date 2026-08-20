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
    cautionAmount REAL, validUntil TEXT, devisStatus TEXT, convertedReservationId INTEGER,
    platform TEXT NOT NULL DEFAULT 'direct'
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
  // The two REQUESTS. They never surface themselves (EVENT_TRIGGERED_STABLE_KEYS), but a reminder is
  // only queued once its request has actually left (rule 40bis), so tests need them to exist.
  db.prepare(`INSERT INTO email_templates (id, stableKey, name, subject, body, anchor, dayOffset, sendMode)
              VALUES (20, 'deposit_request', 'Demande acompte', 'S', 'B', 'start', 0, 'manual')`).run();
  db.prepare(`INSERT INTO email_templates (id, stableKey, name, subject, body, anchor, dayOffset, sendMode)
              VALUES (21, 'balance_request', 'Demande solde', 'S', 'B', 'start', 0, 'manual')`).run();
  return db;
}

// Record that the operator actually asked this reservation for that money.
function markRequestSent(db, reservationId, type) {
  db.prepare(`INSERT INTO email_log (templateId, reservationId, status, renderedSubject, renderedBody)
              VALUES (?, ?, 'sent', 'S', 'B')`)
    .run(type === 'deposit' ? 20 : 21, reservationId);
}

function addReservation(db, { id, depositDueDate = null, depositPaid = 0, depositAmount = 274,
  balanceDueDate = null, balancePaid = 0, balanceAmount = 640, kind = 'reservation', platform = 'direct' }) {
  db.prepare(`INSERT INTO reservations
    (id, kind, clientId, propertyId, startDate, endDate, finalPrice,
     depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid, platform)
    VALUES (?, ?, 1, 1, '2026-09-18', '2026-09-25', 914, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, kind, depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid, platform);
}

const emailServiceFactory = (sent) => () => ({
  isConfigured: true,
  send: async (msg) => { sent.push(msg); },
  sendTest: async () => {},
});

const settingsModel = {
  // The cron only runs when the operator authorised automatic sending
  // (specs/no-automatic-email-without-approval.md §3 rule 2) — these tests are about what it does
  // once allowed, so the switch is explicitly ON here.
  emailAutoSendEnabled: () => true,
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
  markRequestSent(db, 100, 'deposit');
  markRequestSent(db, 101, 'balance');
  markRequestSent(db, 102, 'deposit');
  const pending = buildLogModel(db).listPending({ today: TODAY });
  assert.deepEqual(
    pending.map((p) => [p.reservationId, p.templateId]).sort((a, b) => a[0] - b[0]),
    [[100, 10], [101, 11]],
  );
  db.close();
});

// ── 2026-08-20 amendment: money is proposed, never sent by a cron ─────────────────────────────

test('a reminder is not queued until its own request has actually left (rule 40bis)', () => {
  const db = fixture({ sendMode: 'manual' });
  addReservation(db, { id: 100, depositDueDate: TODAY });
  const logModel = buildLogModel(db);
  assert.deepEqual(
    logModel.listPending({ today: TODAY }), [],
    'the guest was never asked — the reminder would render a payment link that does not exist',
  );
  markRequestSent(db, 100, 'deposit');
  assert.deepEqual(logModel.listPending({ today: TODAY }).map((p) => p.reservationId), [100]);
  db.close();
});

test('a platform booking never enters the queue on a payment anchor (rule 40ter)', () => {
  const db = fixture({ sendMode: 'manual' });
  addReservation(db, { id: 100, balanceDueDate: '2026-08-16', platform: 'Airbnb' });
  addReservation(db, { id: 101, depositDueDate: TODAY, platform: 'Booking' });
  addReservation(db, { id: 102, balanceDueDate: '2026-08-16', platform: 'Lodgify' }); // own channel
  [100, 101, 102].forEach((id) => { markRequestSent(db, id, 'deposit'); markRequestSent(db, id, 'balance'); });
  assert.deepEqual(
    buildLogModel(db).listPending({ today: TODAY }).map((p) => p.reservationId), [102],
    'the cron has filtered the channel since PR #458; going manual must not reopen that door',
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

// ── Channel filter (specs/platform-payout-due-date.md §3.3 rules 22-23) ───────────────────────

test('a money template never leaves for a platform booking — its solde is the platform\'s', async () => {
  const db = fixture();
  addReservation(db, { id: 100, balanceDueDate: '2026-08-16', platform: 'Airbnb' });
  addReservation(db, { id: 101, depositDueDate: TODAY, platform: 'Booking' });
  // Same deadlines on our own channels: those DO get chased.
  addReservation(db, { id: 102, balanceDueDate: '2026-08-16', platform: 'direct' });
  addReservation(db, { id: 103, balanceDueDate: '2026-08-16', platform: 'Lodgify' });
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 2);
  const chased = db.prepare("SELECT reservationId FROM email_log WHERE status = 'sent' ORDER BY reservationId").all();
  assert.deepEqual(chased.map((r) => r.reservationId), [102, 103]);
  db.close();
});

test('an empty platform reads as direct, and is chased like one', async () => {
  const db = fixture();
  addReservation(db, { id: 100, balanceDueDate: '2026-08-16', platform: '' });
  addReservation(db, { id: 101, balanceDueDate: '2026-08-16', platform: '   ' });
  const sent = [];
  const out = await runPass(db, sent);
  assert.equal(out.sentCount, 2, 'a blank channel is a direct booking, not a platform one');
  db.close();
});
