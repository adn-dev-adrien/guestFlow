const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// specs/public-api.md §3 rule 1 & 3: the public API is READ-ONLY except POST /booking-requests.
// A GET must never mutate server state. The property-detail read previously went through
// propertiesModel.getByIdWithDetails, which SEEDS default timed options (a write) as a side
// effect. This locks the read path to the side-effect-free getByIdPublicReadOnly so a public
// GET can never write.

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
    json(body) { this.body = body; return this; },
  };
}

function buildCatalog(captures, propertyRow) {
  const propertiesModel = {
    getByIdPublicReadOnly(id) {
      captures.readOnlyCalledWith = id;
      return propertyRow;
    },
    getByIdWithDetails() {
      // The seeding reader — calling it from a public GET would be a write. Fail loudly.
      captures.seedingReaderCalled = true;
      throw new Error('public GET must not call getByIdWithDetails (it writes via ensureDefaultTimedOptionsForProperty)');
    },
    list: () => [],
  };
  const controllerPath = '../controllers/public/publicCatalogController';
  return withMocks({
    '../../database': { prepare: () => ({ get: () => null, all: () => [], run: () => null }) },
    '../../models/propertiesModel': propertiesModel,
    '../../models/optionsModel': { listForProperty: () => [] },
    '../../models/reservationsModel': { getOccupiedReservations: () => [] },
    '../../models/establishmentClosuresModel': { list: () => [], expandClosuresToDates: () => [] },
  }, () => {
    delete require.cache[require.resolve(controllerPath)];
    return require(controllerPath);
  });
}

test('GET /public/v1/properties/:id reads through the side-effect-free reader (no write on a GET)', () => {
  const captures = {};
  const controller = buildCatalog(captures, {
    id: 5, name: 'Gîte', extraGuestPrice: 20, pricingRules: [{ pricePerNight: 90 }, { pricePerNight: 120 }],
  });
  const res = fakeRes();
  controller.getProperty({ params: { id: '5' } }, res);

  assert.equal(captures.readOnlyCalledWith, 5, 'used getByIdPublicReadOnly');
  assert.equal(captures.seedingReaderCalled, undefined, 'never touched the seeding reader');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.id, 5);
  assert.equal(res.body.data.fromPricePerNight, 90, 'teaser from the cheapest nightly rate');
});

test('GET /public/v1/properties/:id returns 404 without writing when the property is unknown', () => {
  const captures = {};
  const controller = buildCatalog(captures, null);
  const res = fakeRes();
  controller.getProperty({ params: { id: '999' } }, res);

  assert.equal(captures.readOnlyCalledWith, 999);
  assert.equal(captures.seedingReaderCalled, undefined);
  assert.equal(res.statusCode, 404);
});
