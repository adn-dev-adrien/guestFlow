// specs/guest-email-texts-made-simple.md §3.C rules 10–11 — the variables come from the server, with a
// French label each, so every token a template uses has a chip; and templates, stay texts and
// mentions refuse an unknown token with the same 422 and the same message.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { VARIABLES, FLAGS, chipsForTemplate, chipsForText, tokenError, templateAllowed } = require('../utils/templateTokens');
const { buildContext } = require('../utils/emailContextBuilder');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { CATALOGUE } = require('../utils/stayTextCatalogue');
const { buildController: buildTemplates } = require('../controllers/emailTemplatesController');
const { buildController: buildStayTexts } = require('../controllers/stayTextsController');
const { buildController: buildMentions } = require('../controllers/emailMentionsController');
const emailTemplatesModel = require('../models/emailTemplatesModel');

test('rule 10: every variable and condition of the email context has a catalogue entry and a French label', () => {
  const { db, reservationId } = setup();
  const ctx = buildContext({ ...loadReservationGraph(db, reservationId), settings: {}, lang: 'fr' });
  const vars = new Set(VARIABLES.map((v) => v.name));
  const flags = new Set(FLAGS.map((f) => f.name));
  assert.deepEqual(Object.keys(ctx.vars).filter((v) => !vars.has(v)), []);
  assert.deepEqual(Object.keys(ctx.flags).filter((f) => !flags.has(f)), []);
  for (const entry of [...VARIABLES, ...FLAGS]) assert.ok(entry.label && !entry.label.includes('{{'), entry.name);
});

test('rule 10: a template gets the chips of its email, plus any name it already uses', () => {
  const { db } = setup();
  const j7 = db.prepare("SELECT * FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  const chips = chipsForTemplate(j7);
  const names = chips.variables.map((v) => v.name);
  assert.ok(names.includes('propertyHook'));
  assert.ok(!names.includes('giftVoucherOffer'), 'a season variable has no chip in the J-7');
  assert.equal(chips.variables.find((v) => v.name === 'clientFirstName').label, 'Prénom du voyageur');
  const used = new Set(`${j7.subject} ${j7.body}`.match(/\{\{\s*(?:#if\s+)?[A-Za-z0-9_]+\s*\}\}/g).map((m) => m.replace(/[{}\s]|#if/g, '')));
  const offered = new Set([...names, ...chips.conditions.map((c) => c.name)]);
  assert.deepEqual([...used].filter((n) => !offered.has(n)), []);

  const odd = { ...j7, body: `${j7.body} {{giftVoucherOffer}}` };
  assert.ok(chipsForTemplate(odd).variables.some((v) => v.name === 'giftVoucherOffer'));
  const house = CATALOGUE.find((e) => e.key === 'travelLight');
  assert.deepEqual(chipsForText(house).variables.map((v) => v.label), ['Distance (m)', 'Depuis le logement', 'Logement']);
});

test('rule 10: GET /email-templates/:id/variables answers the chips of that template', async () => {
  const { db, templateId } = setup();
  const controller = buildTemplates(emailTemplatesModel.buildModel(db), null, { isLive: () => true, editorTokens: () => ({ variables: [], conditions: [] }) });
  const res = await call(controller.variables, { params: { id: String(templateId('arrival_reminder_1d')) } });
  assert.equal(res.status, 200);
  assert.ok(res.body.variables.some((v) => v.name === 'accessParagraph' && v.label === 'Accès au logement'));
  const fresh = await call(controller.variables, { params: { id: 'new' } });
  assert.ok(fresh.body.variables.length >= VARIABLES.length);
});

test('rule 11: one refusal, word for word, in a template, a stay text and a mention', async () => {
  const { db, templateId } = setup();
  const templates = buildTemplates(emailTemplatesModel.buildModel(db), null, { isLive: () => true });
  const stayTexts = buildStayTexts({ database: db });
  const mentions = buildMentions({ database: db });
  const expected = { message: 'Variable inconnue : {{prenon}}' };

  const t = await call(templates.update, { params: { id: String(templateId('arrival_reminder_7d')) }, body: { body: 'Bonjour {{prenon}}' } });
  assert.equal(t.status, 422);
  assert.equal(t.body.message, expected.message);
  assert.match(db.prepare('SELECT body FROM email_templates WHERE id = ?').get(templateId('arrival_reminder_7d')).body, /clientFirstName/);

  const s = await call(stayTexts.save, { params: { key: 'house' }, body: { fr: 'Bonjour {{prenon}}', en: '' } });
  assert.equal(s.status, 422);
  assert.equal(s.body.message, expected.message);

  const optionId = db.prepare("INSERT INTO options (title, price) VALUES ('Pain', 3)").run().lastInsertRowid;
  const m = await call(mentions.create, { body: { section: 'extras', optionIds: [optionId], priceSource: 'min', offerFr: 'du pain {{prenon}}', offerEn: '', bookedFr: '', bookedEn: '' } });
  assert.equal(m.status, 422);
  assert.equal(m.body.message, expected.message);
});

test('rule 11: a name with a space or an accent is unknown too — it would reach the guest as braces', () => {
  const allowed = templateAllowed();
  assert.deepEqual(tokenError('body', 'Bonjour {{Prénom du voyageur}}', allowed), { field: 'body', message: 'Variable inconnue : {{Prénom du voyageur}}' });
  assert.equal(tokenError('body', '{{#if hasCompanyPhone}}{{companyPhone}}{{else}}—{{/if}}', allowed), null);
  assert.match(tokenError('body', '{{#if companyPhonee}}x{{/if}}', allowed).message, /companyPhonee/);
});
