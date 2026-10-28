// specs/options-resources-ux.md rules 18, 19, 21 — each resource ready to render, the lines a live plugin
// adds, and the authoritative validation of a resource write.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildResourceItems } = require('../utils/resourceCatalogueView');
const resourcesController = require('../controllers/resourcesController');
const sdkRegistry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { resourceCatalogueContributors } = require('../utils/resourceCatalogueContributors');

const GRANJA = { id: 1, name: 'Granja' };
const ESTIVA = { id: 2, name: 'Estiva' };
const PROPS = [GRANJA, ESTIVA];

const resource = (over = {}) => ({
  id: 1, name: 'Lit bébé', note: '', quantity: 3, price: 0, basePrice: 0, priceType: 'free',
  propertyIds: [], propertyPricing: {}, ...over,
});
const lineOf = (item, label) => (item.lines.find((l) => l.label === label) || {}).value;

test('rule 18: the stock reads « en stock », « en service » for a resource sold by the hour', () => {
  const [bed, bath] = buildResourceItems([
    resource({ quantity: 3 }),
    resource({ id: 2, name: 'Bain nordique', quantity: 1, priceType: 'per_hour', price: 30, basePrice: 30 }),
  ], PROPS);
  assert.deepEqual(bed.stock, { value: 3, label: 'en stock' });
  assert.deepEqual(bath.stock, { value: 1, label: 'en service' });
});

test('rule 18: a big stock stays a number', () => {
  const [item] = buildResourceItems([resource({ quantity: 1284 })], PROPS);
  assert.equal(item.stock.value, 1284);
});

test('rule 18: the price lines — free, per hour, per stay', () => {
  const [free, hour, stay] = buildResourceItems([
    resource({ priceType: 'free' }),
    resource({ id: 2, priceType: 'per_hour', price: 30, basePrice: 30 }),
    resource({ id: 3, priceType: 'per_stay', price: 12.5, basePrice: 12.5 }),
  ], PROPS);
  assert.equal(lineOf(free, 'Prix'), 'Gratuit');
  assert.equal(lineOf(hour, 'Prix'), '30 € / h');
  assert.equal(lineOf(stay, 'Prix'), '12,50 € / séjour');
});

test('rule 18: « Logements » reads « Tous » for the legacy empty scope and when every property is concerned', () => {
  const [legacy, all, one] = buildResourceItems([
    resource({ propertyIds: [] }),
    resource({ id: 2, propertyIds: [1, 2] }),
    resource({ id: 3, propertyIds: [2] }),
  ], PROPS);
  assert.equal(lineOf(legacy, 'Logements'), 'Tous');
  assert.equal(lineOf(all, 'Logements'), 'Tous');
  assert.equal(lineOf(one, 'Logements'), 'Estiva');
});

test('rule 18: a per-property price gets its own line, and the base price disappears when every property overrides it', () => {
  const [some, every] = buildResourceItems([
    resource({ priceType: 'per_hour', price: 30, basePrice: 30, propertyPricing: { 2: { price: 50, freeMinutes: 0 } } }),
    resource({ id: 2, priceType: 'per_hour', price: 30, basePrice: 30, propertyPricing: { 1: { price: 40, freeMinutes: 0 }, 2: { price: 50, freeMinutes: 0 } } }),
  ], PROPS);
  assert.equal(lineOf(some, 'Prix'), '30 € / h');
  assert.equal(lineOf(some, 'Estiva'), '50 € / h');
  assert.equal(lineOf(every, 'Prix'), undefined);
  assert.equal(lineOf(every, 'Granja'), '40 € / h');
});

test('rule 18: a property line that only repeats the base price (a free hour, say) is not a price of its own', () => {
  const [item] = buildResourceItems([
    resource({ priceType: 'per_hour', price: 30, basePrice: 30, propertyPricing: { 1: { price: 30, freeMinutes: 60 }, 2: { price: 30, freeMinutes: 60 } } }),
  ], PROPS);
  assert.equal(lineOf(item, 'Prix'), '30 € / h');
  assert.equal(lineOf(item, 'Granja'), undefined);
});

test('rule 18: only the baby bed is not deletable', () => {
  const [bed, bath] = buildResourceItems([resource({ name: 'Lit bébé' }), resource({ id: 2, name: 'Bain nordique' })], PROPS);
  assert.equal(bed.deletable, false);
  assert.equal(bath.deletable, true);
});

test('rule 19: a contributor adds lines after the core ones and sets the footer; a null answer adds nothing', () => {
  const contributors = [
    (r, ctx) => ({ lines: [{ label: 'Soir', value: `${r.name}:${ctx.properties.length}` }], footer: 'Pied' }),
    () => null,
  ];
  const [item] = buildResourceItems([resource({ priceType: 'per_hour' })], PROPS, contributors);
  assert.equal(lineOf(item, 'Soir'), 'Lit bébé:2');
  assert.equal(item.footer, 'Pied');
  const [bare] = buildResourceItems([resource()], PROPS, []);
  assert.equal(bare.footer, '');
  assert.deepEqual(bare.lines.map((l) => l.label), ['Prix', 'Logements']);
});

test('rule 19: the SDK brick registers the builder of a plugin, and only a live plugin contributes', () => {
  sdkRegistry.reset();
  const build = () => ({ lines: [] });
  const ctx = createContext('probe-plugin');
  ctx.resourceCatalogueLines(build);
  sdkRegistry.configure({ isActive: (id) => id === 'probe-plugin', allows: () => true });
  assert.deepEqual(resourceCatalogueContributors(), [build]);
  sdkRegistry.configure({ isActive: () => false });
  assert.deepEqual(resourceCatalogueContributors(), []);
  assert.throws(() => ctx.resourceCatalogueLines('nope'), /needs a function/);
  sdkRegistry.reset();
});

function fakeModel(list) {
  return {
    list: () => list,
    findById: (id) => list.find((r) => Number(r.id) === Number(id)) || null,
    insert: () => 42,
    update: () => {},
  };
}
const fakeRes = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('rule 18: the catalogue endpoint hides a resource sold by the hour while its plugin is off', () => {
  const list = [resource({ id: 1 }), resource({ id: 2, name: 'Bain', priceType: 'per_hour' })];
  const off = resourcesController.buildController(fakeModel(list), {
    isOffered: (r) => r.priceType !== 'per_hour', properties: () => PROPS, contributors: () => [],
  });
  const hidden = fakeRes();
  off.catalogueView({}, hidden);
  assert.deepEqual(hidden.body.items.map((i) => i.id), [1]);

  const on = resourcesController.buildController(fakeModel(list), {
    isOffered: () => true, properties: () => PROPS, contributors: () => [() => ({ footer: 'ok' })],
  });
  const shown = fakeRes();
  on.catalogueView({}, shown);
  assert.deepEqual(shown.body.items.map((i) => i.id), [1, 2]);
  assert.equal(shown.body.items[1].footer, 'ok');
});

const controller = () => resourcesController.buildController(fakeModel([resource()]), { isOffered: () => true });
const refused = (body) => {
  const r = fakeRes();
  controller().create({ body }, r);
  return r;
};
const detailFields = (r) => (r.body.details || []).map((d) => d.field);

test('rule 21: a valid resource is saved', () => {
  const r = refused({ name: 'Vélo', quantity: 2, price: 12.5, priceType: 'per_stay' });
  assert.equal(r.statusCode, 200);
});

test('rule 21: name and quantity — required, whole, not negative', () => {
  assert.deepEqual(detailFields(refused({ name: ' ', quantity: 1 })), ['name']);
  const negative = refused({ name: 'V', quantity: -1 });
  assert.equal(negative.statusCode, 422);
  assert.equal(negative.body.error, 'VALIDATION_FAILED');
  assert.deepEqual(negative.body.details, [{ field: 'quantity', message: 'Positif ou nul' }]);
  assert.deepEqual(refused({ name: 'V', quantity: 1.5 }).body.details, [{ field: 'quantity', message: 'Nombre entier attendu' }]);
  assert.deepEqual(detailFields(refused({ name: 'V', quantity: '' })), ['quantity']);
});

test('rule 21: prices are numbers ≥ 0 with 2 decimals max, base, per property and hourly rates', () => {
  assert.deepEqual(detailFields(refused({ name: 'V', quantity: 1, price: -1 })), ['price']);
  assert.deepEqual(detailFields(refused({ name: 'V', quantity: 1, price: 1.234 })), ['price']);
  assert.deepEqual(detailFields(refused({ name: 'V', quantity: 1, propertyPricing: { 2: { price: -4, freeMinutes: 0 } } })), ['propertyPricing.2']);
  assert.deepEqual(detailFields(refused({ name: 'V', quantity: 1, hourlyEveningRate: 'x' })), ['hourlyEveningRate']);
  assert.equal(refused({ name: 'V', quantity: 1, propertyPricing: { 2: { price: 0, freeMinutes: 60 } } }).statusCode, 200);
});

test('rule 21: the closing time must come after the opening time of a slotted hourly resource', () => {
  const hourly = { name: 'Bain', quantity: 1, priceType: 'per_hour', isComplex: 1 };
  assert.deepEqual(refused({ ...hourly, openTime: '20:00', closeTime: '08:00' }).body.details, [{ field: 'closeTime', message: 'Après l’ouverture' }]);
  assert.deepEqual(detailFields(refused({ ...hourly, openTime: '10:00', closeTime: '10:00' })), ['closeTime']);
  assert.equal(refused({ ...hourly, openTime: '08:00', closeTime: '22:00' }).statusCode, 200);
  assert.equal(refused({ ...hourly, isComplex: 0, openTime: '20:00', closeTime: '08:00' }).statusCode, 200);
});

test('rule 21: update is validated like create', () => {
  const r = fakeRes();
  controller().update({ params: { id: 1 }, body: { name: '', quantity: 1 } }, r);
  assert.equal(r.statusCode, 422);
});
