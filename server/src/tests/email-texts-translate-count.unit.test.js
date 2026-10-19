// specs/guest-email-texts-made-simple.md rule 42 (UI/UX review 2026-10-18, decision 10) — one language at
// a time, and the server counts the texts still « à traduire », on the saved texts and on the draft.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailTextsController');
const { countToTranslate } = require('../models/emailTextsModel');

test('rule 42: only a placed text with French and no English counts', () => {
  assert.equal(countToTranslate([
    { fr: 'Bonjour', en: '' },
    { fr: 'Bonjour', en: 'Hello' },
    { fr: '', en: '' },
    { fr: 'Pas utilisé', en: '', used: false },
  ]), 1);
});

test('rule 42: the page and the preview answer the count; the preview follows the draft', async () => {
  const { db, emails, templateId } = setup();
  const texts = buildController({ database: db, translator: { isAvailable: () => false } });
  const page = (await call(texts.list, { query: {} })).body;
  const base = page.toTranslate;
  assert.equal(typeof base, 'number');
  const j2 = page.sections.find((s) => s.id === 'j2');
  const key = j2.items.find((i) => i.kind === 'text' && i.used !== false && i.fr && i.en).key;

  await call(texts.save, { body: { changes: { [key]: { en: '' } } } });
  const emptied = (await call(texts.list, { query: {} })).body.toTranslate;
  assert.equal(emptied, base + 1);

  const typing = await call(emails.previewDraft, { body: {
    templateId: templateId('arrival_reminder_1d'), propertyId: 1, draft: { texts: { [key]: { en: 'Written in English.' } } },
  } });
  assert.equal(typing.body.toTranslate, base, 'the count follows what is typed, before saving');
  assert.equal((await call(texts.list, { query: {} })).body.toTranslate, emptied, 'nothing saved');
});
