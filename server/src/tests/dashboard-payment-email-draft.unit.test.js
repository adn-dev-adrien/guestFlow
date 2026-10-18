// specs/plugins-phase-3a-online-payment.md rule 22 — without online payment, a row « à demander » keeps
// its « Envoyer la demande »: the request leaves as an email the operator reads first, on a template
// that reads well without a link; a reminder sent that way counts as asked.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');
const { draftTemplateFor } = require('../utils/paymentRequestDraft');

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const ROW = {
  id: 7, kind: 'reservation', platform: 'direct', email: 'a@b.fr', startDate: '2026-12-20', endDate: '2026-12-22',
  depositAmount: 0, depositPaid: 1, balanceAmount: 300, balancePaid: 0, balanceDueDate: '2026-11-01',
};

const TEMPLATES = [
  { id: 1, stableKey: 'balance_request', enabled: 1, body: 'Payer le solde en ligne : {{paymentLink}}' },
  { id: 2, stableKey: 'balance_reminder', enabled: 1, body: '{{#if hasPaymentLink}}En ligne : {{paymentLink}}{{else}}Contactez-nous pour le règlement.{{/if}}' },
  { id: 3, stableKey: 'deposit_request', enabled: 1, body: '{{#if hasPaymentLink}}{{paymentLink}}{{/if}}Merci.' },
  { id: 4, stableKey: 'deposit_reminder', enabled: 0, body: 'Relance' },
];

test('rule 22: the template must read without a link; the request first, the reminder once asked', () => {
  assert.equal(draftTemplateFor(TEMPLATES, 'balance', false), 2, 'the request prints a bare link: the reminder');
  assert.equal(draftTemplateFor(TEMPLATES, 'deposit', false), 3);
  assert.equal(draftTemplateFor(TEMPLATES, 'deposit', true), null, 'a disabled reminder is not offered');
  assert.equal(draftTemplateFor(TEMPLATES, 'balance', true), 2);
  assert.equal(draftTemplateFor([], 'balance', false), null);
});

test('rule 22: without a provider the row offers the email draft, with a short reason', async () => {
  const build = (has, templateId) => buildController({
    reservationsModel: { listPaymentDeadlineCandidates: () => [ROW], getPlatform: () => 'direct' },
    hasPaymentProvider: () => has,
    requestTemplateId: () => templateId,
    today: '2026-11-10',
  });
  const off = res();
  await build(false, 2).paymentDeadlines({ query: {} }, off);
  const row = off.body.rows[0];
  assert.equal(row.remindType, 'balance');
  assert.equal(row.remindByEmail, true);
  assert.equal(row.remindTemplateId, 2);
  assert.equal(row.remindNote, 'Aucun paiement en ligne : demande par email.');
  const on = res();
  await build(true, 2).paymentDeadlines({ query: {} }, on);
  assert.equal(on.body.rows[0].remindByEmail, undefined, 'with a provider the link is minted as before');
});

test('rule 22: a reminder sent by hand marks the solde as asked', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT);
    CREATE TABLE email_log (id INTEGER PRIMARY KEY, reservationId INTEGER, templateId INTEGER, status TEXT);
    INSERT INTO email_templates (id, stableKey) VALUES (1, 'balance_reminder');
    INSERT INTO email_log (reservationId, templateId, status) VALUES (7, 1, 'sent');
  `);
  const asked = db.prepare(`SELECT EXISTS (SELECT 1 FROM email_log l JOIN email_templates t ON t.id = l.templateId
    WHERE l.reservationId = 7 AND t.stableKey IN ('balance_request', 'balance_reminder') AND l.status = 'sent') AS v`).get().v;
  assert.equal(asked, 1);
  const source = require('fs').readFileSync(require.resolve('../models/reservationsModel'), 'utf8');
  assert.match(source, /stableKey IN \('balance_request', 'balance_reminder'\)/);
  assert.match(source, /stableKey IN \('deposit_request', 'deposit_reminder'\)/);
});
