// specs/guest-email-texts-made-simple.md rule 40 (UI/UX review 2026-10-18, decision 12) — one name per
// email, everywhere, and Emails › Modèles in the order of the stay; a shipped email is switched off,
// never deleted.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { displayNameOf, timeline } = require('../utils/emailTimeline');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const { buildController } = require('../controllers/emailTemplatesController');
const { buildController: buildTexts } = require('../controllers/emailTextsController');

test('rule 40: a shipped email is named by its purpose; the operator’s own keeps its name', () => {
  assert.equal(displayNameOf({ stableKey: 'arrival_reminder_1d', name: 'Séquence — J-2 arrivée' }), 'Accès et arrivée');
  assert.equal(displayNameOf({ stableKey: null, name: ' Promo printemps ' }), 'Promo printemps');
});

test('rule 40: the timeline follows the stay', () => {
  const groups = timeline([
    { id: 9, stableKey: null, name: 'Promo', dayOffset: 0, anchor: 'start' },
    { id: 1, stableKey: 'season_new_year', anchor: 'season', dayOffset: 0 },
    { id: 2, stableKey: 'arrival_reminder_1d', anchor: 'start', dayOffset: -2 },
    { id: 3, stableKey: 'arrival_reminder_7d', anchor: 'start', dayOffset: -7 },
    { id: 4, stableKey: 'reservation_confirmation', anchor: 'created', dayOffset: 0 },
    { id: 5, stableKey: 'cancellation_notice', dayOffset: 0 },
    { id: 6, stableKey: 'guest_thanks_j1', anchor: 'end', dayOffset: 1 },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.templates.map((t) => t.id)]), [
    ['À la réservation', [4]],
    ['Avant l’arrivée', [3, 2]],
    ['Pendant le séjour', [9]],
    ['Après le départ', [6]],
    ['Saison', [1]],
    ['Annulation', [5]],
  ]);
});

test('rule 40: the list answers the name and the moment, the timeline view groups it, the texts page reuses the names', async () => {
  const { db } = setup();
  const controller = buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const list = await call(controller.list, { query: {} });
  const j2 = list.body.find((t) => t.stableKey === 'arrival_reminder_1d');
  assert.equal(j2.displayName, 'Accès et arrivée');
  assert.equal(j2.when.sentence, 'Envoyé 2 jours avant l’arrivée');
  assert.equal(j2.shipped, true);
  const view = await call(controller.list, { query: { view: 'timeline' } });
  assert.equal(view.body.groups[0].label, 'À la réservation');
  assert.equal(view.body.groups[0].templates[0].displayName, 'Confirmation');

  const texts = await call(buildTexts({ database: db, translator: { isAvailable: () => false } }).list, { query: {} });
  const section = texts.body.sections.find((s) => s.id === 'j2');
  assert.equal(section.title, 'Accès et arrivée');
  assert.equal(section.when, 'Envoyé 2 jours avant l’arrivée');
  assert.equal(section.templates[0].name, 'Accès et arrivée');
});

test('rule 40: a shipped email cannot be deleted; the operator’s own can', async () => {
  const { db, templateId } = setup();
  const model = emailTemplatesModel.buildModel(db);
  const controller = buildController(model, { read: () => ({}) });
  const refused = await call(controller.remove, { params: { id: templateId('arrival_reminder_1d') } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.message, 'Email livré : il se coupe, il ne se supprime pas.');
  const own = model.insert({ name: 'Promo', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual' });
  const removed = await call(controller.remove, { params: { id: own.id } });
  assert.equal(removed.status, 200);
});
