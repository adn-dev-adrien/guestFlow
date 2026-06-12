// Manual email queue — model + controller queue / pending-merge / dequeue.
// See specs/manual-email-from-template.md §4.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildController } = require('../controllers/emailsController');
const { buildModel: buildTemplatesModel } = require('../models/emailTemplatesModel');
const { buildModel: buildLogModel }       = require('../models/emailLogModel');
const { buildModel: buildManualQueueModel } = require('../models/emailManualQueueModel');

const DDL = `
  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp',
    errorMessage TEXT DEFAULT '', renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL,
    recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE email_manual_queue (
    templateId INTEGER NOT NULL, reservationId INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (templateId, reservationId)
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT,
    checkInTime TEXT, checkOutTime TEXT, cautionAmount REAL, cautionReceived INTEGER, depositPaid INTEGER
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT, updatedAt TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT);
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
`;

function fakeSettings() {
  return {
    read() { return { companyName: 'Demo', smtpHost: 'smtp.x', smtpFromEmail: 'from@x' }; },
    smtpConfigured() { return true; },
    decryptedSmtpSettings() { return { host: 'smtp.x', port: 587, secure: false, user: 'u', password: 'p', fromEmail: 'from@x', fromName: 'Demo' }; },
  };
}

function fakeEmailService(over = {}) {
  return () => ({ isConfigured: true, send: over.sendImpl || (async () => ({ accepted: ['x'] })), sendTest: async () => ({}) });
}

function res() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function makeFixture() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO email_templates (id, name, subject, body, dayOffset, sendMode, enabled) VALUES (10, 'J-1', 'Sujet {{clientFirstName}}', 'Hello {{clientFirstName}}', -1, 'manual', 1)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@dupont.fr')").run();
  // startDate far in the future → never in the date-driven window (proves the manual queue bypasses it).
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (100, 'reservation', 1, 1, '2099-07-10', '2099-07-13')").run();
  const templatesModel = buildTemplatesModel(db);
  const logModel = buildLogModel(db);
  const manualQueueModel = buildManualQueueModel(db);
  const ctl = buildController({
    database: db, templatesModel, logModel, manualQueueModel,
    settingsModel: fakeSettings(), emailServiceFactory: fakeEmailService(),
  });
  return { db, templatesModel, logModel, manualQueueModel, ctl };
}

// ---- model ----

test('model.add is idempotent on the (templateId, reservationId) primary key', () => {
  const { manualQueueModel } = makeFixture();
  assert.equal(manualQueueModel.add(10, 100), true);
  assert.equal(manualQueueModel.add(10, 100), false);
  assert.equal(manualQueueModel.has(10, 100), true);
});

test('model.remove deletes the pair', () => {
  const { manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  assert.equal(manualQueueModel.remove(10, 100), true);
  assert.equal(manualQueueModel.has(10, 100), false);
});

test('model.listEnriched joins template + reservation + client + lastSentAt', () => {
  const { manualQueueModel, logModel } = makeFixture();
  manualQueueModel.add(10, 100);
  logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@y.fr' });
  const rows = manualQueueModel.listEnriched();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].templateName, 'J-1');
  assert.equal(rows[0].clientFullName, 'Jean Dupont');
  assert.equal(rows[0].manual, 1);
  assert.ok(rows[0].lastSentAt);
});

// ---- controller: queue ----

test('queue: a never-sent pair queues directly', () => {
  const { ctl, manualQueueModel } = makeFixture();
  const r = res();
  ctl.queue({ body: { templateId: 10, reservationId: 100 } }, r);
  assert.deepEqual(r.body, { ok: true, queued: true });
  assert.equal(manualQueueModel.has(10, 100), true);
});

test('queue: already-sent pair without force → alreadySent + lastSentAt, NOT queued', () => {
  const { ctl, logModel, manualQueueModel } = makeFixture();
  logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@y.fr' });
  const r = res();
  ctl.queue({ body: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.alreadySent, true);
  assert.ok(r.body.lastSentAt);
  assert.equal(manualQueueModel.has(10, 100), false);
});

test('queue: already-sent pair WITH force → queued anyway', () => {
  const { ctl, logModel, manualQueueModel } = makeFixture();
  logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@y.fr' });
  const r = res();
  ctl.queue({ body: { templateId: 10, reservationId: 100, force: true } }, r);
  assert.deepEqual(r.body, { ok: true, queued: true });
  assert.equal(manualQueueModel.has(10, 100), true);
});

test('queue: 404 on unknown template / reservation', () => {
  const { ctl } = makeFixture();
  const r1 = res(); ctl.queue({ body: { templateId: 999, reservationId: 100 } }, r1);
  assert.equal(r1.statusCode, 404);
  const r2 = res(); ctl.queue({ body: { templateId: 10, reservationId: 999 } }, r2);
  assert.equal(r2.statusCode, 404);
});

// ---- controller: pending merge ----

test('pending: a manually-queued far-future pair shows even though it is outside the date window', () => {
  const { ctl, manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  const r = res();
  ctl.pending({ query: { today: '2026-01-01' } }, r);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].reservationId, 100);
  assert.equal(r.body[0].manual, 1);
});

test('pending: a manually-queued pair shows even when it was already sent (resend)', () => {
  const { ctl, logModel, manualQueueModel } = makeFixture();
  logModel.insert({ templateId: 10, reservationId: 100, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@y.fr' });
  manualQueueModel.add(10, 100);
  const r = res();
  ctl.pending({ query: { today: '2026-01-01' } }, r);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].manual, 1);
  assert.ok(r.body[0].lastSentAt);
});

// ---- controller: dequeue on send / acknowledge ----

test('send: a successful send removes the pair from the manual queue', async () => {
  const { ctl, manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(r.body.ok, true);
  assert.equal(manualQueueModel.has(10, 100), false);
});

test('acknowledge: removes the pair from the manual queue', () => {
  const { ctl, manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  const r = res();
  ctl.acknowledge({ params: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.ok, true);
  assert.equal(manualQueueModel.has(10, 100), false);
});

// ---- controller: eligibleReservations ----

test('eligibleReservations: returns compact rows, filterable by client name', () => {
  const { ctl } = makeFixture();
  const all = res(); ctl.eligibleReservations({ query: {} }, all);
  assert.equal(all.body.length, 1);
  assert.equal(all.body[0].clientFullName, 'Jean Dupont');
  assert.equal(all.body[0].propertyName, 'Villa A');

  const hit = res(); ctl.eligibleReservations({ query: { q: 'dupont' } }, hit);
  assert.equal(hit.body.length, 1);
  const miss = res(); ctl.eligibleReservations({ query: { q: 'martin' } }, miss);
  assert.equal(miss.body.length, 0);
});

// ── mark as sent (specs/mark-email-sent-manually.md) ────────────────────────────

test('markSent: logs status=sent + channel=manual, dequeues, leaves pending', () => {
  const { ctl, db, manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  const r = res();
  ctl.markSent({ params: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.ok, true);
  const log = db.prepare('SELECT status, channel FROM email_log').get();
  assert.equal(log.status, 'sent');
  assert.equal(log.channel, 'manual');
  assert.equal(manualQueueModel.has(10, 100), false);

  const p = res();
  ctl.pending({ query: { today: '2026-01-01' } }, p);
  assert.equal(p.body.length, 0);
});

test('markSent: idempotent — 2nd call returns alreadyHandled, no duplicate row', () => {
  const { ctl, db, manualQueueModel } = makeFixture();
  manualQueueModel.add(10, 100);
  ctl.markSent({ params: { templateId: 10, reservationId: 100 } }, res());
  const r2 = res();
  ctl.markSent({ params: { templateId: 10, reservationId: 100 } }, r2);
  assert.equal(r2.body.alreadyHandled, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 1);
});

test('markSent: works when the client has no email (no recipient required)', () => {
  const { ctl, db } = makeFixture();
  db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const r = res();
  ctl.markSent({ params: { templateId: 10, reservationId: 100 } }, r);
  assert.equal(r.body.ok, true);
  assert.equal(db.prepare("SELECT status FROM email_log").get().status, 'sent');
});

test('markSent: 404 on unknown template / reservation', () => {
  const { ctl } = makeFixture();
  const r1 = res(); ctl.markSent({ params: { templateId: 999, reservationId: 100 } }, r1);
  assert.equal(r1.statusCode, 404);
  const r2 = res(); ctl.markSent({ params: { templateId: 10, reservationId: 999 } }, r2);
  assert.equal(r2.statusCode, 404);
});

test('send (SMTP) logs channel=smtp; history exposes channel', async () => {
  const { ctl, db, logModel } = makeFixture();
  const r = res();
  await ctl.send({ body: { reservationId: 100, templateId: 10 } }, r);
  assert.equal(db.prepare("SELECT channel FROM email_log WHERE status='sent'").get().channel, 'smtp');
  assert.equal(logModel.history({}).rows[0].channel, 'smtp');
});
