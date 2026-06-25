const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildNotificationService } = require('../utils/notificationService');

/**
 * Booking-notification service (specs/site-booking-notifications.md §3 rules 6–12).
 * Fully injected (db + settingsModel + email factory + logger) so we assert recipient/from/subject/
 * body/link and the skip + best-effort guarantees without any real SMTP.
 */

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
      finalPrice REAL, touristTaxTotal REAL, icalOriginalSummary TEXT, platform TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, totalPrice REAL, offered INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, totalPrice REAL, offered INTEGER);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Gîte du Domaine')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email, phone) VALUES (1, 'Marie', 'Durand', 'marie@example.com', '+33612345678')").run();
  db.prepare("INSERT INTO options (id, title) VALUES (6, 'Petit déjeuner'), (8, 'Linge de lit')").run();
  db.prepare("INSERT INTO resources (id, name) VALUES (2, 'Bain nordique')").run();
  db.prepare("INSERT INTO ical_sources (id, name) VALUES (5, 'Airbnb')").run();
  // A site devis (id 99) + its lines.
  db.prepare(`INSERT INTO reservations (id, kind, devisNumber, clientId, propertyId, startDate, endDate, adults, children, teens, babies, finalPrice, touristTaxTotal)
    VALUES (99, 'devis', '2026-06-00042', 1, 1, '2026-09-11', '2026-09-14', 2, 0, 0, 0, 348, 12)`).run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, offered) VALUES (99, 6, 2, 48, 0)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, offered) VALUES (99, 8, 2, 0, 1)').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, totalPrice, offered) VALUES (99, 2, 1, 30, 0)').run();
  // An iCal reservation (id 200).
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, icalOriginalSummary, platform, sourcePlatformKey, sourceIcalSourceId)
    VALUES (200, 'reservation', 1, 1, '2026-10-01', '2026-10-05', 'Jean (Airbnb)', 'airbnb', 'airbnb', 5)`).run();
  return db;
}

function makeFakeSettings({ enabled = true, icalReservationEnabled = true, recipientEmail = 'owner@example.com', fromEmail = 'noreply@example.com', publicUrl = 'https://app.example.com', smtpConfigured = true } = {}) {
  return {
    notificationSettings: () => ({ enabled, icalReservationEnabled, recipientEmail, fromEmail, publicUrl }),
    smtpConfigured: () => smtpConfigured,
    decryptedSmtpSettings: () => ({ host: 'smtp', fromEmail }),
  };
}

function makeFakeFactory(sent, { isConfigured = true, throwOnSend = false } = {}) {
  return () => ({
    isConfigured,
    send: async (msg) => {
      if (throwOnSend) throw new Error('SMTP boom');
      sent.push(msg);
      return { ok: true };
    },
  });
}

const silentLogger = { warn() {}, error() {} };

test('notifyNewSiteDevis sends TO the configured recipient with details + devis link', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(99);
  assert.equal(res.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.match(sent[0].subject, /Nouvelle demande de devis/);
  assert.match(sent[0].subject, /Le Gîte du Domaine/);
  assert.match(sent[0].text, /Marie Durand/);
  assert.match(sent[0].text, /Petit déjeuner/);
  assert.match(sent[0].text, /Linge de lit : offert/);
  assert.match(sent[0].text, /Bain nordique/);
  assert.match(sent[0].text, /https:\/\/app\.example\.com\/reservations\/new\?mode=devis&devisId=99/);
});

test('empty recipient falls back to the SMTP sender', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ recipientEmail: '' }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  await svc.notifyNewSiteDevis(99);
  assert.equal(sent[0].to, 'noreply@example.com');
});

test('empty publicUrl → email has no link', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ publicUrl: '' }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  await svc.notifyNewSiteDevis(99);
  assert.doesNotMatch(sent[0].text, /Ouvrir le devis/);
});

test('toggle OFF → nothing sent', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ enabled: false }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(99);
  assert.equal(res.sent, false);
  assert.equal(res.skipped, 'disabled');
  assert.equal(sent.length, 0);
});

test('SMTP not configured → nothing sent', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ smtpConfigured: false }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(99);
  assert.equal(res.sent, false);
  assert.equal(res.skipped, 'smtp_not_configured');
});

test('a send error is swallowed (best-effort, never throws)', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent, { throwOnSend: true }), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(99);
  assert.equal(res.sent, false);
  assert.equal(res.skipped, 'error');
});

test('notifyNewIcalReservation sends platform + guest + reservation link', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewIcalReservation(200);
  assert.equal(res.sent, true);
  assert.match(sent[0].subject, /Nouvelle réservation Airbnb/);
  assert.match(sent[0].text, /Jean \(Airbnb\)/);
  assert.match(sent[0].text, /https:\/\/app\.example\.com\/reservations\/200/);
});

test('per-channel toggle OFF → notifyNewIcalReservation skipped (ical_disabled), no send', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ icalReservationEnabled: false }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewIcalReservation(200);
  assert.equal(res.sent, false);
  assert.equal(res.skipped, 'ical_disabled');
  assert.equal(sent.length, 0);
});

test('per-channel iCal toggle does NOT affect the site-devis email', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ icalReservationEnabled: false }), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(99);
  assert.equal(res.sent, true);
  assert.equal(sent.length, 1);
});

test('missing row → skipped not_found, no send, no throw', async () => {
  const db = seedDb();
  const sent = [];
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent), logger: silentLogger });
  const res = await svc.notifyNewSiteDevis(123456);
  assert.equal(res.sent, false);
  assert.equal(res.skipped, 'not_found');
});

// ── Web Push trigger (specs/pwa-push-notifications.md §3.3) ──────────────────

function stubPush() {
  const calls = [];
  return { calls, sendToPref: async (pref, payload) => { calls.push({ pref, payload }); } };
}

test('notifyNewIcalReservation fires a « newReservation » push (independent of email settings)', async () => {
  const db = seedDb();
  const sent = [];
  const push = stubPush();
  // Email channel OFF — the push must still fire.
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings({ enabled: false }), emailServiceFactory: makeFakeFactory(sent), pushService: push, logger: silentLogger });
  await svc.notifyNewIcalReservation(200);
  assert.equal(sent.length, 0, 'email suppressed (disabled)');
  assert.equal(push.calls.length, 1);
  assert.equal(push.calls[0].pref, 'newReservation');
  assert.match(push.calls[0].payload.title, /Nouvelle réservation/);
  assert.match(push.calls[0].payload.body, /Jean \(Airbnb\) · Le Gîte du Domaine/);
  // The body now carries the stay dates + the number of nights (2026-10-01 → 2026-10-05 = 4 nights).
  assert.match(push.calls[0].payload.body, /du 01\/10\/2026 au 05\/10\/2026 · 4 nuits/);
  assert.equal(push.calls[0].payload.url, '/reservations/200');
});

test('notifyNewSiteDevis fires a « newReservation » push', async () => {
  const db = seedDb();
  const sent = [];
  const push = stubPush();
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent), pushService: push, logger: silentLogger });
  await svc.notifyNewSiteDevis(99);
  assert.equal(push.calls.length, 1);
  assert.equal(push.calls[0].pref, 'newReservation');
  assert.match(push.calls[0].payload.title, /Nouvelle demande de devis/);
  assert.match(push.calls[0].payload.body, /Marie Durand · Le Gîte du Domaine/);
});

test('a throwing push service never breaks the email path (isolation)', async () => {
  const db = seedDb();
  const sent = [];
  const push = { sendToPref: async () => { throw new Error('push boom'); } };
  const svc = buildNotificationService({ db, settingsModel: makeFakeSettings(), emailServiceFactory: makeFakeFactory(sent), pushService: push, logger: silentLogger });
  const res = await svc.notifyNewIcalReservation(200);
  assert.equal(res.sent, true, 'email still sent despite push throwing');
  assert.equal(sent.length, 1);
});
