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
function buildController({ options = [], resources = [] }) {
  return withMocks({
    '../../database': { prepare: () => ({ get: () => ({ 1: 1 }) }) },
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
  assert.deepEqual(res.body.data.map((o) => o.price), [6, 30, 65, 80]);
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
