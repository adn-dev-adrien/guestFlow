// Emails controller — preview / send / pending / acknowledge / history. Mocks the SMTP
// transport entirely so a unit test can prove the routing without touching nodemailer.
// See specs/email-automation.md §4.1 + §4.3.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildController } = require('../controllers/emailsController');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { buildModel: buildLogModel }       = require('../models/emailLogModel');

const DDL = `
  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1,
    anchor TEXT NOT NULL DEFAULT 'start',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp',
    errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    platform TEXT,
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT,
    checkInTime TEXT, checkOutTime TEXT,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    finalPrice REAL, depositAmount REAL, depositDueDate TEXT,
    balanceAmount REAL, balanceDueDate TEXT, cautionAmount REAL, depositPaid INTEGER, balancePaid INTEGER,
    validUntil TEXT, devisStatus TEXT, convertedReservationId INTEGER
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT, phone TEXT,
    streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT,
    updatedAt TEXT
  );
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, titleEn TEXT, autoOptionType TEXT, displayToClient INTEGER DEFAULT 1);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, nameEn TEXT);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL, inComplement INTEGER DEFAULT 0, offered INTEGER DEFAULT 0, sortOrder INTEGER);
`;

function fakeSettings(extra = {}) {
  const { autoSendEnabled = true, ...rest } = extra;
  return {
    // Master switch (specs/no-automatic-email-without-approval.md §3 rule 1). Default ON here so the
    // queue keeps its historical shape unless a test says otherwise.
    emailAutoSendEnabled() { return autoSendEnabled; },
    read() {
      return { companyName: 'Demo', companyPhone: '01', companyEmail: 'd@x', smtpHost: 'smtp.x', smtpFromEmail: 'from@x', ...rest };
    },
    smtpConfigured() { return Boolean(this.read().smtpHost && this.read().smtpFromEmail); },
    decryptedSmtpSettings() { return { host: 'smtp.x', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'from@x', fromName: 'Demo' }; },
  };
}

// Dash-ISO date `days` from now — keeps date-window tests robust to the actual run date.
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeFixture(over = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (10, 'J-7', 'Sujet {{clientFirstName}}', 'Hello {{clientFirstName}}', -7, 'manual', 1)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@dupont.fr')").run();
  // Future-relative stay (J+7 → J+10): the history rolling window hides rows once
  // today > startDate + 3 days, so hardcoded July-2026 dates rotted after that month passed.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (100, 'reservation', 1, 1, ?, ?)").run(isoOffset(7), isoOffset(10));
  return {
    db,
    templatesModel: buildTemplatesModel(db),
    logModel:       buildLogModel(db),
    settingsModel:  fakeSettings(over.settings),
  };
}

function res() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeEmailService(over = {}) {
  return () => ({
    isConfigured: true,
    send: over.sendImpl || (async () => ({ accepted: ['x'] })),
    sendTest: async () => ({}),
  });
}

// ---- preview ----

test('preview: returns recipient + rendered subject + body + missingVariables', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.body.to, 'jean@dupont.fr');
  assert.equal(r.body.subject, 'Sujet Jean');
  assert.equal(r.body.body, 'Hello Jean');
  assert.deepEqual(r.body.missingVariables, []);
});

test('preview: deposit_reminder injects the open deposit link as {{paymentLink}}', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled, anchor) VALUES (20, 'deposit_reminder', 'Relance', 'Devis', '{{#if hasPaymentLink}}Lien : {{paymentLink}}{{else}}Aucun lien{{/if}}', -3, 'manual', 1, 'validUntil')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, validUntil, devisStatus) VALUES (300, 'devis', 1, 1, '2026-08-10', '2026-08-12', '2026-07-04', 'sent')").run();
  const paymentLinksModel = { findOpenForReservation: (id, type) => (id === 300 && type === 'deposit' ? { url: 'https://pay.qonto/pl_X' } : null) };

  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, paymentLinksModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: { reservationId: 300, templateId: 20 } }, r);
  assert.equal(r.body.body, 'Lien : https://pay.qonto/pl_X');
});

test('preview: deposit_reminder with no open link falls back to the no-link branch', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled, anchor) VALUES (20, 'deposit_reminder', 'Relance', 'Devis', '{{#if hasPaymentLink}}Lien : {{paymentLink}}{{else}}Aucun lien{{/if}}', -3, 'manual', 1, 'validUntil')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, validUntil, devisStatus) VALUES (300, 'devis', 1, 1, '2026-08-10', '2026-08-12', '2026-07-04', 'sent')").run();
  const paymentLinksModel = { findOpenForReservation: () => null };

  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, paymentLinksModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: { reservationId: 300, templateId: 20 } }, r);
  assert.equal(r.body.body, 'Aucun lien');
});

test('preview: 404 on unknown template', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: { reservationId: 100, templateId: 999 } }, r);
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.error, 'TEMPLATE_NOT_FOUND');
});

test('preview: 404 on unknown reservation', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: { reservationId: 999, templateId: 10 } }, r);
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.error, 'RESERVATION_NOT_FOUND');
});

test('preview: 400 when query params missing', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.preview({ query: {} }, r);
  assert.equal(r.statusCode, 400);
});

// ---- send ----

test('send: happy path renders + ships + logs status=sent', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const sent = [];
  const factory = fakeEmailService({ sendImpl: async (msg) => { sent.push(msg); } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: factory });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(sent[0].to, 'jean@dupont.fr');
  assert.equal(sent[0].subject, 'Sujet Jean');
  assert.equal(sent[0].text, 'Hello Jean');
  // Logged.
  const log = db.prepare('SELECT status FROM email_log').all();
  assert.equal(log[0].status, 'sent');
});

test('send: overrides.subject + overrides.body win over the template values', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const sent = [];
  const factory = fakeEmailService({ sendImpl: async (msg) => { sent.push(msg); } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: factory });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10, overrides: { subject: 'OVERRIDDEN', body: 'OVERRIDDEN body' } } }, r);
  assert.equal(sent[0].subject, 'OVERRIDDEN');
  assert.equal(sent[0].text, 'OVERRIDDEN body');
});

test('send: 409 EMAIL_NOT_CONFIGURED + logs failed when SMTP host missing', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture({ settings: { smtpHost: '' } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'EMAIL_NOT_CONFIGURED');
  const log = db.prepare('SELECT status, errorMessage FROM email_log').get();
  assert.equal(log.status, 'failed');
  assert.equal(log.errorMessage, 'EMAIL_NOT_CONFIGURED');
});

test('send: 404 CLIENT_NO_EMAIL when client has no email address', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.error, 'CLIENT_NO_EMAIL');
});

test('send: client with no email + operator-typed override.to → sends to it AND saves it on the client', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const sent = [];
  const factory = fakeEmailService({ sendImpl: async (msg) => { sent.push(msg); } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: factory });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10, overrides: { to: 'typed@guest.fr' } } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(sent[0].to, 'typed@guest.fr');
  // Logged against the typed recipient.
  assert.equal(db.prepare('SELECT recipientEmail FROM email_log').get().recipientEmail, 'typed@guest.fr');
  // Persisted onto the client record.
  assert.equal(db.prepare('SELECT email FROM clients WHERE id = 1').get().email, 'typed@guest.fr');
});

test('send: 404 CLIENT_NO_EMAIL when the client has none AND no override is typed', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10, overrides: { to: '   ' } } }, r);
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.error, 'CLIENT_NO_EMAIL');
});

test('send: 400 INVALID_EMAIL when the typed override is malformed', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10, overrides: { to: 'not-an-email' } } }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'INVALID_EMAIL');
});

test('send: a client that HAS an email ignores override.to and keeps its address', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const sent = [];
  const factory = fakeEmailService({ sendImpl: async (msg) => { sent.push(msg); } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: factory });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10, overrides: { to: 'hacker@evil.fr' } } }, r);
  assert.equal(sent[0].to, 'jean@dupont.fr');
  assert.equal(db.prepare('SELECT email FROM clients WHERE id = 1').get().email, 'jean@dupont.fr');
});

test('send: nodemailer throw → 500 + logs failed with the error message', async () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const factory = fakeEmailService({ sendImpl: async () => { const e = new Error('connection refused'); throw e; } });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: factory });
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.statusCode, 500);
  assert.equal(r.body.error, 'EMAIL_SEND_FAILED');
  const log = db.prepare('SELECT status, errorMessage FROM email_log').get();
  assert.equal(log.status, 'failed');
  assert.equal(log.errorMessage, 'connection refused');
});

// ---- acknowledge ----

test('acknowledge: logs a row with status=acknowledged-skip', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.acknowledge({ params: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.ok, true);
  const row = db.prepare('SELECT status FROM email_log').get();
  assert.equal(row.status, 'acknowledged-skip');
});

test('acknowledge: idempotent — a 2nd call returns alreadyHandled, no second row', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  ctl.acknowledge({ params: { templateId: 10, reservationId: 100 } }, res());
  const r = res();
  ctl.acknowledge({ params: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.alreadyHandled, true);
  const count = db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n;
  assert.equal(count, 1);
});

// ---- pending + history (smoke through the controller) ----

test('pending: routes through logModel.listPending', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  // The fixture stay starts at J+7, so the REAL today is exactly its J-7 send date.
  const r = res();
  ctl.pending({ query: { today: isoOffset(0) } }, r);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].templateId, 10);
  assert.equal(r.body[0].reservationId, 100);
});

test('pending: with automatic sending off, the auto templates join the review queue', () => {
  // specs/no-automatic-email-without-approval.md §3 rule 3 — the cron sends nothing, so its due
  // templates must surface here instead of disappearing.
  const { db, templatesModel, logModel, settingsModel } = makeFixture({ settings: { autoSendEnabled: false } });
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (11, 'Auto J-7', 'S', 'B', -7, 'auto', 1)").run();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });

  const r = res();
  ctl.pending({ query: { today: isoOffset(0) } }, r);
  assert.deepEqual(r.body.map((row) => row.templateId).sort(), [10, 11]);
});

test('pending: with automatic sending on, the auto templates stay the cron\'s business', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture({ settings: { autoSendEnabled: true } });
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (11, 'Auto J-7', 'S', 'B', -7, 'auto', 1)").run();
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });

  const r = res();
  ctl.pending({ query: { today: isoOffset(0) } }, r);
  assert.deepEqual(r.body.map((row) => row.templateId), [10], 'no double proposal');
});

test('send: an auto template proposed in the queue still sends on the operator\'s click', () => {
  // Rule 6 — an explicit click IS the approval, whatever the master switch says.
  const { db, templatesModel, logModel, settingsModel } = makeFixture({ settings: { autoSendEnabled: false } });
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (11, 'Auto J-7', 'Sujet {{clientFirstName}}', 'Hello', -7, 'auto', 1)").run();
  const sent = [];
  const ctl = buildController({
    database: db, templatesModel, logModel, settingsModel,
    emailServiceFactory: fakeEmailService({ sendImpl: async (msg) => { sent.push(msg); } }),
  });

  const r = res();
  return ctl.send({ body: { reservationId: 100, templateId: 11 } }, r).then(() => {
    assert.equal(r.body.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'jean@dupont.fr');
  });
});

test('history: paginated reply', () => {
  const { db, templatesModel, logModel, settingsModel } = makeFixture();
  logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 'S', renderedBody: 'B', recipientEmail: 'jean@dupont.fr' });
  const ctl = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory: fakeEmailService() });
  const r = res();
  ctl.history({ query: {} }, r);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.rows[0].status, 'sent');
});
