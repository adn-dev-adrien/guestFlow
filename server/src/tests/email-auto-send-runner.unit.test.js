// Cron pass — iterates enabled auto templates × matching reservations.
// See specs/email-automation.md §3 rule 7.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { performAutoEmailPass } = require('../utils/emailAutoSendRunner');
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
    finalPrice REAL, depositAmount REAL, depositDueDate TEXT,
    balanceAmount REAL, balanceDueDate TEXT, cautionAmount REAL, depositPaid INTEGER
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL, inComplement INTEGER DEFAULT 0, offered INTEGER DEFAULT 0, sortOrder INTEGER);
`;

function fixture() {
  const db = new Database(':memory:');
  db.exec(DDL);

  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@d.fr'), (2, 'Marc', 'Nul', '')").run();
  // J-7 templates: ONE auto, ONE manual.
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (10, 'Auto J-7',  'A', 'B', -7, 'auto',   1)").run();
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (11, 'Man  J-7',  'A', 'B', -7, 'manual', 1)").run();
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (12, 'OffAuto',   'A', 'B', -7, 'auto',   0)").run();

  // Reservations whose startDate + (-7) = today (2026-07-03 → +7 = 2026-07-10).
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (100, 'reservation', 1, 1, '2026-07-10', '2026-07-13')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (101, 'reservation', 2, 1, '2026-07-10', '2026-07-13')").run();
  // Devis - excluded by the runner's kind filter.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (200, 'devis',       1, 1, '2026-07-10', '2026-07-13')").run();
  // Doesn't match the offset today.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (300, 'reservation', 1, 1, '2026-07-20', '2026-07-23')").run();

  return {
    db,
    templatesModel: buildTemplatesModel(db),
    logModel:       buildLogModel(db),
    settingsModel:  {
      read() { return { companyName: 'Demo', companyPhone: '01', companyEmail: 'd@x' }; },
      decryptedSmtpSettings() { return { host: 'smtp', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'f@x', fromName: 'Demo' }; },
    },
  };
}

function fakeEmailServiceFactory(override = {}) {
  return () => ({
    isConfigured: true,
    send: override.sendImpl || (async () => {}),
    sendTest: async () => {},
  });
}

test('runner: ships an email for each matching reservation × enabled-auto template', async () => {
  const f = fixture();
  const sent = [];
  const res = await performAutoEmailPass({
    database: f.db,
    templatesModel: f.templatesModel,
    logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: fakeEmailServiceFactory({ sendImpl: async (msg) => { sent.push(msg); } }),
    today: '2026-07-03',
  });
  // 2 reservations match J-7 today, but only client 100 has an email → 1 sent, 1 failed.
  assert.equal(res.sentCount, 1);
  assert.equal(res.failedCount, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'jean@d.fr');
});

test('runner: ignores manual templates entirely', async () => {
  const f = fixture();
  let counter = 0;
  await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: fakeEmailServiceFactory({ sendImpl: async () => { counter += 1; } }),
    today: '2026-07-03',
  });
  // The manual template `11` matches the same reservations but the cron must NOT send for it.
  const logsForManual = f.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE templateId = 11').get().n;
  assert.equal(logsForManual, 0);
  // Only the auto template ships → counter == 1 (the one client with an email).
  assert.equal(counter, 1);
});

test('runner: ignores disabled auto templates', async () => {
  const f = fixture();
  await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: fakeEmailServiceFactory(),
    today: '2026-07-03',
  });
  const logsForDisabled = f.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE templateId = 12').get().n;
  assert.equal(logsForDisabled, 0);
});

test('runner: ignores devis rows (kind != "reservation")', async () => {
  const f = fixture();
  await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: fakeEmailServiceFactory(),
    today: '2026-07-03',
  });
  const logsForDevis = f.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE reservationId = 200').get().n;
  assert.equal(logsForDevis, 0);
});

test('runner: skips reservations already in a sent state', async () => {
  const f = fixture();
  // Pre-existing sent row for template 10 × reservation 100.
  f.logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 'X', renderedBody: 'Y', recipientEmail: 'jean@d.fr' });

  const sent = [];
  const res = await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: fakeEmailServiceFactory({ sendImpl: async (m) => sent.push(m) }),
    today: '2026-07-03',
  });
  // Only the missing-email reservation should still attempt → fails (no email).
  assert.equal(sent.length, 0);
  assert.equal(res.sentCount, 0);
  assert.equal(res.skippedCount, 1, 'skipped the already-sent pair');
  assert.equal(res.failedCount, 1, 'failed on the no-email reservation');
});

test('runner: nodemailer throw → status=failed with error message', async () => {
  const f = fixture();
  const res = await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: () => ({
      isConfigured: true,
      send: async () => { throw new Error('boom'); },
    }),
    today: '2026-07-03',
  });
  // Both reservations fail — but for different reasons (no-email vs boom).
  assert.equal(res.failedCount, 2);
  const rows = f.db.prepare('SELECT reservationId, status, errorMessage FROM email_log').all();
  const byRes = Object.fromEntries(rows.map((r) => [r.reservationId, r]));
  assert.equal(byRes[100].errorMessage, 'boom');
  assert.equal(byRes[101].errorMessage, 'CLIENT_NO_EMAIL');
});

test('runner: EMAIL_NOT_CONFIGURED bubbles through with the right errorMessage marker', async () => {
  const f = fixture();
  await performAutoEmailPass({
    database: f.db, templatesModel: f.templatesModel, logModel: f.logModel,
    settingsModel: f.settingsModel,
    emailServiceFactory: () => ({
      isConfigured: false,
      send: async () => { const e = new Error('EMAIL_NOT_CONFIGURED'); e.code = 'EMAIL_NOT_CONFIGURED'; throw e; },
    }),
    today: '2026-07-03',
  });
  const row = f.db.prepare("SELECT errorMessage FROM email_log WHERE reservationId = 100").get();
  assert.equal(row.errorMessage, 'EMAIL_NOT_CONFIGURED');
});
