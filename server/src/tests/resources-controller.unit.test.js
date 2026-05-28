const test = require('node:test');
const assert = require('node:assert/strict');

const resourcesController = require('../controllers/resourcesController');

function fakeModel(overrides = {}) {
  return {
    list: () => [{ id: 1, name: 'R' }],
    findById: (id) => (Number(id) === 1 ? { id: 1, name: 'R' } : null),
    insert: () => 42,
    update: () => {},
    remove: () => {},
    getDeleteImpact: (id) => (Number(id) === 1
      ? { resource: { id: 1, name: 'R' }, reservationsCount: 0, reservations: [], bookingsCount: 0, bookings: [] }
      : null),
    ...overrides,
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

test('create: missing name → 400', () => {
  const c = resourcesController.buildController(fakeModel());
  const res = fakeRes();
  c.create({ body: { name: '', quantity: 1, price: 10 } }, res);
  assert.equal(res.statusCode, 400);
});

test('create: negative quantity → 400', () => {
  const c = resourcesController.buildController(fakeModel());
  const res = fakeRes();
  c.create({ body: { name: 'R', quantity: -1, price: 10 } }, res);
  assert.equal(res.statusCode, 400);
});

test('create: valid → returns id', () => {
  const c = resourcesController.buildController(fakeModel());
  const res = fakeRes();
  c.create({ body: { name: 'R', quantity: 1, price: 10 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 42);
});

test('getOne / update on missing resource → 404', () => {
  const c = resourcesController.buildController(fakeModel());
  const r1 = fakeRes();
  c.getOne({ params: { id: 999 } }, r1);
  assert.equal(r1.statusCode, 404);
  const r2 = fakeRes();
  c.update({ params: { id: 999 }, body: { name: 'R', quantity: 1 } }, r2);
  assert.equal(r2.statusCode, 404);
});

test('delete: resource in use without force → 409 RESOURCE_IN_USE (+counts)', () => {
  const model = fakeModel({
    getDeleteImpact: (id) => ({
      resource: { id: Number(id), name: 'R' },
      reservationsCount: 2, reservations: [{ id: 1 }, { id: 2 }],
      bookingsCount: 3, bookings: [{ id: 9 }],
    }),
  });
  let removed = false;
  model.remove = () => { removed = true; };
  const c = resourcesController.buildController(model);
  const res = fakeRes();
  c.remove({ params: { id: 5 }, query: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESOURCE_IN_USE');
  assert.equal(res.body.reservationsCount, 2);
  assert.equal(res.body.bookingsCount, 3);
  assert.equal(removed, false);
});

test('delete: force=true deletes even when in use', () => {
  const model = fakeModel({
    getDeleteImpact: (id) => ({ resource: { id: Number(id) }, reservationsCount: 2, reservations: [], bookingsCount: 0, bookings: [] }),
  });
  let removedId = null;
  model.remove = (id) => { removedId = id; };
  const c = resourcesController.buildController(model);
  const res = fakeRes();
  c.remove({ params: { id: 5 }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(removedId, 5);
});

test('delete: unused resource deletes without force', () => {
  const model = fakeModel();
  let removedId = null;
  model.remove = (id) => { removedId = id; };
  const c = resourcesController.buildController(model);
  const res = fakeRes();
  c.remove({ params: { id: 1 }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(removedId, 1);
});

test('availability without dates → 400', () => {
  const c = resourcesController.buildController(fakeModel());
  const res = fakeRes();
  c.availability({ query: { propertyId: 1 } }, res);
  assert.equal(res.statusCode, 400);
});
