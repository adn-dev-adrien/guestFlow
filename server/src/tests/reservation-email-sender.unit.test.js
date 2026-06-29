// reservationEmailSender (specs/online-payments-qonto.md §3.4): event-triggered send of a template by
// stableKey for a reservation — used to send the « Confirmation de réservation » email on payment.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { sendReservationTemplateEmail } = require('../utils/reservationEmailSender');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ email = 'jean@x.fr' } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  ensureDefaultEmailTemplates(db, { logger: { log() {} } });
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite des Pins')").run();
  db.prepare('INSERT INTO clients (id, firstName, lastName, email) VALUES (1, ?, ?, ?)').run('Jean', 'Dupont', email);
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice)
                           VALUES ('reservation', 1, 1, '2026-08-10', '2026-08-12', 2, 300)`).run();
  return { db, reservationId: Number(info.lastInsertRowid) };
}

const fakeSettings = {
  read: () => ({ companyName: 'Solio', companyPhone: '01 02 03 04 05', smtpFromName: 'Solio' }),
  decryptedSmtpSettings: () => ({ host: 'smtp', port: 587, user: 'u', password: 'p', fromEmail: 'no-reply@solio.fr', fromName: 'Solio' }),
};

function deps(db, sentBox, { sendImpl } = {}) {
  return {
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: fakeSettings,
    emailServiceFactory: () => ({ send: sendImpl || (async (msg) => { sentBox.push(msg); }) }),
    stableKey: 'reservation_confirmation',
  };
}

test('renders + sends the confirmation email and logs it as sent', async () => {
  const { db, reservationId } = seed();
  const sent = [];
  const r = await sendReservationTemplateEmail({ ...deps(db, sent), reservationId });

  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'jean@x.fr');
  assert.match(sent[0].subject, /Confirmation/i);
  assert.match(sent[0].text, /Jean/);          // {{clientFirstName}}
  assert.match(sent[0].text, /Gite des Pins/);  // {{propertyName}}
  assert.match(sent[0].text, /300/);            // {{finalPrice}}

  const log = db.prepare('SELECT status, recipientEmail FROM email_log WHERE reservationId = ?').get(reservationId);
  assert.equal(log.status, 'sent');
  assert.equal(log.recipientEmail, 'jean@x.fr');
});

test('no client email → does not send, returns no-email', async () => {
  const { db, reservationId } = seed({ email: '' });
  const sent = [];
  const r = await sendReservationTemplateEmail({ ...deps(db, sent), reservationId });
  assert.deepEqual({ sent: r.sent, reason: r.reason }, { sent: false, reason: 'no-email' });
  assert.equal(sent.length, 0);
});

test('SMTP failure → logs failed and returns sent:false, never throws', async () => {
  const { db, reservationId } = seed();
  const sent = [];
  const r = await sendReservationTemplateEmail({
    ...deps(db, sent, { sendImpl: async () => { throw new Error('connection refused'); } }),
    reservationId,
  });
  assert.equal(r.sent, false);
  const log = db.prepare('SELECT status, errorMessage FROM email_log WHERE reservationId = ?').get(reservationId);
  assert.equal(log.status, 'failed');
  assert.match(log.errorMessage, /connection refused/);
});

test('unknown reservation → no-reservation, no send', async () => {
  const { db } = seed();
  const sent = [];
  const r = await sendReservationTemplateEmail({ ...deps(db, sent), reservationId: 99999 });
  assert.equal(r.reason, 'no-reservation');
  assert.equal(sent.length, 0);
});
