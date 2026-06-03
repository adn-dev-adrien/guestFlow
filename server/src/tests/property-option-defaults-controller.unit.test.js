const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/propertyOptionDefaultsController');

// Fake model — captures calls and returns canned values so the controller's HTTP shaping is
// the only thing under test here. Validation rules (400 / 404 / 204 / payload shape) are
// pinned independently from the SQL.

function makeFakeModel({
  set = ({ propertyId, optionId, offered }) => ({ propertyId, optionId, offered }),
  unsetReturns = 1,
  listForProperty = () => [],
  listForOption = () => [],
} = {}) {
  const calls = [];
  return {
    calls,
    set(propertyId, optionId, offered) {
      calls.push({ fn: 'set', propertyId, optionId, offered });
      return set({ propertyId, optionId, offered });
    },
    unset(propertyId, optionId) {
      calls.push({ fn: 'unset', propertyId, optionId });
      return unsetReturns;
    },
    listForProperty(propertyId) {
      calls.push({ fn: 'listForProperty', propertyId });
      return listForProperty(propertyId);
    },
    listForOption(optionId) {
      calls.push({ fn: 'listForOption', optionId });
      return listForOption(optionId);
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null, ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

// --- GET /api/properties/:id/option-defaults ---

test('listForProperty: returns the model output as JSON', () => {
  const model = makeFakeModel({
    listForProperty: () => [{ optionId: 20, offered: true }, { optionId: 21, offered: false }],
  });
  const c = buildController({ model });
  const res = fakeRes();
  c.listForProperty({ params: { id: '10' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [{ optionId: 20, offered: true }, { optionId: 21, offered: false }]);
  assert.deepEqual(model.calls[0], { fn: 'listForProperty', propertyId: 10 });
});

test('listForProperty: 400 on a non-numeric / non-positive id', () => {
  const model = makeFakeModel();
  const c = buildController({ model });
  const res1 = fakeRes();
  c.listForProperty({ params: { id: 'abc' } }, res1);
  assert.equal(res1.statusCode, 400);
  const res2 = fakeRes();
  c.listForProperty({ params: { id: '0' } }, res2);
  assert.equal(res2.statusCode, 400);
  const res3 = fakeRes();
  c.listForProperty({ params: { id: '-3' } }, res3);
  assert.equal(res3.statusCode, 400);
});

// --- PUT /api/properties/:id/option-defaults/:optionId ---

test('setForProperty: upserts via the model and returns the row', () => {
  const model = makeFakeModel();
  const c = buildController({ model });
  const res = fakeRes();
  c.setForProperty(
    { params: { id: '10', optionId: '20' }, body: { offered: true } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { propertyId: 10, optionId: 20, offered: true });
  assert.deepEqual(model.calls[0], { fn: 'set', propertyId: 10, optionId: 20, offered: true });
});

test('setForProperty: empty / missing body defaults offered to false', () => {
  const model = makeFakeModel();
  const c = buildController({ model });
  c.setForProperty({ params: { id: '10', optionId: '20' }, body: {} }, fakeRes());
  assert.equal(model.calls[0].offered, false);
  c.setForProperty({ params: { id: '10', optionId: '20' } }, fakeRes());
  assert.equal(model.calls[1].offered, false);
});

test('setForProperty: 404 when the model throws on a foreign-key violation', () => {
  // Models the "property / option doesn't exist" race — surface a 404, never a 500.
  const model = makeFakeModel({
    set() { throw new Error('FOREIGN KEY constraint failed'); },
  });
  const c = buildController({ model });
  const res = fakeRes();
  c.setForProperty({ params: { id: '999', optionId: '20' }, body: { offered: true } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'NOT_FOUND');
});

test('setForProperty: 400 on invalid params', () => {
  const model = makeFakeModel();
  const c = buildController({ model });
  const res = fakeRes();
  c.setForProperty({ params: { id: '10', optionId: 'bad' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(model.calls.length, 0, 'invalid id never reaches the model');
});

// --- DELETE /api/properties/:id/option-defaults/:optionId ---

test('unsetForProperty: 204 even when the row did not exist (idempotent)', () => {
  const model = makeFakeModel({ unsetReturns: 0 });
  const c = buildController({ model });
  const res = fakeRes();
  c.unsetForProperty({ params: { id: '10', optionId: '20' } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});

// --- GET /api/options/:id/property-defaults (read-only mirror) ---

test('listForOption: returns the model output (with propertyName joined)', () => {
  const model = makeFakeModel({
    listForOption: () => [{ propertyId: 10, propertyName: 'Gite', offered: true }],
  });
  const c = buildController({ model });
  const res = fakeRes();
  c.listForOption({ params: { id: '20' } }, res);
  assert.deepEqual(res.body, [{ propertyId: 10, propertyName: 'Gite', offered: true }]);
});

test('listForOption: 400 on a non-numeric id', () => {
  const c = buildController({ model: makeFakeModel() });
  const res = fakeRes();
  c.listForOption({ params: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 400);
});
