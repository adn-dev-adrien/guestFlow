const test = require('node:test');
const assert = require('node:assert/strict');

const clientsController = require('../controllers/clientsController');

// In-memory fake model capturing the controller's orchestration.
function fakeModel(overrides = {}) {
  const store = new Map();
  let nextId = 1;
  const base = {
    list: () => [...store.values()],
    findById: (id) => store.get(Number(id)),
    insert: (payload) => {
      const c = { id: nextId++, ...payload };
      store.set(c.id, c);
      return c;
    },
    update: (id, payload) => {
      const c = { ...store.get(Number(id)), ...payload, id: Number(id) };
      store.set(Number(id), c);
      return c;
    },
    remove: (id) => { store.delete(Number(id)); },
    getDeleteImpact: (id) => {
      const client = store.get(Number(id));
      if (!client) return null;
      return { client, reservationsCount: 0, reservations: [], devisCount: 0, devis: [] };
    },
    cleanupOrphans: () => ({ deletedCount: 0, keptWithDevisCount: 0 }),
  };
  return { ...base, ...overrides, _store: store };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

test('create: invalid email → 400', () => {
  const c = clientsController.create(fakeModel());
  const res = fakeRes();
  c.create({ body: { lastName: 'a', firstName: 'b', email: 'not-an-email' } }, res);
  assert.equal(res.statusCode, 400);
});

test('create: valid payload → returns created client', () => {
  const c = clientsController.create(fakeModel());
  const res = fakeRes();
  c.create({ body: { lastName: 'a', firstName: 'b', phone: '0612345678', email: 'a@b.fr' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.phone, '0612345678');
});

test('getOne / update on missing client → 404', () => {
  const c = clientsController.create(fakeModel());
  const r1 = fakeRes();
  c.getOne({ params: { id: 999 } }, r1);
  assert.equal(r1.statusCode, 404);
  const r2 = fakeRes();
  c.update({ params: { id: 999 }, body: { lastName: 'a', firstName: 'b' } }, r2);
  assert.equal(r2.statusCode, 404);
});

test('delete: client with reservations or devis and no force → 409 CLIENT_IN_USE (+impact)', () => {
  const model = fakeModel({
    getDeleteImpact: (id) => ({
      client: { id: Number(id), firstName: 'a', lastName: 'b' },
      reservationsCount: 2, reservations: [{ id: 1 }, { id: 2 }],
      devisCount: 1, devis: [{ id: 9 }],
    }),
  });
  let removed = false;
  model.remove = () => { removed = true; };
  const c = clientsController.create(model);
  const res = fakeRes();
  c.remove({ params: { id: 5 }, query: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLIENT_IN_USE');
  assert.equal(res.body.reservationsCount, 2);
  assert.equal(res.body.devisCount, 1);
  assert.equal(removed, false);
});

test('delete: with force=true deletes even when linked', () => {
  const model = fakeModel({
    getDeleteImpact: (id) => ({
      client: { id: Number(id) }, reservationsCount: 2, reservations: [], devisCount: 1, devis: [],
    }),
  });
  let removedId = null;
  model.remove = (id) => { removedId = id; };
  const c = clientsController.create(model);
  const res = fakeRes();
  c.remove({ params: { id: 5 }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(removedId, 5);
});

test('delete: unlinked client deletes without force', () => {
  const model = fakeModel();
  const created = model.insert({ lastName: 'a', firstName: 'b' });
  const c = clientsController.create(model);
  const res = fakeRes();
  c.remove({ params: { id: created.id }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(model.findById(created.id), undefined);
});

test('delete: missing client → 404', () => {
  const c = clientsController.create(fakeModel());
  const res = fakeRes();
  c.remove({ params: { id: 999 }, query: {} }, res);
  assert.equal(res.statusCode, 404);
});
