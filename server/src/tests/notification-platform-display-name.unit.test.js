// Fixed at the 2026-10-27 spec review (specs/site-booking-notifications.md rule 17): the operator's
// new-reservation e-mail and push name the platform as every page does — « GreenGo », « Gîtes de
// France » — never the stored key « Greengo » / « GitesDeFrance », when the iCal source has no name.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildNotificationService } = require('../utils/notificationService');

function seed(platform) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
      finalPrice REAL, touristTaxTotal REAL, icalOriginalSummary TEXT, platform TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, startDate, endDate, icalOriginalSummary, platform, sourcePlatformKey)
    VALUES (200, 'reservation', 1, '2027-10-01', '2027-10-05', 'Jean', ?, ?)`).run(platform, platform);
  return db;
}

async function notify(platform) {
  const sent = [];
  const pushes = [];
  const svc = buildNotificationService({
    db: seed(platform),
    settingsModel: {
      notificationSettings: () => ({ enabled: true, icalReservationEnabled: true, recipientEmail: 'owner@example.com', fromEmail: 'n@example.com', publicUrl: 'https://app.example.com' }),
      smtpConfigured: () => true,
      decryptedSmtpSettings: () => ({ host: 'smtp', fromEmail: 'n@example.com' }),
    },
    emailServiceFactory: () => ({ isConfigured: true, send: async (m) => { sent.push(m); return { ok: true }; } }),
    pushService: { sendToPref: async (pref, payload) => { pushes.push(payload); } },
    logger: { warn() {}, error() {} },
  });
  await svc.notifyNewIcalReservation(200);
  return { email: sent[0], push: pushes[0] };
}

test('GreenGo and Gîtes de France read as such in the e-mail subject, its body and the push title', async () => {
  for (const [key, name] of [['Greengo', 'GreenGo'], ['GitesDeFrance', 'Gîtes de France']]) {
    const { email, push } = await notify(key);
    assert.equal(email.subject, `Nouvelle réservation ${name} — La Granja`);
    assert.match(email.text, new RegExp(`Plateforme : ${name}`));
    assert.equal(push.title, `Nouvelle réservation ${name}`);
  }
});
