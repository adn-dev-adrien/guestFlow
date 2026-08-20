/**
 * The confirmation email fired by a confirmed online payment, under the automatic-send master switch
 * (specs/no-automatic-email-without-approval.md §3 rule 4).
 *
 * A paid link is not an operator action: nobody read that email before it left. With the switch off,
 * the confirmation must be PROPOSED — queued for review — and never sent. With it on, the historical
 * behaviour is untouched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildGatedConfirmationSender } = require('../utils/reservationEmailSender');

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, emailLanguage TEXT
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, emailLanguage TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, titleEn TEXT, autoOptionType TEXT);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, nameEn TEXT);
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER);
`;

const CONFIRMATION = {
  id: 31, stableKey: 'reservation_confirmation', enabled: 1,
  subject: 'Confirmation', body: 'Bonjour {{clientFirstName}}', subjectEn: '', bodyEn: '',
};

function fixture({ autoSendEnabled, template = CONFIRMATION } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Léa', 'Roy', 'lea@r.fr')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO reservations (id, clientId, propertyId, startDate, endDate) VALUES (500, 1, 1, '2026-08-10', '2026-08-12')").run();

  const queued = [];
  const logged = [];
  const sent = [];
  const sender = buildGatedConfirmationSender({
    database: db,
    templatesModel: { findByStableKey: (k) => (template && template.stableKey === k ? template : undefined) },
    logModel: { insert: (row) => { logged.push(row); return { id: logged.length }; } },
    settingsModel: {
      emailAutoSendEnabled: () => autoSendEnabled,
      read: () => ({ companyName: 'Solio' }),
      decryptedSmtpSettings: () => ({ host: 'smtp', fromEmail: 'f@x' }),
    },
    emailServiceFactory: () => ({ isConfigured: true, send: async (msg) => { sent.push(msg); } }),
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

test('switch ON: the confirmation is mailed straight away, nothing is queued', async () => {
  const f = fixture({ autoSendEnabled: true });
  const res = await f.sender(500);

  assert.equal(res.sent, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'lea@r.fr');
  assert.deepEqual(f.queued, []);
});

test('switch OFF: nothing is sent, the confirmation waits in the queue', async () => {
  const f = fixture({ autoSendEnabled: false });
  const res = await f.sender(500);

  assert.equal(res.sent, false);
  assert.equal(res.reason, 'auto-send-disabled');
  assert.equal(res.queued, true);
  assert.equal(f.sent.length, 0, 'no mail left the building');
  assert.deepEqual(f.queued, ['31/500']);
  // Nothing was attempted, so the history stays clean — the queue is the record of what is waiting.
  assert.deepEqual(f.logged, []);
});

test('switch OFF: the webhook and the poll cron racing on one payment queue it once', async () => {
  const f = fixture({ autoSendEnabled: false });
  await f.sender(500);
  const second = await f.sender(500);

  assert.equal(second.queued, true, 'the second caller still reports the pair as queued');
  assert.deepEqual(f.queued, ['31/500'], 'but only one row exists');
});

test('switch OFF: a disabled confirmation template is not queued either', async () => {
  // « Désactivé » is a deliberate « never send this ». Queuing it would push the operator to send by
  // hand exactly what they turned off.
  const f = fixture({ autoSendEnabled: false, template: { ...CONFIRMATION, enabled: 0 } });
  const res = await f.sender(500);

  assert.equal(res.reason, 'no-template');
  assert.deepEqual(f.queued, []);
});

test('switch OFF: a missing confirmation template is a no-op, not a crash', async () => {
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
    settingsModel: { emailAutoSendEnabled: () => false, read: () => ({}), decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => ({ isConfigured: true, send: async () => {} }),
    queueModel: { add: () => { throw new Error('database is locked'); } },
    onQueueError: (err) => errors.push(err.message),
  });

  const res = await sender(500);
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'queue-failed');
  assert.deepEqual(errors, ['database is locked']);
});

test('a settings model that never heard of the switch does not mail the guest', async () => {
  const f = fixture({ autoSendEnabled: undefined });
  // `emailAutoSendEnabled()` returns undefined → not an explicit yes → fail closed.
  const res = await f.sender(500);
  assert.equal(res.sent, false);
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.queued, ['31/500']);
});
