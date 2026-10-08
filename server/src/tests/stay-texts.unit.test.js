// specs/plugins-phase-p-productisation.md §3.A rules 1–6 — the sentences of the guest emails as data:
// neutral defaults, a global save, a property's own text, the refusal of an unknown token, the reset,
// and the stored templates' variables unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { buildController } = require('../controllers/stayTextsController');
const { CATALOGUE, renderStayText, wordingOf } = require('../utils/stayTextCatalogue');
const { buildStayContent } = require('../utils/stayContentContext');
const { loadStayFacts } = require('../models/stayFactsModel');

function call(handler, req) {
  let out;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { out = { status: this.statusCode, body }; return this; },
  };
  handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
}

function setup() {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'La Grange', nameArticle: 'à', parkingDistanceMeters: 200 });
  return { db, controller: buildController({ database: db }) };
}

test('rule 1: every key has a neutral default in both languages, and no Solio word', () => {
  for (const entry of CATALOGUE) {
    assert.equal(typeof entry.fr, 'string', entry.key);
    assert.equal(typeof entry.en, 'string', entry.key);
    assert.doesNotMatch(`${entry.fr} ${entry.en}`, /Solio|Pilat|nordique|nordic|Nespresso|trappeur|domaine/i, entry.key);
  }
  const { body } = call(setup().controller.list, {});
  assert.equal(body.texts.length, CATALOGUE.length);
  assert.ok(body.texts.every((t) => t.isDefault));
});

test('rule 2: tokens are filled and flags choose the branch', () => {
  const text = renderStayText('beds.linenNotIncluded', 'fr', { bedConfig: '1 lit double', price: '12 €' }, { linenOffered: true }, {});
  assert.match(text, /1 lit double/);
  assert.match(text, /demandez-nous de les préparer/);
  assert.doesNotMatch(renderStayText('beds.linenNotIncluded', 'fr', { bedConfig: 'x' }, { linenOffered: false }, {}), /demandez-nous/);
});

test('rule 2: a global save is what the emails say, and an empty text means no paragraph', () => {
  const { db, controller } = setup();
  assert.equal(call(controller.save, { params: { key: 'cleaning.included' }, body: { fr: 'Ménage offert.', en: 'Cleaning on us.' } }).status, 200);
  assert.equal(call(controller.save, { params: { key: 'bag.items' }, body: { fr: '', en: '' } }).status, 200);
  const facts = loadStayFacts(db, { propertyId: 1 });
  assert.equal(wordingOf('cleaning.included', 'fr', facts.texts), 'Ménage offert.');
  const content = buildStayContent({ reservation: { startDate: '2027-07-10', endDate: '2027-07-12' }, property: { name: 'La Grange' }, facts, lang: 'fr' });
  assert.equal(content.vars.bagList, '- Vos serviettes de toilette', 'no item line, the towels line alone');
});

test('rule 3: a property overrides house, travelLight, parkingLine and noWifi; empty falls back', () => {
  const { db, controller } = setup();
  call(controller.save, { params: { key: 'parkingLine' }, body: { fr: '- Parking à {{distance}} m.', en: '' } });
  call(controller.save, { params: { key: 'parkingLine' }, body: { fr: '- Garez-vous devant la grange.', en: '', propertyId: 1 } });
  const facts = loadStayFacts(db, { propertyId: 1 });
  const fr = renderStayText('parkingLine', 'fr', { distance: 200 }, {}, facts.texts);
  assert.equal(fr, '- Garez-vous devant la grange.');
  assert.equal(renderStayText('parkingLine', 'en', { distance: 200 }, {}, facts.texts), '', 'the global EN text is empty, the override too');
  assert.equal(call(controller.save, { params: { key: 'cleaning.included' }, body: { fr: 'x', propertyId: 1 } }).status, 400);
  const own = call(controller.list, { query: { propertyId: '1' } }).body.texts;
  assert.deepEqual(own.map((t) => t.key).sort(), ['house', 'noWifi', 'parkingLine', 'travelLight']);
  assert.equal(own.find((t) => t.key === 'parkingLine').globalFr, '- Parking à {{distance}} m.');
});

test('rule 4: an unknown token or flag is refused at save, never stored', () => {
  const { controller } = setup();
  const unknown = call(controller.save, { params: { key: 'offers.localIntro' }, body: { fr: 'Nos produits : {{prix}}', en: '' } });
  assert.equal(unknown.status, 422);
  assert.deepEqual(unknown.body, { field: 'fr', message: 'Variable inconnue : {{prix}}' });
  const flag = call(controller.save, { params: { key: 'house' }, body: { fr: '', en: '{{#if hasPool}}Pool{{/if}}' } });
  assert.deepEqual(flag.body, { field: 'en', message: 'Variable inconnue : {{hasPool}}' });
  assert.ok(call(controller.list, {}).body.texts.every((t) => t.isDefault));
  assert.equal(call(controller.save, { params: { key: 'nope' }, body: {} }).status, 404);
});

test('rule 5: « Rétablir » puts the default back for one language', () => {
  const { controller } = setup();
  call(controller.save, { params: { key: 'instagram' }, body: { fr: 'Instagram : {{link}}', en: 'Instagram: {{link}}' } });
  call(controller.reset, { params: { key: 'instagram' }, query: { lang: 'fr' } });
  const row = call(controller.list, {}).body.texts.find((t) => t.key === 'instagram');
  assert.equal(row.fr, row.defaultFr);
  assert.equal(row.en, 'Instagram: {{link}}');
  call(controller.reset, { params: { key: 'instagram' }, query: {} });
  assert.ok(call(controller.list, {}).body.texts.find((t) => t.key === 'instagram').isDefault);
});

test('rule 6: the stored templates keep their variables', () => {
  const content = buildStayContent({ reservation: { startDate: '2027-07-10', endDate: '2027-07-12', doubleBeds: 1 }, property: { name: 'La Grange' }, facts: {}, lang: 'fr' });
  for (const name of ['bedsParagraph', 'bagList', 'coffeeParagraph', 'quietSinceDeparture', 'localProductsParagraph', 'bookedOptionsParagraph', 'cleaningParagraph']) {
    assert.ok(Object.prototype.hasOwnProperty.call(content.vars, name), name);
  }
});
