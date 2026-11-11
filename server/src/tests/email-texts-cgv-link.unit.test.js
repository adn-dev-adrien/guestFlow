// specs/guest-email-texts-made-simple.md rule 36 — the CGV sentence is never printed ending on
// « ici : » and nothing. A template that prints {{cgvUrl}} outside its condition is wrapped once by the
// upgrade (unchanged while the link exists), and « À compléter » lists it while there is no link.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./emailTextsFixture');
const { wrapCgvParagraph, runCgvLinkConditionMigration } = require('../utils/migrateCgvLinkCondition');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { buildController: buildReadiness } = require('../controllers/emailReadinessController');

const HAND_WRITTEN = [
  'Bonjour {{clientFirstName}},',
  '',
  'Vous retrouverez les conditions générales que vous avez acceptées ici : {{cgvUrl}}',
  '',
  'À bientôt,',
  '{{senderName}}',
].join('\n');

test('rule 36: the paragraph is wrapped, and reads exactly as before while the link exists', () => {
  const wrapped = wrapCgvParagraph(HAND_WRITTEN);
  assert.match(wrapped, /\{\{#if hasCgvUrl\}\}Vous retrouverez/);
  const vars = { cgvUrl: 'https://solio.test/cgv/?v=1', clientFirstName: 'Paul', senderName: 'Adrien' };
  const withLink = { vars, flags: { hasCgvUrl: true } };
  assert.equal(renderTemplate({ subject: '', body: wrapped }, withLink).body, renderTemplate({ subject: '', body: HAND_WRITTEN }, withLink).body);
  const without = renderTemplate({ subject: '', body: wrapped }, { vars: { ...vars, cgvUrl: '' }, flags: { hasCgvUrl: false } }).body;
  assert.doesNotMatch(without, /conditions générales|ici :/);
  assert.equal(without, 'Bonjour Paul,\n\nÀ bientôt,\nAdrien');
});

test('rule 36: a template already guarded, or without the link, is left alone; the upgrade runs once', () => {
  assert.equal(wrapCgvParagraph('{{#if hasCgvUrl}}CGV : {{cgvUrl}}\n\n{{/if}}Merci'), null);
  assert.equal(wrapCgvParagraph('Bonjour'), null);
  const { db } = setup();
  db.prepare("UPDATE email_templates SET body = ? WHERE stableKey = 'reservation_confirmation'").run(HAND_WRITTEN);
  assert.equal(runCgvLinkConditionMigration(db), 1);
  assert.equal(runCgvLinkConditionMigration(db), 0);
});

test('rule 36: « À compléter » names a template printing the link while there is none', () => {
  const { db } = setup();
  const settings = { companyName: 'Les Prés', companyPhone: '06 12 34 56 78', smtpFromName: 'Claire' };
  const ids = () => buildReadiness({ database: db, settingsModel: { read: () => settings } }).compute().items.map((i) => i.id);
  assert.ok(!ids().some((id) => id.startsWith('template.cgv:')), 'the neutral template guards it');
  db.prepare("UPDATE email_templates SET body = ? WHERE stableKey = 'reservation_confirmation'").run(HAND_WRITTEN);
  assert.ok(ids().some((id) => id.startsWith('template.cgv:')));
});
