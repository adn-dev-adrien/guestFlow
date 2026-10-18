// specs/guest-email-texts-made-simple.md rule 26 — a broken variable or condition is refused at save,
// by the one validation every editor shares (texts, templates, file import), and a stored one is
// listed in « À compléter »: the renderer would hand it to the guest as it is.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const emailTextsModel = require('../models/emailTextsModel');
const { buildController: buildReadiness } = require('../controllers/emailReadinessController');
const { buildController: buildTemplates } = require('../controllers/emailTemplatesController');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const { structureError, STRUCTURE_MESSAGES } = require('../utils/emailTemplateRenderer');
const { tokenError, templateAllowed } = require('../utils/templateTokens');

const FULL = { companyName: 'Les Prés', companyPhone: '06 12 34 56 78', smtpFromName: 'Claire' };

test('rule 26: what the renderer cannot read is named', () => {
  assert.equal(structureError('Le ménage {{clientFirstName est pour nous'), 'brace');
  assert.equal(structureError('Le ménage est pour nous }} merci'), 'brace');
  assert.equal(structureError('Le ménage est pour nous ⟦Prénom du voyag, profitez.'), 'brace');
  assert.equal(structureError('- Maillots{{#if stayOverlapsPool}}, et la piscine\n- Chaussures'), 'unclosed');
  assert.equal(structureError('Bonjour{{/if}}'), 'orphan');
  assert.equal(structureError('Bonjour {{else}} Paul'), 'else');
  assert.equal(structureError('{{#if a}}{{#if b}}x{{/if}}{{/if}}'), 'nested');
  for (const ok of ['', 'Bonjour {{clientFirstName}}', '{{#if hasPrice}} ({{price}}){{else}}.{{/if}}', '{{#if a}}x{{/if}} {{#if b}}y{{/if}}']) {
    assert.equal(structureError(ok), null, ok);
  }
});

test('rule 26: the shared validation refuses it before any unknown-name check, in French', () => {
  const allowed = templateAllowed();
  assert.deepEqual(tokenError('body', 'Bonjour {{clientFirstName', allowed), { field: 'body', message: STRUCTURE_MESSAGES.brace });
  assert.deepEqual(tokenError('body', '{{#if hasCompanyPhone}}x', allowed), { field: 'body', message: 'Condition sans fin : ajouter « fin si ».' });
  assert.equal(STRUCTURE_MESSAGES.brace, 'Variable incomplète : la remettre depuis les boutons.');
});

test('rule 26: « Textes des emails » refuses a broken sentence and writes nothing', () => {
  const { db } = setup();
  const model = emailTextsModel.buildModel(db);
  const before = model.find('text:house').fr;
  for (const fr of ['Le ménage {{clientFirstName est pour nous', 'Café ⟦Prénom du voyag', '- Maillots{{#if stayOverlapsPool}}, et la piscine']) {
    const result = model.apply([{ key: 'text:house', fr }]);
    assert.equal(result.ok, false, fr);
    assert.equal(result.key, 'text:house');
    assert.equal(result.field, 'fr');
  }
  assert.equal(emailTextsModel.buildModel(db).find('text:house').fr, before);
});

test('rule 26: a template is refused the same way, under the field that holds it', async () => {
  const { db, templateId } = setup();
  const controller = buildTemplates(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const res = await call(controller.update, { params: { id: String(templateId('arrival_reminder_1d')) }, body: { bodyEn: 'Hello {{clientFirstName' } });
  assert.equal(res.status, 422);
  assert.deepEqual(res.body, { field: 'bodyEn', message: STRUCTURE_MESSAGES.brace });
});

test('rule 26: a broken sentence or template already stored is listed in « À compléter »', () => {
  const { db } = setup();
  const readiness = () => buildReadiness({ database: db, settingsModel: { read: () => FULL } }).compute();
  const before = readiness().items.map((i) => i.id);
  assert.ok(!before.some((id) => id.startsWith('text.broken') || id.startsWith('template.token')));
  db.prepare("UPDATE email_templates SET body = body || '{{#if hasCompanyPhone}}' WHERE stableKey = 'arrival_reminder_1d'").run();
  const item = readiness().items.find((i) => i.id.startsWith('template.token:'));
  assert.ok(item);
  assert.match(item.label, /^Modèle à corriger — /);
  assert.equal(item.check, 'token');
});
