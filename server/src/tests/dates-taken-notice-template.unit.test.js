// specs/payment-link-lifecycle.md rules 44 and 45 — the one guest e-mail that leaves without validation is one named
// exception: `AUTO_SEND_EXCEPTIONS` holds `dates_unavailable_notice` alone, read by its sender alone; the policy still
// answers « no » for it and for every other template; the template is seeded FR / EN, stored Manual, kept out of the
// queue and the cron, its mode shown « Automatique (exception) » and never edited, its text editable; the history
// says « Envoyé automatiquement (dates prises) ».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const templatesModel = require('../models/emailTemplatesModel');
const logModel = require('../models/emailLogModel');
const policy = require('../utils/autoSendPolicy');
const { DEFAULT_TEMPLATES, EVENT_TRIGGERED_STABLE_KEYS, PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');
const { buildController: buildTemplatesController } = require('../controllers/emailTemplatesController');
const { buildController: buildEmailsController } = require('../controllers/emailsController');
const { renderTemplate } = require('../utils/emailTemplateRenderer');

const KEY = 'dates_unavailable_notice';

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return ['tests', 'node_modules'].includes(e.name) ? [] : sourceFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

test('rule 44 — AUTO_SEND_EXCEPTIONS holds one key, and only its sender reads it', () => {
  assert.deepEqual([...policy.AUTO_SEND_EXCEPTIONS], [KEY]);
  assert.ok(Object.isFrozen(policy.AUTO_SEND_EXCEPTIONS));
  const root = path.join(__dirname, '..');
  const readers = sourceFiles(root)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('AUTO_SEND_EXCEPTIONS'))
    .map((file) => path.relative(root, file))
    .sort();
  assert.deepEqual(readers, ['utils/autoSendPolicy.js', 'utils/datesTakenNotice.js']);
});

test('rule 44 — the policy still refuses the exception, and every other template unless it is enabled and « auto »', () => {
  assert.equal(policy.templateAutoSends({ stableKey: KEY, enabled: 1, sendMode: 'auto' }), false, 'never through a cron');
  for (const def of DEFAULT_TEMPLATES) {
    assert.equal(policy.templateAutoSends({ ...def, enabled: 1, sendMode: 'manual' }), false, def.stableKey);
  }
  assert.equal(policy.templateAutoSends({ stableKey: 'arrival_reminder_7d', enabled: 1, sendMode: 'auto' }), true, 'an operator\'s « auto » still counts');
  assert.equal(policy.templateAutoSends({ stableKey: 'arrival_reminder_7d', enabled: 0, sendMode: 'auto' }), false);
  assert.equal(policy.stableKeyAutoSends({ findByStableKey: () => { throw new Error('db'); } }, KEY), false, 'fails closed');
});

test('rule 45 — seeded FR and EN, stored Manual, enabled, out of the queue and the cron, asking for no money', () => {
  const row = templatesModel.findByStableKey(KEY);
  assert.ok(row, 'seeded at boot');
  assert.equal(row.sendMode, 'manual');
  assert.equal(Number(row.enabled), 1);
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes(KEY));
  assert.ok(!PAYMENT_STABLE_KEYS.includes(KEY));
  for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) {
    assert.ok(String(row[field] || '').trim(), field);
    assert.doesNotMatch(row[field], /paymentLink|Amount|Price/, `${field} carries no link and no amount`);
  }
});

test('rule 45 — the French and English texts are the spec\'s', () => {
  const vars = {
    clientFirstName: 'Lina', propertyWithArticle: 'à La Granja', propertyName: 'La Granja',
    arrivalDateLabel: 'samedi 8 novembre', departureDateLabel: 'mercredi 12 novembre', senderName: 'Adrien',
  };
  const row = templatesModel.findByStableKey(KEY);
  const fr = renderTemplate({ subject: row.subject, body: row.body }, { vars, flags: {} });
  assert.equal(fr.subject, 'Vos dates à La Granja ne sont plus disponibles');
  assert.equal(fr.body, [
    'Bonjour Lina,',
    '',
    'Les dates que nous vous avions proposées à La Granja, du samedi 8 novembre au mercredi 12 novembre, viennent d\'être réservées et ne sont plus disponibles. Le lien de paiement que vous avez reçu ne fonctionne plus, et rien ne vous a été prélevé.',
    '',
    'Nous sommes désolés de ne pas avoir pu les garder pour vous. Si d\'autres dates vous conviennent, répondez simplement à ce message.',
    '',
    'À bientôt,',
    'Adrien',
  ].join('\n'));
  const en = renderTemplate({ subject: row.subjectEn, body: row.bodyEn }, { vars, flags: {} });
  assert.equal(en.subject, 'Your dates at La Granja are no longer available');
  assert.match(en.body, /^Hello Lina,\n\nThe dates we offered you at La Granja, from samedi 8 novembre to mercredi 12 novembre, have just been booked and are no longer available\. The payment link you received no longer works, and nothing has been charged\.\n\nWe are sorry we could not hold them for you\. If other dates suit you, simply reply to this message\.\n\nSee you soon,\nAdrien$/);
});

test('rule 45 — the editor shows « Automatique (exception) » and refuses a mode change; the text stays editable', () => {
  const ctl = buildTemplatesController(templatesModel, { read: () => ({}), upsert: () => {} }, { isLive: () => true, editorTokens: () => ({ variables: [], conditions: [] }) });
  const listed = res();
  ctl.list({ query: {} }, listed);
  const row = listed.body.find((t) => t.stableKey === KEY);
  assert.equal(row.sendModeLocked, true);
  assert.equal(row.sendModeLabel, 'Automatique (exception)');
  assert.equal(row.displayName, 'Dates plus disponibles');
  assert.ok(listed.body.filter((t) => t.stableKey !== KEY).every((t) => !t.sendModeLocked && t.sendModeLabel == null), 'no other template is locked');

  const refused = res();
  ctl.update({ params: { id: row.id }, body: { sendMode: 'auto' } }, refused);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'SEND_MODE_LOCKED');
  assert.equal(templatesModel.findById(row.id).sendMode, 'manual');

  const original = templatesModel.findById(row.id).subject;
  const edited = res();
  ctl.update({ params: { id: row.id }, body: { subject: 'Vos dates {{propertyWithArticle}} ont été prises', sendMode: 'manual' } }, edited);
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  assert.equal(templatesModel.findById(row.id).subject, 'Vos dates {{propertyWithArticle}} ont été prises');
  templatesModel.update(row.id, { subject: original });
});

test('rule 44 — the history labels the notice « Envoyé automatiquement (dates prises) », and only it', () => {
  const stay = addStay({ propertyId: freshProperty(), kind: 'devis', start: inDays(30), end: inDays(33) });
  const notice = templatesModel.findByStableKey(KEY);
  const other = templatesModel.findByStableKey('arrival_reminder_7d');
  logModel.insert({ templateId: notice.id, reservationId: stay, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@example.test', occurrenceKey: `dates-taken:${stay}` });
  logModel.insert({ templateId: other.id, reservationId: stay, status: 'sent', renderedSubject: 's', renderedBody: 'b', recipientEmail: 'x@example.test' });
  const ctl = buildEmailsController({ database: db, templatesModel, logModel, settingsModel: { read: () => ({}) } });
  const r = res();
  ctl.history({ query: { reservationId: stay } }, r);
  const labels = Object.fromEntries(r.body.rows.map((row) => [row.templateId, row.statusLabel || null]));
  assert.equal(labels[notice.id], 'Envoyé automatiquement (dates prises)');
  assert.equal(labels[other.id], null);
});
