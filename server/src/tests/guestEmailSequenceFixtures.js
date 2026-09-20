/**
 * Shared fixtures of the guest email sequence suites (specs/guest-email-sequence.md §7). Not a test
 * file: each suite imports what it needs, so no suite ever re-runs another.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { applyGuestEmailSequenceSchema } = require('../utils/guestEmailSequenceSchema');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

/** A fresh database: production baseline + the sequence schema + the seeded templates. */
function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  applyGuestEmailSequenceSchema(db);
  ensureDefaultEmailTemplates(db, { logger: { log() {} } });
  return db;
}

function seedProperty(db, { id = 1, name = 'La Granja', nameArticle = 'à', ...rest } = {}) {
  const row = { id, name, nameArticle, ...rest };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO properties (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return id;
}

function seedClient(db, { id = 1, firstName = 'Camille', lastName = 'Martin', email = 'camille@example.fr', ...rest } = {}) {
  const row = { id, firstName, lastName, email, ...rest };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return id;
}

function seedReservation(db, {
  kind = 'reservation', propertyId = 1, clientId = 1, startDate = '2027-07-10', endDate = '2027-07-17',
  createdAt = '2027-03-02 10:00:00', platform = 'direct', adults = 2, finalPrice = 1240, ...rest
} = {}) {
  const row = { kind, propertyId, clientId, startDate, endDate, createdAt, platform, adults, finalPrice, ...rest };
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return Number(info.lastInsertRowid);
}

/** A settings model stand-in: the switch, the start date and the copy settings. */
function settingsStub({ autoSend = true, startDate = '2026-01-01', ...extra } = {}) {
  const row = {
    companyName: 'Domaine Solio', companyPhone: '06 00 00 00 00', smtpFromName: 'Adrien et Sophie',
    guestSequenceStartDate: startDate, publicUrl: 'https://guestflow.example', ...extra,
  };
  return {
    read: () => row,
    emailAutoSendEnabled: () => autoSend,
    decryptedSmtpSettings: () => ({ host: 'smtp', fromEmail: 'f@x' }),
  };
}

/** A mailer that records every message; `failWith` makes it throw, `delayMs` makes it slow. */
function mailer({ failWith = null, delayMs = 0 } = {}) {
  const sent = [];
  const factory = () => ({
    isConfigured: true,
    async send(message) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (failWith) throw new Error(failWith);
      sent.push(message);
    },
  });
  return { sent, factory };
}

module.exports = { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer };
