// specs/public-request-abuse-and-grouping.md rules 9 and 16 — the first website request of a 15-minute
// window is mailed at once, the following ones wait for ONE summary at the end of the window; an
// update reads « mise à jour », never « nouvelle ». The pending state is in the database, so a fresh
// service (a restart) sends what was waiting.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildNotificationService } = require('../utils/notificationService');
const { buildNotificationDigest } = require('../utils/notificationDigest');

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER, finalPrice REAL, touristTaxTotal REAL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, showsPlanningCard INTEGER DEFAULT 0);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, totalPrice REAL, offered INTEGER);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, totalPrice REAL, offered INTEGER);
    CREATE TABLE notification_digest_windows (digestKey TEXT PRIMARY KEY, windowStartedAt TEXT NOT NULL);
    CREATE TABLE notification_digest_items (id INTEGER PRIMARY KEY AUTOINCREMENT, digestKey TEXT NOT NULL, refId INTEGER, kind TEXT NOT NULL, createdAt TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Durand', 'm@example.fr')").run();
  for (let i = 1; i <= 5; i += 1) {
    db.prepare(`INSERT INTO reservations (id, kind, devisNumber, clientId, propertyId, startDate, endDate, adults, finalPrice)
      VALUES (?, 'devis', ?, 1, 1, '2027-07-0${i}', '2027-07-1${i}', 2, 300)`).run(i, `2027-01-00${i}`);
  }
  return db;
}

const settingsModel = {
  notificationSettings: () => ({ enabled: true, recipientEmail: 'owner@example.fr', fromEmail: 'noreply@example.fr', publicUrl: 'https://app.example.fr' }),
  smtpConfigured: () => true,
  decryptedSmtpSettings: () => ({}),
};

function service(db, sent, clock) {
  return buildNotificationService({
    db,
    settingsModel,
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { sent.push(m); } }),
    pushService: { sendToPref: async () => {} },
    logger: { warn() {} },
    digest: buildNotificationDigest({ db, now: () => clock.now }),
  });
}

test('rule 9: 5 requests in 15 minutes → 1 immediate e-mail, then 1 summary at the end of the window', async () => {
  const db = seedDb();
  const sent = [];
  const clock = { now: Date.parse('2027-03-01T10:00:00Z') };
  const svc = service(db, sent, clock);
  await svc.notifyNewSiteDevis(1);
  for (const id of [2, 3, 4]) { clock.now += 60 * 1000; await svc.notifyNewSiteDevis(id); }
  clock.now += 60 * 1000;
  await svc.notifyNewSiteDevis(5, { updated: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Nouvelle demande de devis #2027-01-001/);

  clock.now = Date.parse('2027-03-01T10:14:00Z');
  assert.deepEqual(await svc.flushDueDigests(), { sent: 0 }, 'not before the window ends');

  // A restart in between: a new service on the same database sends what was waiting.
  clock.now = Date.parse('2027-03-01T10:15:30Z');
  const restarted = service(db, sent, clock);
  assert.deepEqual(await restarted.flushDueDigests(), { sent: 1 });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject, '3 nouvelles demandes du site, 1 demande mise à jour');
  assert.match(sent[1].text, /#2027-01-005 \(mise à jour\) Marie Durand/);
  assert.match(sent[1].text, /Voir les devis : https:\/\/app\.example\.fr\/devis/);
  assert.deepEqual(await restarted.flushDueDigests(), { sent: 0 }, 'never twice');
});

test('rule 9: after a quiet window the next request is mailed at once again; an update says so', async () => {
  const db = seedDb();
  const sent = [];
  const clock = { now: Date.parse('2027-03-01T10:00:00Z') };
  const svc = service(db, sent, clock);
  await svc.notifyNewSiteDevis(1);
  clock.now += 16 * 60 * 1000;
  await svc.notifyNewSiteDevis(1, { updated: true });
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /^Demande de devis mise à jour #2027-01-001/);
  assert.match(sent[1].text, /le devis a été mis à jour/);
});
