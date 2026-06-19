// Email template language selection (specs/email-language-fr-en.md §3 rules 2-3).

const test = require('node:test');
const assert = require('node:assert/strict');

const { normaliseLang, pickTemplateSide } = require('../utils/emailTemplateLanguage');

test('normaliseLang: only "en" (any case) maps to en; everything else → fr', () => {
  assert.equal(normaliseLang('en'), 'en');
  assert.equal(normaliseLang('EN'), 'en');
  assert.equal(normaliseLang('fr'), 'fr');
  assert.equal(normaliseLang(''), 'fr');
  assert.equal(normaliseLang(undefined), 'fr');
  assert.equal(normaliseLang('de'), 'fr');
});

const TPL = { subject: 'Sujet FR', body: 'Corps FR', subjectEn: 'Subject EN', bodyEn: 'Body EN' };

test('pickTemplateSide: en with a filled English body → English side', () => {
  const r = pickTemplateSide(TPL, 'en');
  assert.deepEqual(r, { subject: 'Subject EN', body: 'Body EN', usedLang: 'en' });
});

test('pickTemplateSide: fr → French side even when English exists', () => {
  const r = pickTemplateSide(TPL, 'fr');
  assert.deepEqual(r, { subject: 'Sujet FR', body: 'Corps FR', usedLang: 'fr' });
});

test('pickTemplateSide: en but empty bodyEn → French fallback (never blank)', () => {
  const r = pickTemplateSide({ subject: 'S', body: 'B', subjectEn: 'X', bodyEn: '' }, 'en');
  assert.deepEqual(r, { subject: 'S', body: 'B', usedLang: 'fr' });
});

test('pickTemplateSide: en with bodyEn but empty subjectEn → English body, French subject', () => {
  const r = pickTemplateSide({ subject: 'S', body: 'B', subjectEn: '', bodyEn: 'Body EN' }, 'en');
  assert.deepEqual(r, { subject: 'S', body: 'Body EN', usedLang: 'en' });
});
