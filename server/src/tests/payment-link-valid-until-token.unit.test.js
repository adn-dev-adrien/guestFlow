// specs/payment-link-lifecycle.md rule 36 — `{{paymentLinkValidUntil}}`: the end of validity of the link
// the e-mail carries, in the guest's language and Paris time, empty with no link; the default request
// templates and the acompte reminder say it right after the link, migrated onto untouched templates only.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TZ = 'Europe/Paris';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-valid-until-')), 'guestflow.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const SENDER = require.resolve('../utils/reservationEmailSender');
const realSender = require(SENDER);
const captured = [];
require.cache[SENDER].exports = {
  ...realSender,
  sendReservationTemplateEmail: async (args) => { captured.push(args); return { sent: true }; },
};
const { __test } = require('../controllers/paymentsController');
require.cache[SENDER].exports = realSender;

const db = require('../database');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const { formatMomentLong } = require('../utils/dateFr');
const { VARIABLES } = require('../utils/templateTokens');
const { buildContext } = require('../utils/emailContextBuilder');
const { DEFAULT_TEMPLATES, VALID_UNTIL_SENTENCE } = require('../utils/defaultEmailTemplatesRegistry');
const { runValidUntilSentenceMigration, runValidUntilBlockMigration, MIGRATION_NAME, withoutValidUntilSentence, withValidUntilSentence, rollbackSafeValidUntil, SHIPPED, MIGRATED_V1 } = require('../utils/migrateValidUntilSentence');
const crypto = require('crypto');
const { draftTemplateFor } = require('../utils/paymentRequestDraft');
const { sendPaymentRequest, sendInstallmentRequest } = require('../utils/paymentRequestService');

const LINK_KEYS = ['deposit_request', 'balance_request', 'full_request', 'installment_request', 'deposit_reminder'];

test('rule 36 — the end of validity reads the French way, in Paris time, winter and summer', () => {
  assert.equal(formatMomentLong('2026-11-02T17:00:00.000Z', 'fr'), 'lundi 2 novembre à 18 h 00');
  assert.equal(formatMomentLong('2027-07-01T07:05:00.000Z', 'fr'), 'jeudi 1er juillet à 9 h 05');
  assert.equal(formatMomentLong('2026-10-25T02:30:00.000Z', 'fr'), 'dimanche 25 octobre à 3 h 30', 'after the switch to winter time');
});

test('rule 36 — the end of validity reads the English way, with a 12-hour clock', () => {
  assert.equal(formatMomentLong('2026-11-02T17:00:00.000Z', 'en'), 'Monday 2 November at 6:00 pm');
  assert.equal(formatMomentLong('2026-11-02T23:15:00.000Z', 'en'), 'Tuesday 3 November at 12:15 am', 'midnight is 12 am in Paris');
  assert.equal(formatMomentLong('2026-11-03T11:00:00.000Z', 'en'), 'Tuesday 3 November at 12:00 pm');
});

test('rule 36 — no instant, an unreadable one or Qonto’s zero time gives an empty label', () => {
  assert.equal(formatMomentLong(null, 'fr'), '');
  assert.equal(formatMomentLong('not a date', 'en'), '');
  assert.equal(formatMomentLong('0001-01-01T00:00:00Z', 'fr'), '');
});

test('rule 36 — the token is in the catalogue, among the payment variables, and empty by default', () => {
  const entry = VARIABLES.find((v) => v.name === 'paymentLinkValidUntil');
  assert.ok(entry, 'declared in templateTokens');
  assert.deepEqual(entry.in, ['payment']);
  const context = buildContext({ reservation: { id: 1, startDate: '2027-07-10', endDate: '2027-07-14' }, settings: {}, lang: 'fr' });
  assert.equal(context.vars.paymentLinkValidUntil, '');
});

// Rule 28 — a guest who opens a lapsed link knows why: the e-mail said until when it was valid.
// Rule 59 — in a block of its own, guarded by `hasPaymentLinkValidUntil`; after the link's own block where there is one.
test('rules 28, 36, 59 — every default template that carries a link states its end right after it, FR and EN', () => {
  const block = (lang) => `{{#if hasPaymentLinkValidUntil}}\n${VALID_UNTIL_SENTENCE[lang]}{{/if}}`;
  for (const key of LINK_KEYS) {
    const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === key);
    for (const [body, lang] of [[t.body, 'fr'], [t.bodyEn, 'en']]) {
      assert.match(body, /\{\{paymentLink\}\}(\{\{else\}\}[^{\n]*\{\{\/if\}\})?\{\{#if hasPaymentLinkValidUntil\}\}/, `${key} ${lang}`);
      assert.ok(body.includes(block(lang)), `${key} ${lang}`);
    }
  }
  assert.equal(VALID_UNTIL_SENTENCE.fr, 'Ce lien est valable jusqu\'au {{paymentLinkValidUntil}}.');
  assert.equal(VALID_UNTIL_SENTENCE.en, 'This link is valid until {{paymentLinkValidUntil}}.');
  const reminder = DEFAULT_TEMPLATES.find((row) => row.stableKey === 'deposit_reminder');
  assert.ok(reminder.body.includes(`Contactez-nous pour le règlement.{{/if}}${block('fr')}`), 'after the link condition, never nested');
  const balanceReminder = DEFAULT_TEMPLATES.find((row) => row.stableKey === 'balance_reminder');
  assert.doesNotMatch(balanceReminder.body, /paymentLinkValidUntil/, 'rule 27: the solde reminder carries no link');
});

async function sendWith(lang, stableKey, expiresAt) {
  captured.length = 0;
  await __test.requestServiceDeps(null).sendTemplate({ reservationId: 1, stableKey, paymentLink: 'https://pay.example.test/l', amountCents: 30000, expiresAt });
  const { extraContext } = captured[0];
  const client = db.prepare('INSERT INTO clients (firstName, lastName, email, emailLanguage) VALUES (?, ?, ?, ?)').run('Ann', 'Lee', 'ann@example.test', lang);
  db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Gite')").run();
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
                           VALUES ('reservation', 1, ?, '2027-08-10', '2027-08-12', 2, 1000, 300, 700)`).run(client.lastInsertRowid);
  const sent = [];
  const r = await realSender.sendReservationTemplateEmail({
    database: db, templatesModel: emailTemplatesModel.buildModel(db), logModel: emailLogModel.buildModel(db),
    settingsModel: { read: () => ({ companyName: 'Demo' }), decryptedSmtpSettings: () => ({}) },
    emailServiceFactory: () => ({ send: async (m) => { sent.push(m); } }),
    reservationId: Number(info.lastInsertRowid), stableKey, extraContext,
  });
  assert.equal(r.sent, true, String(r.reason));
  return sent[0].text;
}

test('rule 36 — a request sent from the fiche states the link’s end in French for a French guest', async () => {
  const text = await sendWith('fr', 'deposit_request', '2026-11-02T17:00:00.000Z');
  assert.match(text, /Payer l'acompte en ligne : https:\/\/pay\.example\.test\/l\nCe lien est valable jusqu'au lundi 2 novembre à 18 h 00\./);
});

test('rule 36 — and in English for an English-speaking guest', async () => {
  const text = await sendWith('en', 'balance_request', '2026-11-02T17:00:00.000Z');
  assert.match(text, /Pay the balance online: https:\/\/pay\.example\.test\/l\nThis link is valid until Monday 2 November at 6:00 pm\./);
});

// Rule 59 — a link with no known end writes no sentence at all: its block is off.
test('rule 59 — a request whose link has no known end leaves the sentence out', async () => {
  const text = await sendWith('fr', 'full_request', null);
  assert.match(text, /Payer en ligne : https:\/\/pay\.example\.test\/l\n\n/);
  assert.doesNotMatch(text, /valable jusqu/);
});

test('rule 36 — the controller hands the instant, never a pre-formatted date', () => {
  captured.length = 0;
  __test.requestServiceDeps(null).sendTemplate({ reservationId: 1, stableKey: 'full_request', paymentLink: 'x', amountCents: 100, expiresAt: '2026-11-02T17:00:00.000Z' });
  assert.equal(captured[0].extraContext.dates.paymentLinkValidUntil, '2026-11-02T17:00:00.000Z');
  assert.equal(captured[0].extraContext.vars.paymentLinkValidUntil, undefined);
});

test('rule 36 — both request paths hand the mint’s expiresAt to the e-mail', async () => {
  const fixture = require('./paymentLinkLifecycleFixture');
  const { db: memory, links } = fixture.seedDb();
  const id = fixture.addStay(memory, { kind: 'reservation' });
  const now = new Date('2026-11-02T08:00:00Z');
  const seen = [];
  const deps = {
    database: memory, paymentLinksModel: links, provider: fixture.fakeProvider(), resolveAmountCents: () => 9000, now: () => now,
    sendTemplate: async (args) => { seen.push(args); return { sent: true }; },
  };
  const request = await sendPaymentRequest(deps, id, 'deposit');
  assert.equal(request.httpStatus, 200);
  assert.equal(seen[0].expiresAt, '2026-11-03T20:00:00.000Z');

  const installment = { id: 41, reservationId: id, number: 1, amountCents: 5000, paid: 0, dueDate: '2027-06-01' };
  const installmentsModel = { findById: () => installment, listFor: () => [installment], markRequested: () => {} };
  const sent = await sendInstallmentRequest({ ...deps, installmentsModel }, id, 41);
  assert.equal(sent.httpStatus, 200);
  assert.equal(seen[1].expiresAt, '2026-11-03T20:00:00.000Z');
});

function templatesDb() {
  const memory = new Database(':memory:');
  memory.exec(`CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT, body TEXT, subjectEn TEXT, bodyEn TEXT, updatedAt TEXT);
               CREATE TABLE migrations (name TEXT PRIMARY KEY, ranAt TEXT DEFAULT (datetime('now')));`);
  return memory;
}

test('rule 36 — the migration writes the sentence onto the default templates nobody edited, FR and EN', () => {
  const memory = templatesDb();
  for (const key of LINK_KEYS) {
    const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === key);
    memory.prepare('INSERT INTO email_templates (stableKey, name, subject, body, subjectEn, bodyEn) VALUES (?, ?, ?, ?, ?, ?)')
      .run(key, t.name, t.subject, withoutValidUntilSentence(t.body), t.subjectEn, withoutValidUntilSentence(t.bodyEn));
  }
  const logs = [];
  const result = runValidUntilSentenceMigration(memory, { logger: { log: (l) => logs.push(l) } });
  assert.equal(result.updated, 10);
  // Rule 59 — v2 runs right after at the same boot: the result is the text a new install gets.
  assert.equal(runValidUntilBlockMigration(memory, { logger: { log: () => {} } }).updated, 10);
  for (const key of LINK_KEYS) {
    const row = memory.prepare('SELECT body, bodyEn FROM email_templates WHERE stableKey = ?').get(key);
    const t = DEFAULT_TEMPLATES.find((d) => d.stableKey === key);
    assert.equal(row.body, t.body, `${key}: the same text a new install gets`);
    assert.equal(row.bodyEn, t.bodyEn, key);
  }
  assert.ok(memory.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME));
  assert.match(logs.join('\n'), /10 template field\(s\)/);
});

test('rule 36 — every default shipped before this version is recognised, the last one included', () => {
  const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  for (const key of LINK_KEYS) {
    const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === key);
    assert.ok(SHIPPED[key].fr.includes(hash(withoutValidUntilSentence(t.body))), `${key} FR`);
    assert.ok(SHIPPED[key].en.includes(hash(withoutValidUntilSentence(t.bodyEn))), `${key} EN`);
    const v1 = withValidUntilSentence(withoutValidUntilSentence(t.body), 'fr');
    assert.ok(MIGRATED_V1[key].fr.includes(hash(v1)), `${key}: v1's output is a known v1 form`);
    assert.equal(rollbackSafeValidUntil(v1, 'fr'), t.body, 'v2 lands where the registry has it');
  }
});

test('rule 36 — an older default nobody edited gets the sentence and keeps the rest of its text', () => {
  const memory = templatesDb();
  const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === 'deposit_reminder');
  // The acompte reminder as seeded before the company phone became conditional and its no-link line changed.
  const older = withoutValidUntilSentence(t.body)
    .replace('Contactez-nous pour le règlement.', 'Contactez-nous pour recevoir votre lien de paiement.')
    .replace('cet email{{#if hasCompanyPhone}} ou appelez-nous au {{companyPhone}}{{/if}}.', 'cet email ou appelez-nous au {{companyPhone}}.');
  memory.prepare('INSERT INTO email_templates (stableKey, name, subject, body) VALUES (?, ?, ?, ?)').run('deposit_reminder', t.name, t.subject, older);
  const result = runValidUntilSentenceMigration(memory, { logger: { log: () => {} } });
  assert.equal(result.updated, 1, 'recognised as shipped');
  const row = memory.prepare('SELECT body FROM email_templates WHERE stableKey = ?').get('deposit_reminder');
  assert.ok(row.body.includes(`{{paymentLink}}\n${VALID_UNTIL_SENTENCE.fr}{{else}}Contactez-nous pour recevoir votre lien de paiement.`));
  assert.ok(row.body.includes('cet email ou appelez-nous au {{companyPhone}}.'), 'nothing else rewritten');
});

test('rule 36 — an operator-edited template keeps its text, on each side separately', () => {
  const memory = templatesDb();
  const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === 'deposit_request');
  const edited = `${withoutValidUntilSentence(t.body)}\nMerci !`;
  memory.prepare('INSERT INTO email_templates (stableKey, name, subject, body, subjectEn, bodyEn) VALUES (?, ?, ?, ?, ?, ?)')
    .run('deposit_request', t.name, t.subject, edited, t.subjectEn, withoutValidUntilSentence(t.bodyEn));
  const logs = [];
  const result = runValidUntilSentenceMigration(memory, { logger: { log: (l) => logs.push(l) } });
  const row = memory.prepare('SELECT body, bodyEn FROM email_templates WHERE stableKey = ?').get('deposit_request');
  assert.equal(row.body, edited, 'the edited French side is left alone');
  assert.equal(row.bodyEn, withValidUntilSentence(withoutValidUntilSentence(t.bodyEn), 'en'), 'the untouched English side gets the sentence');
  assert.equal(result.updated, 1);
  assert.deepEqual(result.kept, ['deposit_request (fr)']);
  assert.match(logs[0], /edited, left as they are: deposit_request \(fr\)/);
});

test('rule 36 — the migration runs once', () => {
  const memory = templatesDb();
  const t = DEFAULT_TEMPLATES.find((row) => row.stableKey === 'full_request');
  memory.prepare('INSERT INTO email_templates (stableKey, name, subject, body, subjectEn, bodyEn) VALUES (?, ?, ?, ?, ?, ?)')
    .run('full_request', t.name, t.subject, withoutValidUntilSentence(t.body), t.subjectEn, withoutValidUntilSentence(t.bodyEn));
  assert.equal(runValidUntilSentenceMigration(memory, { logger: { log: () => {} } }).updated, 2);
  memory.prepare('UPDATE email_templates SET body = ? WHERE stableKey = ?').run(withoutValidUntilSentence(t.body), 'full_request');
  assert.equal(runValidUntilSentenceMigration(memory, { logger: { log: () => {} } }).ran, false);
  assert.equal(memory.prepare('SELECT body FROM email_templates WHERE stableKey = ?').get('full_request').body, withoutValidUntilSentence(t.body));
});

test('rule 36 — a template that states the validity outside its link condition is not offered as the no-link draft', () => {
  const reminder = { id: 3, stableKey: 'deposit_reminder', enabled: 1, subject: 's', body: '{{#if hasPaymentLink}}{{paymentLink}}{{/if}} Valable jusqu’au {{paymentLinkValidUntil}}.' };
  assert.equal(draftTemplateFor([reminder], 'deposit', true), null);
  const fine = { ...reminder, body: '{{#if hasPaymentLink}}{{paymentLink}} Valable jusqu’au {{paymentLinkValidUntil}}.{{/if}}' };
  assert.equal(draftTemplateFor([fine], 'deposit', true), 3);
});
