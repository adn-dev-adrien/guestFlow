// specs/plugins-phase-p-productisation.md §3.B rules 7–11 — the sentences tied to options: when they
// are proposed, the price they quote, their sections, the confirmation order, the « Enfants » section,
// the resource sentence; and the API that edits them.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { buildController } = require('../controllers/emailMentionsController');
const { buildStayContent } = require('../utils/stayContentContext');
const { buildContext } = require('../utils/emailContextBuilder');
const { loadStayFacts } = require('../models/stayFactsModel');

function call(handler, req) {
  let out;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { out = { status: this.statusCode, body }; return this; },
    end() { out = { status: this.statusCode }; return this; },
  };
  handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
}

// Options: 1 cider 1 L (6 €), 2 cider 25 cl (3 €), 3 cheese platter (20 €), 4 pony ride (15 €),
// 5 towels (8 €, typed), 6 baby cot (0 €, typed).
function setup() {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'La Grange', nameArticle: 'à' });
  const add = db.prepare('INSERT INTO options (id, title, price, autoOptionType) VALUES (?, ?, ?, ?)');
  [[1, 'Cidre 1 L', 6, null], [2, 'Cidre 25 cl', 3, null], [3, 'Plateau de fromages', 20, null], [4, 'Balade à poney', 15, null],
    [5, 'Linge de toilette', 8, 'bathroom_linen'], [6, 'Lit bébé', 0, 'baby_bed']].forEach((o) => add.run(...o));
  for (const id of [1, 2, 3, 4, 5, 6]) db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id);
  const controller = buildController({ database: db });
  const make = (body) => call(controller.create, { body }).body;
  const cider = make({ section: 'local', optionIds: [1, 2], priceSource: 'option', priceOptionId: 1, offerFr: 'le cidre de la ferme ({{price}} le litre)', offerEn: 'farm cider ({{price}} a litre)', bookedFr: 'Le cidre vous attendra au frais.', bookedEn: 'Cider will be waiting, chilled.' });
  const cheese = make({ section: 'extras', optionIds: [3], offerFr: 'un plateau de fromages{{#if hasPrice}} ({{price}}){{/if}}', bookedFr: 'Votre plateau sera prêt.' });
  const pony = make({ section: 'kids', optionIds: [4], offerFr: 'Les enfants peuvent faire une balade à poney.', bookedFr: 'La balade à poney est réservée.' });
  return { db, controller, cider, cheese, pony };
}

function stay(db, { options = [], children = 0, babies = 0, lang = 'fr' } = {}) {
  const reservation = { propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-13', adults: 2, children, babies };
  const facts = loadStayFacts(db, reservation);
  return buildStayContent({ reservation, property: { name: 'La Grange', nameArticle: 'à' }, options: options.map((optionId) => ({ optionId, offered: 0 })), facts, lang }).vars;
}

test('rules 7–8: a mention is proposed while available, not included and not booked', () => {
  const { db } = setup();
  assert.match(stay(db).localProductsParagraph, /le cidre de la ferme \(6 € le litre\)/);
  assert.doesNotMatch(stay(db, { options: [2] }).localProductsParagraph, /cidre/, 'one of its options booked');
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 3, 1)').run();
  assert.doesNotMatch(stay(db).localProductsParagraph, /fromages/, 'included by default');
  db.prepare('DELETE FROM property_options WHERE optionId IN (1, 2)').run();
  assert.doesNotMatch(stay(db).localProductsParagraph, /cidre/, 'not offered by the property');
});

test('rule 7: the price is the chosen option\'s, else the lowest; P19 bis — one line for several options', () => {
  const { db, controller, cider } = setup();
  assert.match(stay(db).localProductsParagraph, /6 € le litre/);
  call(controller.update, { params: { id: cider.id }, body: { ...cider, priceSource: 'min' } });
  assert.match(stay(db).localProductsParagraph, /3 € le litre/);
  call(controller.update, { params: { id: cider.id }, body: { ...cider } });
  db.prepare('DELETE FROM property_options WHERE optionId = 1').run();
  assert.match(stay(db).localProductsParagraph, /3 € le litre/, 'chosen option unavailable: the lowest');
});

test('rule 8: sections — local first, the extras after, the deadline last; kids only with children', () => {
  const { db } = setup();
  const p = stay(db).localProductsParagraph;
  assert.match(p, /^Pour alléger les courses, nous pouvons vous proposer le cidre .*\. Nous pouvons aussi prévoir un plateau de fromages \(20 €\)\. Il suffit de nous le dire d'ici le mercredi 7 juillet 2027\.$/);
  assert.equal(stay(db).kidsParagraph, '');
  assert.equal(stay(db, { children: 1 }).kidsParagraph, 'Les enfants peuvent faire une balade à poney.');
  assert.equal(stay(db, { children: 1, options: [4] }).kidsParagraph, 'Les enfants peuvent faire une balade à poney.', 'booked or not');
});

test('rule 9: the confirmations follow their own order, independent of the proposal order', () => {
  const { db, controller, cider, cheese, pony } = setup();
  const booked = { options: [1, 3, 4, 5, 6], babies: 1 };
  assert.equal(stay(db, booked).bookedOptionsParagraph, [
    'Le lit bébé sera installé avant votre arrivée.', 'Vos serviettes de toilette seront prêtes.',
    'Le cidre vous attendra au frais.', 'Votre plateau sera prêt.', 'La balade à poney est réservée.',
  ].join('\n'), 'nothing ordered yet: the typed ones, then the mentions');
  assert.equal(call(controller.setConfirmationOrder, { body: { items: [`mention:${cheese.id}`, 'towels', `mention:${cider.id}`] } }).status, 200);
  assert.equal(stay(db, booked).bookedOptionsParagraph, [
    'Votre plateau sera prêt.', 'Vos serviettes de toilette seront prêtes.', 'Le cidre vous attendra au frais.',
    'Le lit bébé sera installé avant votre arrivée.', 'La balade à poney est réservée.',
  ].join('\n'));
  assert.match(stay(db).localProductsParagraph, /cidre.*plateau/, 'the proposal order is untouched');
  assert.equal(call(controller.setConfirmationOrder, { body: { items: ['mention:999'] } }).status, 400);
  call(controller.remove, { params: { id: pony.id } });
  assert.ok(!call(controller.list, {}).body.confirmationOrder.includes(`mention:${pony.id}`));
});

test('rule 10: the engine proposes nothing by name — an option without a mention is never cited', () => {
  const { db } = setup();
  db.prepare("INSERT INTO options (id, title, price, seedKey, category) VALUES (9, 'Jus de pomme 1L', 5, 'drink_jus_pomme_1l', 'Boissons')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 9)').run();
  assert.doesNotMatch(stay(db).localProductsParagraph, /jus/i);
});

test('rule 11: a booked resource says its sentence, with its slots while hourly resources are live', () => {
  const registry = require('../plugins/sdk/registry');
  const sentence = 'Le sauna est à vous{{#if slots}} {{slots}}{{/if}}.';
  const input = (sessions) => ({
    reservation: { startDate: '2027-07-10', endDate: '2027-07-13' },
    resources: [{ resourceId: 1, name: 'Sauna', priceType: 'per_hour', emailBookedText: sentence, sessions: JSON.stringify(sessions) }],
  });
  registry.configure({ isActive: () => true, allows: () => true });
  const live = buildContext(input([{ date: '2027-07-11', start: '18:00', end: '19:00' }]));
  assert.equal(live.flags.hasNordicBath, true);
  assert.equal(live.vars.nordicBathReminder, 'Le sauna est à vous le 11 juillet 2027 de 18:00 à 19:00.');
  registry.configure({ isActive: () => false });
  assert.equal(buildContext(input([{ date: '2027-07-11', start: '18:00' }])).vars.nordicBathReminder, 'Le sauna est à vous.');
  registry.reset();
});

test('API: options required, the chosen price among them, unknown tokens refused', () => {
  const { controller } = setup();
  assert.equal(call(controller.create, { body: { section: 'local', optionIds: [], offerFr: 'x' } }).body.field, 'optionIds');
  assert.equal(call(controller.create, { body: { section: 'local', optionIds: [1], priceSource: 'option', priceOptionId: 3, offerFr: 'x' } }).body.field, 'priceOptionId');
  assert.equal(call(controller.create, { body: { section: 'bar', optionIds: [1], offerFr: 'x' } }).status, 400);
  const bad = call(controller.create, { body: { section: 'local', optionIds: [1], offerFr: 'x', bookedFr: 'Prêt pour {{price}}' } });
  assert.deepEqual(bad, { status: 422, body: { field: 'bookedFr', message: 'Variable inconnue : {{price}}' } });
});

test('API: the proposal order lists every mention; the preview is the server\'s own rendering', () => {
  const { controller, cider, cheese, pony } = setup();
  assert.equal(call(controller.reorder, { body: { ids: [cheese.id] } }).status, 400);
  call(controller.reorder, { body: { ids: [pony.id, cheese.id, cider.id] } });
  assert.deepEqual(call(controller.list, {}).body.mentions.map((m) => m.id), [pony.id, cheese.id, cider.id]);
  const preview = call(controller.preview, { body: { propertyId: 1, children: 1, startDate: '2027-07-10' } }).body;
  assert.match(preview.fr.offers, /cidre/);
  assert.match(preview.fr.offers, /balade à poney/);
  assert.match(preview.fr.confirmations, /Le cidre vous attendra au frais\./);
  assert.match(preview.en.offers, /farm cider \(€6 a litre\)/);
  assert.equal(call(controller.preview, { body: { propertyId: 99 } }).status, 404);
});
