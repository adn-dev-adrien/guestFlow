// specs/guest-email-texts-made-simple.md §3.C rule 9 — one page, one section per email in send order,
// each holding only the sentences of that email (subject, stay texts, mentions, the property's hook
// and its own texts), written through one key space and one transaction.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailTextsController');

const translator = { isAvailable: () => false };

test('rule 9: the sections follow the send order and hold only their own sentences', async () => {
  const { db } = setup();
  db.prepare("INSERT INTO email_mentions (section, offerFr, bookedFr) VALUES ('extras', 'du pain', 'Le pain sera là.')").run();
  const res = await call(buildController({ database: db, translator }).list, {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sections.map((s) => s.id), ['confirmation', 'payment', 'j7', 'j2', 'j1', 'season', 'cancellation']);
  assert.deepEqual(res.body.sections.map((s) => s.title), [
    'Confirmation', 'Demande d’acompte / de solde', 'J-7', 'J-2', 'Lendemain du départ', 'Relances novembre / janvier', 'Annulation',
  ]);
  const keysOf = (id) => res.body.sections.find((s) => s.id === id).items.map((i) => i.key);
  assert.equal(keysOf('j7')[0], 'subject:arrival_reminder_7d');
  assert.ok(keysOf('j7').includes('hook:1'));
  assert.ok(keysOf('j7').includes('mention:1:offer'));
  assert.ok(keysOf('j7').includes('text:beds.made'));
  assert.ok(keysOf('j2').includes('mention:1:booked'));
  assert.ok(keysOf('j2').includes('text:addressParagraph'));
  assert.ok(keysOf('j2').includes('access:1'));
  assert.ok(keysOf('j2').includes('text:house@1'));
  assert.ok(!keysOf('j2').includes('text:beds.made'));
  assert.deepEqual(keysOf('cancellation'), ['subject:cancellation_notice']);
  // The online-payment requests belong to a plugin that is not live here.
  assert.ok(!keysOf('payment').includes('subject:deposit_request'));
  const item = res.body.sections[2].items.find((i) => i.key === 'text:beds.made');
  assert.equal(item.allowed, undefined);
  assert.equal(item.chips.variables[0].label, 'Lits');
  assert.equal(res.body.canTranslate, false);
});

test('rule 9: one save writes every kind of text; one refusal and nothing is written', async () => {
  const { db } = setup();
  const controller = buildController({ database: db, translator });
  const ok = await call(controller.save, { body: { changes: {
    'subject:arrival_reminder_1d': { fr: 'À bientôt {{propertyWithArticle}}' },
    'text:house': { fr: 'Café offert.', en: 'Coffee on us.' },
    'text:house@1': { fr: 'Thé offert.' },
    'hook:1': { fr: 'Le jardin est à vous.' },
    'access:1': { fr: 'Porte bleue.' },
  } } });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare("SELECT subject FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().subject, 'À bientôt {{propertyWithArticle}}');
  assert.deepEqual(db.prepare("SELECT fr, en FROM stay_texts WHERE key = 'house' AND propertyId = 0").get(), { fr: 'Café offert.', en: 'Coffee on us.' });
  assert.equal(db.prepare("SELECT fr FROM stay_texts WHERE key = 'house' AND propertyId = 1").get().fr, 'Thé offert.');
  assert.equal(db.prepare('SELECT emailHook FROM properties WHERE id = 1').get().emailHook, 'Le jardin est à vous.');
  assert.equal(db.prepare('SELECT accessFr FROM property_arrival_facts WHERE propertyId = 1').get().accessFr, 'Porte bleue.');

  const refused = await call(controller.save, { body: { changes: {
    'text:house': { fr: 'Autre.' },
    'text:beds.made': { fr: '{{prenon}}' },
  } } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body, { key: 'text:beds.made', field: 'fr', message: 'Variable inconnue : {{prenon}}' });
  assert.equal(db.prepare("SELECT fr FROM stay_texts WHERE key = 'house' AND propertyId = 0").get().fr, 'Café offert.');

  const emptySubject = await call(controller.save, { body: { changes: { 'subject:arrival_reminder_1d': { fr: ' ' } } } });
  assert.equal(emptySubject.status, 422);
  assert.equal(emptySubject.body.message, 'Texte obligatoire');
});

test('rule 24: a resource\'s sentence once booked is a text of the J-2, saved, exported and checked for English', async () => {
  const { db } = setup();
  db.prepare("INSERT INTO resources (id, name, emailBookedText, emailBookedTextEn) VALUES (9, 'Bain nordique', 'Le bain sera chaud {{slots}}.', '')").run();
  const controller = buildController({ database: db, translator });
  const res = await call(controller.list, {});
  const item = res.body.sections.find((s) => s.id === 'j2').items.find((i) => i.key === 'resource:9');
  assert.equal(item.label, 'Réservé — Bain nordique');
  assert.deepEqual(item.chips.variables, [{ name: 'slots', label: 'Créneaux' }]);
  const saved = await call(controller.save, { body: { changes: { 'resource:9': { en: 'The bath will be warm {{slots}}.' } } } });
  assert.equal(saved.status, 200);
  assert.equal(db.prepare('SELECT emailBookedTextEn FROM resources WHERE id = 9').get().emailBookedTextEn, 'The bath will be warm {{slots}}.');
  const refused = await call(controller.save, { body: { changes: { 'resource:9': { fr: '{{price}}' } } } });
  assert.equal(refused.body.message, 'Variable non disponible ici : Prix');
  const csv = await call(controller.exportCsv);
  assert.match(csv.body, /\r\nJ-2;resource:9;Réservé — Bain nordique;Le bain sera chaud \{\{slots\}\}\.;/);
});

test('rule 25: a sentence the stored template of its email does not place is marked unused', async () => {
  const { db } = setup();
  const usedOf = async (key) => {
    const res = await call(buildController({ database: db, translator }).list, {});
    return res.body.sections.flatMap((s) => s.items).find((i) => i.key === key).used;
  };
  assert.equal(await usedOf('text:house'), true);
  assert.equal(await usedOf('access:1'), true);
  db.prepare("UPDATE email_templates SET body = 'Bonjour {{clientFirstName}}, 215 côte de Japperenard.' WHERE stableKey = 'arrival_reminder_1d'").run();
  assert.equal(await usedOf('text:house'), false);
  assert.equal(await usedOf('access:1'), false);
  assert.equal(await usedOf('subject:arrival_reminder_1d'), true);
  assert.equal(await usedOf('text:beds.made'), true, 'the J-7 still places the beds');
});
