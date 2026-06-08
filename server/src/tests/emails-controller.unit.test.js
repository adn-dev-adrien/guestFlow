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
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL,
    errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT,
    checkInTime TEXT, checkOutTime TEXT,
    adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    finalPrice REAL, depositAmount REAL, depositDueDate TEXT,
    balanceAmount REAL, balanceDueDate TEXT, cautionAmount REAL, depositPaid INTEGER
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT, phone TEXT,
    streetNumber TEXT, street TEXT, postalCode TEXT, city TEXT,
    updatedAt TEXT
  );
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT);
`;

function fakeSettings(extra = {}) {
  return {
    read() {
      return { companyName: 'Demo', companyPhone: '01', companyEmail: 'd@x', smtpHost: 'smtp.x', smtpFromEmail: 'from@x', ...extra };
    },
    smtpConfigured() { return Boolean(this.read().smtpHost && this.read().smtpFromEmail); },
    decryptedSmtpSettings() { return { host: 'smtp.x', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'from@x', fromName: 'Demo' }; },
  };
}

function makeFixture(over = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (10, 'J-7', 'Sujet {{clientFirstName}}', 'Hello {{clientFirstName}}', -7, 'manual', 1)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@dupont.fr')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (100, 'reservation', 1, 1, '2026-07-10', '2026-07-13')").run();
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
  // Make sure today=2026-07-03 matches J-7 of startDate=2026-07-10.
  const r = res();
  ctl.pending({ query: { today: '2026-07-03' } }, r);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].templateId, 10);
  assert.equal(r.body[0].reservationId, 100);
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
