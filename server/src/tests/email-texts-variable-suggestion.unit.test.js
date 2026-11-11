// specs/guest-email-texts-made-simple.md rule 41 (UI/UX review 2026-10-18, decision 5) — a mistyped
// variable is refused where it was typed, with the closest variable this text may use as the fix.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { closestVariable, templateAllowed, tokenError } = require('../utils/templateTokens');
const { buildController } = require('../controllers/emailTextsController');

test('rule 41: the closest variable, by name or by label, within a few letters', () => {
  const allowed = templateAllowed();
  assert.deepEqual(closestVariable('prenon', allowed), { name: 'clientFirstName', label: 'Prénom du voyageur' });
  assert.deepEqual(closestVariable('distnce', { tokens: ['distance', 'price'] }), { name: 'distance', label: 'Distance (m)' });
  assert.equal(closestVariable('zzzzzz', { tokens: ['distance'] }), null);
  assert.equal(closestVariable('', allowed), null);
});

test('rule 41: the refusal names the typed word and carries the suggestion', () => {
  const refusal = tokenError('fr', 'Bonjour {{prenon}}', templateAllowed());
  assert.equal(refusal.message, 'Variable inconnue : {{prenon}}');
  assert.equal(refusal.unknown, 'prenon');
  assert.deepEqual(refusal.suggestion, { name: 'clientFirstName', label: 'Prénom du voyageur' });
});

test('rule 41: a save and a preview answer the suggestion in their 422', async () => {
  const { db, emails, templateId } = setup();
  const texts = buildController({ database: db, translator: { isAvailable: () => false } });
  const saved = await call(texts.save, { body: { changes: { 'text:parkingLine': { fr: 'À {{distnce}} m.' } } } });
  assert.equal(saved.status, 422);
  assert.equal(saved.body.key, 'text:parkingLine');
  assert.deepEqual(saved.body.suggestion, { name: 'distance', label: 'Distance (m)' });
  const preview = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_1d'), draft: { texts: { 'text:parkingLine': { fr: 'À {{distnce}} m.' } } } } });
  assert.equal(preview.status, 422);
  assert.deepEqual(preview.body.suggestion, { name: 'distance', label: 'Distance (m)' });
});
