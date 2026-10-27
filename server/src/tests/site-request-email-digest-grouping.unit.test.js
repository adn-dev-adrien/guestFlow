// specs/public-request-abuse-and-grouping.md rule 31 (fixed at the 2026-10-27 spec review) — the
// 15-minute summary lists one line per QUOTE with how many requests it gathered (one stay sent 13 times
// read as 13 lines), and both the immediate e-mail and the summary write the stay's dates in French
// (the immediate one printed 2027-07-01).
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
    CREATE TABLE notification_digest_items (id INTEGER PRIMARY KEY AUTOINCREMENT, digestKey TEXT NOT NULL, refId INTEGER, kind TEXT NOT NULL, createdAt TEXT NOT NULL, takenAt TEXT);
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

test('rule 31: one stay sent thirteen times is one line, with its count', async () => {
  const db = seedDb();
  const sent = [];
  const clock = { now: Date.parse('2027-03-01T10:00:00Z') };
  const svc = service(db, sent, clock);
  await svc.notifyNewSiteDevis(1);
  clock.now += 60 * 1000;
  await svc.notifyNewSiteDevis(2);
  for (let i = 0; i < 12; i += 1) { clock.now += 10 * 1000; await svc.notifyNewSiteDevis(2, { updated: true }); }
  await svc.notifyNewSiteDevis(3, { updated: true });
  await svc.notifyNewSiteDevis(3, { updated: true, messageDropped: true });
  clock.now = Date.parse('2027-03-01T10:16:00Z');
  await svc.flushDueDigests();
  const summary = sent.at(-1);
  assert.equal(summary.subject, '1 nouvelle demande du site, 1 demande mise à jour');
  const lines = summary.text.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, [
    '- #2027-01-002 (nouvelle, puis 12 mises à jour) Marie Durand — Gîte, du 02/07/2027 au 12/07/2027, 300,00 €',
    '- #2027-01-003 (2 mises à jour, message non ajouté : limite atteinte) Marie Durand — Gîte, du 03/07/2027 au 13/07/2027, 300,00 €',
  ]);
});

test('rule 31: the immediate e-mail writes the stay in French dates, like the summary', async () => {
  const db = seedDb();
  const sent = [];
  const svc = service(db, sent, { now: Date.parse('2027-03-01T10:00:00Z') });
  await svc.notifyNewSiteDevis(1);
  assert.match(sent[0].text, /^Séjour : du 01\/07\/2027 au 11\/07\/2027$/m);
});
