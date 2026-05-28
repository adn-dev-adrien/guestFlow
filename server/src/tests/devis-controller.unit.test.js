const test = require('node:test');
const assert = require('node:assert/strict');

const devisController = require('../controllers/devisController');

function fakeModel(overrides = {}) {
  return {
    list: () => [{ id: 1 }],
    findById: (id) => (Number(id) === 1 ? { id: 1, devisNumber: 'D-1' } : null),
    getHistory: (id) => (Number(id) === 1 ? [] : null),
    updateStatus: () => ({ ok: true, data: { id: 1, status: 'sent' } }),
    create: () => ({ ok: true, status: 201, data: { id: 7 } }),
    update: () => ({ ok: true, data: { id: 1 } }),
    remove: () => ({ ok: true, data: { success: true } }),
    convertToReservation: () => ({ ok: true, data: { success: true, reservationId: 9 } }),
    convertFromReservation: () => ({ ok: true, status: 201, data: { id: 7 } }),
    ...overrides,
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: undefined, ended: false,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { this.ended = true; return this; },
    setHeader() {},
  };
}

test('create: invalid finance input → 400 (model not called)', () => {
  let called = false;
  const c = devisController.buildController(fakeModel({ create: () => { called = true; return { ok: true, status: 201, data: {} }; } }));
  const res = fakeRes();
  c.create({ body: { customPrice: -10, propertyId: 1, clientId: 1, startDate: 'a', endDate: 'b' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('create: valid → 201 with model data', () => {
  const c = devisController.buildController(fakeModel());
  const res = fakeRes();
  c.create({ body: { propertyId: 1, clientId: 1, startDate: 'a', endDate: 'b' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id, 7);
});

test('getOne: missing → 404', () => {
  const c = devisController.buildController(fakeModel());
  const res = fakeRes();
  c.getOne({ params: { id: 999 } }, res);
  assert.equal(res.statusCode, 404);
});

test('history: missing devis → 404', () => {
  const c = devisController.buildController(fakeModel());
  const res = fakeRes();
  c.history({ params: { id: 999 } }, res);
  assert.equal(res.statusCode, 404);
});

test('convertToReservation: already converted → 400 from model', () => {
  const c = devisController.buildController(fakeModel({
    convertToReservation: () => ({ error: 'Ce devis a déjà été converti en réservation', status: 400 }),
  }));
  const res = fakeRes();
  c.convertToReservation({ params: { id: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /déjà été converti/);
});

test('pdf: missing devis → 404 (service not invoked)', async () => {
  const c = devisController.buildController(fakeModel());
  const res = fakeRes();
  await c.pdf({ params: { id: 999 } }, res);
  assert.equal(res.statusCode, 404);
});
