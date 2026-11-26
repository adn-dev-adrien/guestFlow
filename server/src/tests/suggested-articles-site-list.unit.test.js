// specs/site/site-outside-resource-booking.md rules 34-36 (§3.H) — the one « Options proposées » list serves the arrival and the website: each context says where it shows (`shownOn`, from its
// kind's provider), the settings catalogue lists the articles the engine refuses outside a stay greyed with their reason (`all`), and the save of a list for a customer with no stay refuses them.
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

const option = (title, price, { priceType = 'per_stay', sellable = 1, vatClass = 'drinks', category = null } = {}) => Number(db.prepare('INSERT INTO options (title, price, priceType, sellableExternally, vatClass, category) VALUES (?, ?, ?, ?, ?, ?)').run(title, price, priceType, sellable, vatClass, category).lastInsertRowid);
const beer = option('Bière locale', 6.5, { category: 'Boissons' });
const towels = option('Torchon', 5, { priceType: 'per_person', category: 'Linge' });
const honey = option('Miel', 9, { sellable: 0, category: 'Épicerie' });
sales.setExternalRate('drinks', 20);
const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 4)").run().lastInsertRowid);
const bath = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType, showsPlanningCard) VALUES ('Bain', 1, 30, 'per_hour', 1)").run().lastInsertRowid);
const sauna = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType, showsPlanningCard) VALUES ('Sauna', 1, 20, 'per_hour', 1)").run().lastInsertRowid);

registry.configure({ isActive: () => true, allows: () => true });
createContext('hourly-resources', {}).suggestionContexts({
  kind: 'resource',
  label: 'Ressources à l’heure',
  list: () => [{ id: bath, label: 'Bain' }, { id: sauna, label: 'Sauna' }],
  shownOnSite: (id) => {
    if (Number(id) === sauna) throw new Error('down');
    return Number(id) === bath;
  },
});

const ref = (id) => `option:${id}`;
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } });
const contextsOf = (kind) => suggested.kinds().find((k) => k.kind === kind).contexts;

test('rule 35 — a context shows on the site only when its kind\'s provider says so; the core property kind, a throwing provider and an absent one show at the arrival only', () => {
  assert.deepEqual(contextsOf('resource').map((c) => [c.label, c.shownOn]), [['Bain', ['arrival', 'site']], ['Sauna', ['arrival']]]);
  assert.deepEqual(contextsOf('property').map((c) => c.shownOn), [['arrival']]);
  const view = suggested.settingsView();
  assert.deepEqual(view.kinds.find((k) => k.kind === 'resource').contexts.map((c) => c.shownOn), [['arrival', 'site'], ['arrival']]);
});

test('rule 35 — shownOnSite must be a function when given', () => {
  assert.throws(() => createContext('other', {}).suggestionContexts({ kind: 'zone', label: 'Zone', list: () => [], shownOnSite: true }), /shownOnSite must be a function/);
});

test('rule 36 — the settings catalogue with `all` lists the article that needs a stay greyed with the engine\'s sentence, and the one not ticked sellable outside with the catalogue\'s own sentence', () => {
  const all = suggested.catalogue({ customerContext: 'external', all: true });
  const byRef = Object.fromEntries(all.map((a) => [a.articleRef, a]));
  assert.deepEqual([byRef[ref(beer)].sellable, byRef[ref(beer)].reason, byRef[ref(beer)].unitCents], [true, null, 650]);
  assert.deepEqual([byRef[ref(towels)].sellable, byRef[ref(towels)].unitCents], [false, null]);
  assert.equal(byRef[ref(towels)].reason, 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.');
  assert.deepEqual([byRef[ref(honey)].sellable, byRef[ref(honey)].reason], [false, 'Pas marqué « vendable hors séjour » dans le catalogue.']);
  assert.equal(suggested.catalogue({ customerContext: 'external' }).some((a) => a.articleRef === ref(towels)), false, 'without `all` the refused article is not listed, as before');
  assert.equal(suggested.catalogue({ customerContext: 'external', all: true, q: 'torchon' }).length, 1, 'the search filters the greyed rows too');
  const groups = suggested.catalogueGroups({ customerContext: 'external', all: true }).filter((g) => ['Boissons', 'Épicerie', 'Linge'].includes(g.category));
  assert.deepEqual(groups.map((g) => g.category), ['Boissons', 'Épicerie', 'Linge'], 'grouped by category, in order, the greyed ones in their group');
});

test('rule 36 — `context=<kind>:<id>&all=1` takes the customer from the kind: a resource list is read as an outside customer, a property list as a hosted one', () => {
  const asResource = res();
  controller.catalogue({ query: { context: `resource:${bath}`, all: '1' } }, asResource);
  assert.equal(asResource.body.articles.find((a) => a.articleRef === ref(towels)).sellable, false);
  const asProperty = res();
  controller.catalogue({ query: { context: `property:${propertyId}`, all: '1' } }, asProperty);
  assert.equal(asProperty.body.articles.find((a) => a.articleRef === ref(towels)).sellable, true, 'a stay is there: a per-person article sells');
  ['nothing:1', `resource:${bath + 100}`, 'resource'].forEach((context) => {
    const unknown = res();
    controller.catalogue({ query: { context } }, unknown);
    assert.deepEqual([unknown.statusCode, unknown.body.code], [400, 'CONTEXT_UNKNOWN'], context);
  });
});

test('rule 36 — save refuses an article the engine does not sell outside a stay on a resource list (ARTICLE_NEEDS_STAY, the reason and « Retirer pour enregistrer. »), and accepts it on a property list', () => {
  const refused = suggested.save('resource', bath, [ref(beer), ref(towels)]);
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body, {
    error: 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul. Retirer pour enregistrer.', code: 'ARTICLE_NEEDS_STAY', articleRef: ref(towels),
  });
  assert.equal(suggested.save('resource', bath, [ref(honey)]).body.code, 'ARTICLE_NEEDS_STAY');
  assert.deepEqual(suggested.settingsView().kinds.find((k) => k.kind === 'resource').contexts[0].articleRefs, [], 'nothing was stored by the refused saves');
  assert.equal(suggested.save('property', propertyId, [ref(beer), ref(towels)]).status, 200);
  assert.equal(suggested.save('resource', bath, [ref(beer)]).status, 200);
});

test('rule 36 — the settings payload carries each listed article\'s unit price and, when it is refused now, its reason, so the page draws it in warning', () => {
  suggested.save('property', propertyId, [ref(beer), ref(towels)]);
  const [property] = suggested.settingsView().kinds.find((k) => k.kind === 'property').contexts;
  assert.deepEqual(property.articles.map((a) => [a.articleRef, a.unitCents, a.reason]), [[ref(beer), 650, null], [ref(towels), 500, null]]);
  suggested.save('resource', bath, [ref(beer)]);
  db.prepare('UPDATE options SET priceType = ? WHERE id = ?').run('per_person', beer);
  const [resource] = suggested.settingsView().kinds.find((k) => k.kind === 'resource').contexts;
  assert.equal(resource.articles[0].reason, 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.');
  assert.equal(resource.articles[0].unitCents, null);
});

test('rule 36 — each catalogue entry and each listed article says what a unit is counted in (the server\'s `unitLabel`); a per-person article is « par personne »', () => {
  db.prepare('UPDATE options SET priceType = ? WHERE id = ?').run('per_stay', beer);
  const byRef = Object.fromEntries(suggested.catalogue({ customerContext: 'external', all: true }).map((a) => [a.articleRef, a]));
  assert.deepEqual([byRef[ref(beer)].unitLabel, byRef[ref(towels)].unitLabel], ['l’unité', 'par personne']);
  suggested.save('property', propertyId, [ref(towels)]);
  const [property] = suggested.settingsView().kinds.find((k) => k.kind === 'property').contexts;
  assert.deepEqual(property.articles.map((a) => [a.unitCents, a.unitLabel]), [[500, 'par personne']]);
});

test('rule 36 — a listed article the engine cannot price now (archived) comes back with a reason, so the page shows its warning row instead of hiding it', () => {
  const gone = option('Cidre', 4, { category: 'Boissons' });
  suggested.save('resource', bath, [ref(gone)]);
  db.prepare("UPDATE options SET archivedAt = '2026-11-01' WHERE id = ?").run(gone);
  const [resource] = suggested.settingsView().kinds.find((k) => k.kind === 'resource').contexts;
  assert.deepEqual(resource.articles.map((a) => [a.unitCents, a.reason]), [[null, 'Prix introuvable : l’article n’est pas proposé.']]);
});
