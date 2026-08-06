// specs/option-categories.md §3 rules 13-15, §4.4 — the grouped shape of the public options payload.
//
// Same harness as public-catalog-sort-by-price.unit.test.js: real projections + real grouping,
// stubbed models, so the assertions are about what the controller actually ships to the widget.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function buildController({ options = [], offeredDefaultIds = [] }) {
  return withMocks({
    '../../database': { prepare: () => ({ get: () => ({ 1: 1 }), all: () => offeredDefaultIds.map((id) => ({ optionId: id })) }) },
    '../../models/optionsModel': { listForProperty: () => options },
    '../../models/resourcesModel': { list: () => [] },
  }, () => {
    const m = '../controllers/public/publicCatalogController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

function listOptions(options, offeredDefaultIds = []) {
  const res = fakeRes();
  buildController({ options, offeredDefaultIds }).listOptions({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.data;
}

test('payload is { ungrouped, groups } with the categories in display order', () => {
  const data = listOptions([
    { id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 },
    { id: 2, title: 'Planche S', priceType: 'per_stay', price: 17, category: 'Restauration' },
    { id: 3, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' },
    { id: 4, title: 'Balade nocturne', priceType: 'per_stay', price: 65, category: 'Animations' },
  ]);
  assert.deepEqual(Object.keys(data).sort(), ['groups', 'ungrouped']);
  assert.deepEqual(data.ungrouped.map((o) => o.title), ['Ménage']);
  assert.deepEqual(data.groups.map((g) => g.category), ['Animations', 'Boissons', 'Restauration']);
});

test('each option carries its category so the widget can render without deriving anything', () => {
  const data = listOptions([{ id: 3, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' }]);
  assert.equal(data.groups[0].options[0].category, 'Boissons');
});

test('price-ascending order is preserved inside a group and in the ungrouped list', () => {
  const data = listOptions([
    { id: 1, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' },
    { id: 2, title: 'Jus de pomme 25cl', priceType: 'per_stay', price: 3, category: 'Boissons' },
    { id: 3, title: 'Mad Max', priceType: 'per_stay', price: 7.5, category: 'Boissons' },
    { id: 4, title: 'Ménage', priceType: 'per_stay', price: 80 },
    { id: 5, title: 'Petit déjeuner', priceType: 'per_person', price: 12 },
  ]);
  assert.deepEqual(data.groups[0].options.map((o) => o.price), [3, 7.5, 40]);
  assert.deepEqual(data.ungrouped.map((o) => o.price), [12, 80]);
});

test('internal-only options are removed BEFORE grouping — an all-internal category yields no group', () => {
  // spec rule 14: a section with nothing visible in it must not render an empty header.
  const data = listOptions([
    { id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 },
    { id: 2, title: 'Tapis de bain', priceType: 'per_stay', price: 0, category: 'Blanchisserie', displayToClient: 0 },
    { id: 3, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' },
  ]);
  assert.deepEqual(data.groups.map((g) => g.category), ['Boissons']);
});

test('a category left with one visible option out of two still renders, minus the hidden one', () => {
  const data = listOptions([
    { id: 1, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' },
    { id: 2, title: 'Boisson interne', priceType: 'per_stay', price: 5, category: 'Boissons', displayToClient: 0 },
  ]);
  assert.equal(data.groups.length, 1);
  assert.deepEqual(data.groups[0].options.map((o) => o.title), ['Champagne']);
});

test('offered-by-default options are excluded from their group too', () => {
  // specs/property-default-option-applicability.md rule 4 still applies inside a category.
  const data = listOptions([
    { id: 1, title: 'Champagne', priceType: 'per_stay', price: 40, category: 'Boissons' },
    { id: 8, title: 'Jus offert', priceType: 'per_stay', price: 5, category: 'Boissons' },
  ], [8]);
  assert.deepEqual(data.groups[0].options.map((o) => o.title), ['Champagne']);
});

test('a catalogue with no category at all yields an empty groups array', () => {
  const data = listOptions([{ id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 }]);
  assert.deepEqual(data.groups, []);
  assert.equal(data.ungrouped.length, 1);
});

test('a whitespace-only category is treated as ungrouped', () => {
  const data = listOptions([{ id: 1, title: 'Ménage', priceType: 'per_stay', price: 80, category: '   ' }]);
  assert.deepEqual(data.groups, []);
  assert.deepEqual(data.ungrouped.map((o) => o.title), ['Ménage']);
});

test('alwaysVisible reaches the widget so it can pin the line without a selection', () => {
  // specs/option-categories.md §3 rule 9bis — « Petit déjeuner » under « Restauration ».
  const data = listOptions([
    { id: 1, title: 'Petit déjeuner', priceType: 'per_person', price: 12, category: 'Restauration', alwaysVisible: 1 },
    { id: 2, title: 'Planche S', priceType: 'per_stay', price: 17, category: 'Restauration' },
  ]);
  const byTitle = Object.fromEntries(data.groups[0].options.map((o) => [o.title, o]));
  assert.equal(byTitle['Petit déjeuner'].alwaysVisible, true);
  assert.equal(byTitle['Planche S'].alwaysVisible, false);
});
