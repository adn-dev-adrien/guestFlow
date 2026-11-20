// specs/outside-booking-sas.md rules 35-38 — the generic suggested-articles provider keyed by sale context: the context key, the operator's order, the `external` / `hosted`
// sellability filter, an article gone from the catalogue dropped at read time and never from the stored list, `ARTICLE_UNKNOWN`, at most 12, a plugin that is off
// hiding its kind and keeping its rows, the settings payload and the HTTP face.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const suggested = require('../utils/suggestedArticles');
const controller = require('../controllers/suggestedArticlesController');
const sales = require('../models/standaloneSalesModel');

const option = (title, price, { priceType = 'per_stay', sellable = 1, vatClass = 'drinks' } = {}) => Number(db.prepare('INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, ?, ?, ?)').run(title, price, priceType, sellable, vatClass).lastInsertRowid);
const beer = option('Bière locale', 6.5);
const lemonade = option('Limonade', 4);
const honey = option('Miel', 9, { sellable: 0 });
const breakfast = option('Petit-déjeuner', 12, { priceType: 'per_person_per_night' });
sales.setExternalRate('drinks', 20);
const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 4)").run().lastInsertRowid);
const bath = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType, showsPlanningCard) VALUES ('Bain', 1, 30, 'per_hour', 1)").run().lastInsertRowid);

let live = ['hourly-resources'];
registry.configure({ isActive: (id) => live.includes(id), allows: () => true });
createContext('hourly-resources', {}).suggestionContexts({ kind: 'resource', label: 'Ressources à l’heure', list: () => [{ id: bath, label: 'Bain' }] });

const ref = (id) => `option:${id}`;
const context = { kind: 'resource', id: String(bath) };
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });

test('rule 37 — a plugin declares the contexts of its kind; the core declares « property »; a kind is declared once and `property` is never a plugin\'s', () => {
  assert.deepEqual(suggested.kinds().map((k) => [k.kind, k.contexts.map((c) => c.label)]), [['property', ['Gîte']], ['resource', ['Bain']]]);
  assert.throws(() => createContext('other', {}).suggestionContexts({ kind: 'resource', label: 'x', list: () => [] }), /already declared by hourly-resources/);
  assert.throws(() => createContext('other', {}).suggestionContexts({ kind: 'property', label: 'x', list: () => [] }), /core's/);
  assert.throws(() => createContext('other', {}).suggestionContexts({ kind: 'Bad kind', label: 'x', list: () => [] }), /needs a kind/);
  assert.throws(() => createContext('other', {}).suggestionContexts({ kind: 'zone', label: '', list: () => [] }), /needs a label/);
});

test('rule 37 — a list is written whole, in the operator\'s order, 12 articles at most, each known to the catalogue', () => {
  const saved = suggested.save('resource', bath, [ref(lemonade), ref(beer), ref(honey)]);
  assert.deepEqual([saved.status, saved.articleRefs], [200, [ref(lemonade), ref(beer), ref(honey)]]);
  assert.deepEqual(suggested.save('resource', bath, [ref(beer), ref(lemonade)]).articleRefs, [ref(beer), ref(lemonade)], 'replaced, reordered');
  assert.deepEqual(suggested.save('resource', bath, [ref(9999)]).body.code, 'ARTICLE_UNKNOWN');
  assert.equal(suggested.save('resource', bath, [ref(beer), ref(beer)]).body.code, 'ARTICLE_DUPLICATE');
  const many = Array.from({ length: 13 }, (_, i) => ref(option(`Article ${i}`, 1)));
  assert.deepEqual([suggested.save('resource', bath, many).status, suggested.save('resource', bath, many).body.error], [400, '12 articles au plus.']);
  assert.equal(suggested.save('resource', bath, many.slice(0, 12)).status, 200);
  assert.equal(suggested.save('resource', 424242, [ref(beer)]).status, 404, 'a context no provider lists');
  assert.equal(suggested.save('zone', 1, []).body.code, 'CONTEXT_UNKNOWN');
  suggested.save('resource', bath, [ref(beer), ref(lemonade)]);
});

test('rule 36 — resolve answers { articleRef, label, unitCents, max } in the operator\'s order, priced by the head, one context at a time', () => {
  assert.deepEqual(suggested.resolve({ context, customerContext: 'external' }), [
    { articleRef: ref(beer), label: 'Bière locale', unitCents: 650, max: 99 },
    { articleRef: ref(lemonade), label: 'Limonade', unitCents: 400, max: 99 },
  ]);
  suggested.save('resource', bath, [ref(lemonade), ref(beer)]);
  assert.deepEqual(suggested.resolve({ context, customerContext: 'external' }).map((s) => s.articleRef), [ref(lemonade), ref(beer)]);
  assert.deepEqual(suggested.resolve({ context: { kind: 'property', id: String(propertyId) }, customerContext: 'external' }), [], 'another context has its own list');
});

test('rules 36, 38 — external: only sellable-outside articles of a family that needs no stay; hosted: the family\'s validate against the stay (the follow-up cannot break it silently)', () => {
  suggested.save('property', propertyId, [ref(beer), ref(honey), ref(breakfast)]);
  const property = { kind: 'property', id: String(propertyId) };
  assert.deepEqual(suggested.resolve({ context: property, customerContext: 'external' }).map((s) => s.articleRef), [ref(beer)], 'honey is not sellable outside, breakfast needs a stay');
  assert.deepEqual(suggested.resolve({ context: property, customerContext: 'hosted', stay: { persons: 2, nights: 3 } }).map((s) => [s.articleRef, s.unitCents]), [[ref(beer), 650], [ref(honey), 900], [ref(breakfast), 1200]]);
  assert.deepEqual(suggested.resolve({ context: property, stay: { persons: 2, nights: 3 } }).map((s) => s.articleRef), [ref(beer), ref(honey), ref(breakfast)], 'hosted by default');
});

test('rule 36 — an article that left the catalogue or is no longer sellable is dropped silently at read time, and never from the stored list', () => {
  suggested.save('resource', bath, [ref(beer), ref(lemonade)]);
  db.prepare('UPDATE options SET sellableExternally = 0 WHERE id = ?').run(lemonade);
  db.prepare("UPDATE options SET archivedAt = datetime('now') WHERE id = ?").run(beer);
  assert.deepEqual(suggested.resolve({ context, customerContext: 'external' }), []);
  assert.deepEqual(require('../models/suggestedArticlesModel').listFor('resource', bath), [ref(beer), ref(lemonade)], 'the stored list is untouched');
  db.prepare('UPDATE options SET sellableExternally = 1 WHERE id = ?').run(lemonade);
  db.prepare('UPDATE options SET archivedAt = NULL WHERE id = ?').run(beer);
  assert.equal(suggested.resolve({ context, customerContext: 'external' }).length, 2, 'back as soon as it is sellable again');
  db.prepare('DELETE FROM options WHERE id = ?').run(lemonade);
  assert.deepEqual(suggested.resolve({ context, customerContext: 'external' }).map((s) => s.articleRef), [ref(beer)]);
  assert.equal(require('../models/suggestedArticlesModel').listFor('resource', bath).length, 2);
});

test('rule 37 — with the plugin off its kind leaves the page and the resolver, and its rows come back on re-enable', () => {
  live = [];
  assert.deepEqual(suggested.kinds().map((k) => k.kind), ['property']);
  assert.deepEqual(suggested.resolve({ context, customerContext: 'external' }), []);
  assert.equal(suggested.save('resource', bath, [ref(beer)]).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM suggested_articles WHERE contextKind = 'resource'").get().n, 2);
  live = ['hourly-resources'];
  assert.deepEqual(suggested.kinds().map((k) => k.kind), ['property', 'resource']);
  assert.equal(suggested.resolve({ context, customerContext: 'external' }).length, 1);
});

test('rule 37 — a provider that throws is skipped, never failing the page', () => {
  createContext('broken-plugin', {}).suggestionContexts({ kind: 'broken', label: 'Cassé', list: () => { throw new Error('down'); } });
  live = ['hourly-resources', 'broken-plugin'];
  assert.deepEqual(suggested.kinds().find((k) => k.kind === 'broken').contexts, []);
  live = ['hourly-resources'];
});

test('rule 37 — the settings payload lists every live kind with its contexts and their lists; the controllers answer as the API contract says', () => {
  suggested.save('resource', bath, [ref(beer)]);
  const view = suggested.settingsView();
  assert.deepEqual(view.kinds.find((k) => k.kind === 'resource'), { kind: 'resource', label: 'Ressources à l’heure', contexts: [{ id: String(bath), label: 'Bain', articleRefs: [ref(beer)], articles: [{ articleRef: ref(beer), label: 'Bière locale' }] }] });
  const get = res();
  controller.resolved({ query: { kind: 'resource', id: String(bath), customerContext: 'external' } }, get);
  assert.deepEqual(get.body, { suggestions: [{ articleRef: ref(beer), label: 'Bière locale', unitCents: 650, max: 99 }] });
  const bad = res();
  controller.resolved({ query: {} }, bad);
  assert.equal(bad.statusCode, 400);
  const put = res();
  controller.save({ params: { kind: 'resource', id: String(bath) }, body: { articleRefs: [ref(honey), ref(beer)] } }, put);
  assert.deepEqual(put.body, { context: { kind: 'resource', id: String(bath), articleRefs: [ref(honey), ref(beer)] } });
  const missing = res();
  controller.save({ params: { kind: 'resource', id: String(bath) }, body: { articleRefs: ['option:0'] } }, missing);
  assert.deepEqual([missing.statusCode, missing.body.code], [400, 'ARTICLE_UNKNOWN']);
});
