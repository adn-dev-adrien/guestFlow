// specs/guest-email-texts-made-simple.md rule 41 (UI/UX review 2026-10-18, decision 13) — the preview
// says which text each sentence comes from, so a click on the email opens its field; the tags live in
// the preview's rolled-back transaction only, and no tag ever leaves in an email.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { tagText, split, strip, hasTag } = require('../utils/previewTags');
const { tokenError, templateAllowed } = require('../utils/templateTokens');

const TAG = /[\uE000-\uE002]/;

test('rule 41: a tagged text renders the same words; the conditions and the spaces stay outside the tags', () => {
  const tagged = tagText('  Café offert.{{#if hasPrice}} Pour {{price}}.{{/if}}\n', 'text:house');
  assert.equal(strip(tagged), '  Café offert.{{#if hasPrice}} Pour {{price}}.{{/if}}\n');
  assert.ok(tagged.startsWith('  \uE000text:house\uE001Café offert.\uE002{{#if hasPrice}} \uE000'));
  assert.equal(tagText('', 'text:house'), '');
  assert.equal(tagText('{{#if hasPrice}}{{price}}{{/if}}', 'text:x'), '{{#if hasPrice}}{{price}}{{/if}}', 'no words, no tag');
  assert.equal(hasTag(tagged), true);
});

test('rule 41: split gives the plain email and its segments; a value inside a sentence belongs to it', () => {
  const body = `Bonjour,\n\n${tagText('Garez-vous à', 'text:parkingLine')} 400 ${tagText('mètres.', 'text:parkingLine')}\n\nÀ bientôt`;
  const { plain, segments } = split(body);
  assert.equal(plain, 'Bonjour,\n\nGarez-vous à 400 mètres.\n\nÀ bientôt');
  assert.deepEqual(segments, [
    { text: 'Bonjour,\n\n', key: null },
    { text: 'Garez-vous à 400 mètres.', key: 'text:parkingLine' },
    { text: '\n\nÀ bientôt', key: null },
  ]);
  assert.equal(segments.map((s) => s.text).join(''), plain);
});

test('rule 41: the draft preview answers segments keyed by the page’s text keys, and the email reads as sent', async () => {
  const { db, emails, reservationId, templateId } = setup();
  db.prepare("UPDATE properties SET emailHook = 'Le poêle est prêt.', parkingDistanceMeters = 300 WHERE id = 1").run();
  db.prepare("INSERT INTO property_arrival_facts (propertyId, address, accessFr, accessEn) VALUES (1, '12 chemin des Prés', 'Portail vert.', '')").run();
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('house', 1, 'Thé du Gîte.', NULL)").run();
  const before = db.prepare('SELECT key, propertyId, fr, en FROM stay_texts ORDER BY key, propertyId').all();

  for (const stableKey of ['arrival_reminder_7d', 'arrival_reminder_1d', 'reservation_confirmation', 'guest_thanks_j1']) {
    for (const language of ['fr', 'en']) {
      const id = templateId(stableKey);
      const res = await call(emails.previewDraft, { body: { templateId: id, language, reservationId, propertyId: 1 } });
      assert.equal(res.status, 200);
      const sent = emails.buildPreview(reservationId, id, {}, language);
      assert.equal(res.body.body, sent.body, `${stableKey} ${language}: the preview is the email sent`);
      assert.equal(res.body.subject, sent.subject);
      assert.equal(res.body.segments.map((s) => s.text).join(''), res.body.body);
      assert.equal(TAG.test(JSON.stringify(res.body)), false, 'no tag in the answer');
      assert.equal(res.body.subjectKey, `subject:${stableKey}`);
    }
  }

  const j2 = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_1d'), reservationId, propertyId: 1 } });
  const keys = j2.body.segments.map((s) => s.key).filter(Boolean);
  assert.ok(keys.includes('text:house@1'), 'the property’s own text is named, not the shared one');
  assert.ok(keys.includes('access:1'));
  assert.ok(keys.includes('text:parkingLine'));
  const j7 = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_7d'), reservationId, propertyId: 1 } });
  assert.ok(j7.body.segments.some((s) => s.key === 'hook:1' && /poêle/.test(s.text)));

  // Rolled back: the stored texts are exactly what they were.
  assert.deepEqual(db.prepare('SELECT key, propertyId, fr, en FROM stay_texts ORDER BY key, propertyId').all(), before);
  assert.equal(db.prepare('SELECT emailHook FROM properties WHERE id = 1').get().emailHook, 'Le poêle est prêt.');
  assert.equal(db.prepare('SELECT accessFr FROM property_arrival_facts WHERE propertyId = 1').get().accessFr, 'Portail vert.');
});

test('rule 41: the test send and the real send carry no tag', async () => {
  const { db, emails, mail, reservationId, templateId } = setup();
  db.prepare("UPDATE properties SET emailHook = 'Le poêle est prêt.' WHERE id = 1").run();
  const draft = { templateId: templateId('arrival_reminder_1d'), draft: { texts: { 'text:house': { fr: 'Café et thé.' } } } };
  await call(emails.previewDraft, { body: draft });
  const test1 = await call(emails.sendTest, { body: draft });
  assert.equal(test1.status, 200);
  const sent = await call(emails.send, { body: { reservationId, templateId: templateId('arrival_reminder_7d') } });
  assert.equal(sent.status, 200);
  assert.ok(mail.sent.length >= 2);
  for (const message of mail.sent) {
    assert.equal(TAG.test(`${message.subject}${message.text}${message.html || ''}`), false);
  }
});

test('rule 41: the tag characters are refused in anything typed', () => {
  const refusal = tokenError('fr', 'Bonjour \uE000text:x\uE001', templateAllowed());
  assert.equal(refusal.message, 'Caractère invisible collé dans le texte : le retirer.');
});

test('rule 41: a lone tag character a value carried stays text', () => {
  const { plain, segments } = split(`Nom bizarre et  fin ${tagText('Phrase.', 'text:house')}`);
  assert.equal(plain, 'Nom bizarre et  fin Phrase.');
  assert.deepEqual(segments.map((s) => s.key), [null, 'text:house']);
});

test('rule 41: an empty first name before punctuation reads « Bonjour, » in the preview as in the send', async () => {
  const { db, emails, reservationId, templateId } = setup();
  db.prepare("UPDATE clients SET firstName = '' WHERE id = 1").run();
  for (const stableKey of ['arrival_reminder_1d', 'arrival_reminder_7d']) {
    const id = templateId(stableKey);
    const res = await call(emails.previewDraft, { body: { templateId: id, reservationId } });
    const sent = emails.buildPreview(reservationId, id, {}, 'fr');
    assert.equal(res.body.body, sent.body);
    assert.match(res.body.body, /^Bonjour,/);
    assert.equal(res.body.segments.map((s) => s.text).join(''), res.body.body);
  }
});
