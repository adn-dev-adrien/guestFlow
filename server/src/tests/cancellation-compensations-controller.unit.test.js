// HTTP shaping + authoritative validation of the compensation endpoints
// (specs/cancellation-compensation.md §3.5, §4.3). The model is faked: only the boundary is
// under test — what the server accepts, what it refuses, and with which code.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createController } = require('../controllers/cancellationCompensationsController');

const DRAFT = {
  propertyName: 'Le Lodge',
  platform: 'Airbnb',
  clientFirstName: 'Claire',
  clientLastName: 'Notin',
  startDate: '2026-09-04',
  endDate: '2026-09-07',
  expectedAmount: 84,
  expectedDate: '2026-08-26',
};

function fakeModel(overrides = {}) {
  const calls = { create: [], update: [], receive: [], reopen: [], remove: [] };
  return {
    calls,
    model: {
      listPending: () => [{ id: 1, expectedAmount: 84, status: 'pending' }, { id: 2, expectedAmount: 16.5, status: 'pending' }],
      listReceivedByMonth: (bounds) => { calls.bounds = bounds; return [{ id: 3, receivedAmount: 79.2, status: 'received' }]; },
      create: (payload) => { calls.create.push(payload); return { id: 9, ...payload }; },
      update: (id, payload) => { calls.update.push([id, payload]); return { ok: true, data: { id, ...payload } }; },
      receive: (id, payload) => { calls.receive.push([id, payload]); return { ok: true, data: { id, status: 'received' } }; },
      reopen: (id) => { calls.reopen.push(id); return { ok: true, data: { id, status: 'pending' } }; },
      remove: (id) => { calls.remove.push(id); return { ok: true }; },
      ...overrides,
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const build = (overrides) => {
  const { model, calls } = fakeModel(overrides);
  return { controller: createController(model, { today: () => '2026-08-19' }), calls };
};

test('GET: pending list + received-in-month + both totals', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.list({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pending.length, 2);
  assert.equal(res.body.received.length, 1);
  assert.equal(res.body.totals.pendingExpected, 100.5);
  assert.equal(res.body.totals.receivedInMonth, 79.2);
  // Half-open month bounds, computed server-side.
  assert.deepEqual(calls.bounds, { from: '2026-08-01', nextMonth: '2026-09-01' });
});

test('GET: December rolls the upper bound into the next year', () => {
  const { controller, calls } = build();
  controller.list({ query: { month: '12', year: '2026' } }, fakeRes());
  assert.deepEqual(calls.bounds, { from: '2026-12-01', nextMonth: '2027-01-01' });
});

test('GET: an invalid month is refused', () => {
  const { controller } = build();
  const res = fakeRes();
  controller.list({ query: { month: '13', year: '2026' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_MONTH_OR_YEAR');
});

test('POST: creates from a validated draft and answers 201', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.create({ body: { ...DRAFT, expectedAmount: '84.567', notes: '  hors délai ' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].expectedAmount, 84.57, 'rounded at the boundary');
  assert.equal(calls.create[0].notes, 'hors délai', 'trimmed at the boundary');
});

test('POST: a platform is required — the payer is the whole point of the record', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.create({ body: { ...DRAFT, platform: '  ' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PLATFORM_REQUIRED');
  assert.deepEqual(calls.create, []);
});

test('POST: refuses a negative, absurd or malformed amount', () => {
  for (const expectedAmount of [-1, 100001, 'abc']) {
    const { controller, calls } = build();
    const res = fakeRes();
    controller.create({ body: { ...DRAFT, expectedAmount } }, res);
    assert.equal(res.statusCode, 400, String(expectedAmount));
    assert.equal(res.body.error, 'INVALID_AMOUNT');
    assert.deepEqual(calls.create, []);
  }
});

test('POST: a 0 € expected amount is legitimate (the platform has not announced it yet)', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.create({ body: { ...DRAFT, expectedAmount: 0 } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls.create[0].expectedAmount, 0);
});

test('POST: refuses a malformed date', () => {
  const { controller } = build();
  const res = fakeRes();
  controller.create({ body: { ...DRAFT, expectedDate: '26/08/2026' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_DATE');
  assert.equal(res.body.field, 'expectedDate');
});

test('PUT: forwards to the model; a booked row answers 409', () => {
  const { controller, calls } = build();
  controller.update({ params: { id: '5' }, body: DRAFT }, fakeRes());
  assert.equal(calls.update[0][0], 5);

  const locked = build({ update: () => ({ error: 'COMPENSATION_LOCKED', status: 409 }) });
  const res = fakeRes();
  locked.controller.update({ params: { id: '5' }, body: DRAFT }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'COMPENSATION_LOCKED');
});

test('receive: banks the amount at its date', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.receive({ params: { id: '5' }, body: { receivedAmount: '79.2', receivedDate: '2026-08-18' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.receive, [[5, { receivedAmount: 79.2, receivedDate: '2026-08-18' }]]);
});

test('receive: money that has not arrived yet is refused', () => {
  const { controller, calls } = build();
  const res = fakeRes();
  controller.receive({ params: { id: '5' }, body: { receivedAmount: 79.2, receivedDate: '2026-08-20' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'RECEIVED_DATE_IN_FUTURE');
  assert.deepEqual(calls.receive, []);
});

test('receive: a mistyped year (2016 for 2026) is refused', () => {
  const { controller } = build();
  const res = fakeRes();
  controller.receive({ params: { id: '5' }, body: { receivedAmount: 79.2, receivedDate: '2016-08-18' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'RECEIVED_DATE_TOO_OLD');
});

test('receive: 0 € is not a payment', () => {
  const { controller } = build();
  const res = fakeRes();
  controller.receive({ params: { id: '5' }, body: { receivedAmount: 0, receivedDate: '2026-08-18' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_AMOUNT');
});

test('reopen + delete: forwarded, and the model 404s bubble up', () => {
  const { controller, calls } = build();
  controller.reopen({ params: { id: '5' } }, fakeRes());
  controller.remove({ params: { id: '6' } }, fakeRes());
  assert.deepEqual(calls.reopen, [5]);
  assert.deepEqual(calls.remove, [6]);

  const missing = build({ remove: () => ({ error: 'INTROUVABLE', status: 404 }) });
  const res = fakeRes();
  missing.controller.remove({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 404);
});

test('every id-bearing route refuses a non-numeric id', () => {
  const { controller } = build();
  for (const handler of ['update', 'receive', 'reopen', 'remove']) {
    const res = fakeRes();
    controller[handler]({ params: { id: 'abc' }, body: DRAFT }, res);
    assert.equal(res.statusCode, 400, handler);
    assert.equal(res.body.error, 'INVALID_ID');
  }
});
