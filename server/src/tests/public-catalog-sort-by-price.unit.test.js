const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

/**
 * Public catalog ordering (specs/public-api.md): options and resources are returned CHEAPEST FIRST
 * so a public consumer (the WordPress booking widget) renders them sorted by price without doing any
 * client-side ordering. Real projections; the models and the existence check are stubbed.
 */

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

// Existence check passes; models return DELIBERATELY UNSORTED rows so the test proves the controller
// (not the model) imposes the price order.
function buildController({ options = [], resources = [], offeredDefaultIds = [] }) {
  return withMocks({
    // `get` → property existence check; `all` → offered-default option ids for the property.
    '../../database': { prepare: () => ({ get: () => ({ 1: 1 }), all: () => offeredDefaultIds.map((id) => ({ optionId: id })) }) },
    '../../models/optionsModel': { listForProperty: () => options },
    '../../models/resourcesModel': { list: () => resources },
  }, () => {
    const m = '../controllers/public/publicCatalogController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

test('listOptions returns options sorted by price ascending', () => {
  const controller = buildController({ options: [
    { id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 },
    { id: 2, title: 'Chasse aux œufs', priceType: 'per_person', price: 6 },
    { id: 3, title: 'Balade nocturne', priceType: 'per_stay', price: 65 },
    { id: 4, title: 'Visite animaux', priceType: 'per_participant_progressive', price: 30 },
  ] });
  const res = fakeRes();
  controller.listOptions({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  // Uncategorised options land in `ungrouped` (specs/option-categories.md §4.4) — price order intact.
  assert.deepEqual(res.body.data.ungrouped.map((o) => o.price), [6, 30, 65, 80]);
  assert.deepEqual(res.body.data.groups, []);
});

test('listOptions excludes options that are OFFERED defaults for the property (included, not selectable)', () => {
  // specs/property-default-option-applicability.md rule 4: an offered default is part of the price,
  // so the public booking form must not offer it as a choice.
  const controller = buildController({
    options: [
      { id: 1, title: 'Ménage', priceType: 'per_stay', price: 80 },
      { id: 8, title: 'Linge de lits', priceType: 'per_person', price: 7 },
    ],
    offeredDefaultIds: [8],
  });
  const res = fakeRes();
  controller.listOptions({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ungrouped.length, 1);
  assert.deepEqual(res.body.data.ungrouped.map((o) => o.price), [80]); // the offered linen (7) is gone
});

test('listResources returns resources sorted by price ascending', () => {
  const controller = buildController({ resources: [
    { id: 1, name: 'Bain nordique', note: '', priceType: 'per_hour', price: 55 },
    { id: 2, name: 'Lit bébé', note: '', priceType: 'per_stay', price: 0 },
    { id: 3, name: 'Vélo', note: '', priceType: 'per_night', price: 12 },
  ] });
  const res = fakeRes();
  controller.listResources({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.map((r) => r.price), [0, 12, 55]);
});
