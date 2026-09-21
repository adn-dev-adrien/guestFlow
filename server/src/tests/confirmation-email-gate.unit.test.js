/**
 * The confirmation email fired by a confirmed online payment, gated by the confirmation template's
 * own mode (specs/no-automatic-email-without-approval.md §3 rule 4, specs/settings-rationalization.md
 * rule 17b).
 *
 * A paid link is not an operator action: nobody read that email before it left. With the template in
 * « manual », the confirmation must be PROPOSED — queued for review — and never sent. In « auto », it
 * leaves straight away.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildGatedConfirmationSender } = require('../utils/reservationEmailSender');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, emailLanguage TEXT, platform TEXT DEFAULT 'direct', createdAt TEXT
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, emailLanguage TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, titleEn TEXT, autoOptionType TEXT, displayToClient INTEGER DEFAULT 1);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, nameEn TEXT);
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER);
  CREATE TABLE guest_email_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dedupKey TEXT NOT NULL UNIQUE, stableKey TEXT NOT NULL,
    reservationId INTEGER, clientId INTEGER, seasonKey TEXT, status TEXT NOT NULL,
    claimedAt TEXT NOT NULL DEFAULT (datetime('now')), sentAt TEXT, recipientEmail TEXT NOT NULL DEFAULT '',
    errorMessage TEXT NOT NULL DEFAULT '', emailLogId INTEGER
  );
`;

const CONFIRMATION = {
  id: 31, stableKey: 'reservation_confirmation', enabled: 1,
  subject: 'Confirmation', body: 'Bonjour {{clientFirstName}}', subjectEn: '', bodyEn: '',
};

function fixture({ autoSendEnabled, template = CONFIRMATION } = {}) {
  const stored = template && autoSendEnabled !== undefined
    ? { ...template, sendMode: autoSendEnabled ? 'auto' : 'manual' }
    : template;
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Léa', 'Roy', 'lea@r.fr')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO reservations (id, clientId, propertyId, startDate, endDate, createdAt) VALUES (500, 1, 1, '2026-08-10', '2026-08-12', '2026-07-01 10:00:00')").run();

  const queued = [];
  const logged = [];
  const sent = [];
  const sender = buildGatedConfirmationSender({
    database: db,
    templatesModel: { findByStableKey: (k) => (stored && stored.stableKey === k ? stored : undefined) },
    logModel: { insert: (row) => { logged.push(row); return { id: logged.length }; } },
    settingsModel: {
      // The sequence is active since before the booking (specs/guest-email-sequence.md rule 16).
      read: () => ({ companyName: 'Solio', guestSequenceStartDate: '2026-06-01' }),
      decryptedSmtpSettings: () => ({ host: 'smtp', fromEmail: 'f@x' }),
    },
    emailServiceFactory: () => ({ isConfigured: true, send: async (msg) => { sent.push(msg); } }),
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: { ensureToken: () => '' },
    queueModel: {
      // Same idempotency contract as the real model's INSERT OR IGNORE.
      add: (templateId, reservationId) => {
        const key = `${templateId}/${reservationId}`;
        if (queued.includes(key)) return false;
        queued.push(key);
        return true;
      },
    },
  });
  return { sender, queued, logged, sent };
}

test('template « auto »: the confirmation is mailed straight away, nothing is queued', async () => {
  const f = fixture({ autoSendEnabled: true });
  const res = await f.sender(500);

  assert.equal(res.sent, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'lea@r.fr');
  assert.deepEqual(f.queued, []);
});

test('template « manual »: nothing is sent, the confirmation waits in the queue', async () => {
  const f = fixture({ autoSendEnabled: false });
  const res = await f.sender(500);

  assert.equal(res.sent, false);
  assert.equal(res.reason, 'template-manual');
  assert.equal(res.queued, true);
  assert.equal(f.sent.length, 0, 'no mail left the building');
  assert.deepEqual(f.queued, ['31/500']);
  // Nothing was attempted, so the history stays clean — the queue is the record of what is waiting.
  assert.deepEqual(f.logged, []);
});

test('template « manual »: the webhook and the poll cron racing on one payment queue it once', async () => {
  const f = fixture({ autoSendEnabled: false });
  await f.sender(500);
  const second = await f.sender(500);

  assert.equal(second.queued, true, 'the second caller still reports the pair as queued');
  assert.deepEqual(f.queued, ['31/500'], 'but only one row exists');
});

test('a disabled confirmation template is not queued either', async () => {
  // « Désactivé » is a deliberate « never send this ». Queuing it would push the operator to send by
  // hand exactly what they turned off.
  const f = fixture({ autoSendEnabled: false, template: { ...CONFIRMATION, enabled: 0 } });
  const res = await f.sender(500);

  assert.equal(res.reason, 'no-template');
  assert.deepEqual(f.queued, []);
});

test('a missing confirmation template is a no-op, not a crash', async () => {
  const f = fixture({ autoSendEnabled: false, template: null });
  const res = await f.sender(500);

  assert.equal(res.reason, 'no-template');
  assert.deepEqual(f.queued, []);
});

test('a queue failure never breaks the payment flow', async () => {
  const errors = [];
  const db = new Database(':memory:');
  db.exec(DDL);
  const sender = buildGatedConfirmationSender({
    database: db,
    templatesModel: { findByStableKey: () => CONFIRMATION },
    logModel: { insert: () => ({ id: 1 }) },
    settingsModel: { read: () => ({}), decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => ({ isConfigured: true, send: async () => {} }),
    queueModel: { add: () => { throw new Error('database is locked'); } },
    onQueueError: (err) => errors.push(err.message),
  });

  const res = await sender(500);
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'queue-failed');
  assert.deepEqual(errors, ['database is locked']);
});

test('a template stored without any mode does not mail the guest', async () => {
  const f = fixture({ autoSendEnabled: undefined });
  // No `sendMode` → not an explicit « auto » → fail closed.
  const res = await f.sender(500);
  assert.equal(res.sent, false);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.queued, ['31/500']);
});
