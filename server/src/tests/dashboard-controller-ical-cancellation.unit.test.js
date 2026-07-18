const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');

// HTTP shaping for the iCal cancellation Dashboard endpoints
// (specs/ical-cancellation-approval.md §4.3). The model is faked — only the route ←→
// controller ←→ response shape is under test.

function makeFake({ pending = [], approveResult = { ok: true, outcome: 'approved' }, rejectResult = { ok: true } } = {}) {
  const calls = { listPending: 0, approve: [], reject: [] };
  return {
    calls,
    icalCancellationModel: {
      listPending() { calls.listPending += 1; return pending; },
      approve(id) { calls.approve.push(id); return approveResult; },
      reject(id) { calls.reject.push(id); return rejectResult; },
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

test('GET ical-cancellation: empty list → { alerts: [] }', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.icalCancellation({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { alerts: [] });
});

test('GET ical-cancellation: forwards the model payload as-is', () => {
  const pending = [
    { id: 1, reservationId: 10, clientName: 'Jean Dupont', propertyName: 'Gîte', sourceName: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-13', detectedAt: '2026-06-03 09:00:00', reservationExists: true },
    { id: 2, reservationId: 11, clientName: '#11', propertyName: '', sourceName: 'Booking', startDate: '2026-08-01', endDate: '2026-08-05', detectedAt: '2026-06-03 08:00:00', reservationExists: false },
  ];
  const fakes = makeFake({ pending });
  const c = buildController(fakes);
  const res = fakeRes();
  c.icalCancellation({}, res);
  assert.deepEqual(res.body, { alerts: pending });
});

test('POST approve: forwards the parsed id and returns { ok: true, outcome: "approved" }', () => {
  const fakes = makeFake({ approveResult: { ok: true, outcome: 'approved' } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: '42' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, outcome: 'approved' });
  assert.deepEqual(fakes.calls.approve, [42]);
});

test('POST approve: idempotent shape when reservation already gone', () => {
  const fakes = makeFake({ approveResult: { ok: true, outcome: 'reservation_gone' } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, outcome: 'reservation_gone' });
});

test('POST approve: fires the Google Calendar delete hook with the model-returned reservationId', () => {
  const deleted = [];
  const fakes = makeFake({ approveResult: { ok: true, outcome: 'approved', reservationId: 10 } });
  const c = buildController({
    ...fakes,
    googleCalendarSync: { schedulePush: () => {}, scheduleDelete: (id) => deleted.push(id) },
  });
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: '42' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, outcome: 'approved' });
  assert.deepEqual(deleted, [10]);
});

test('POST approve: invalid id → 400', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INVALID_ID' });
});

test('POST approve: model returns DEJA_TRAITE → 409', () => {
  const fakes = makeFake({ approveResult: { error: 'DEJA_TRAITE', status: 409 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'DEJA_TRAITE' });
});

test('POST approve: model returns INTROUVABLE → 404', () => {
  const fakes = makeFake({ approveResult: { error: 'INTROUVABLE', status: 404 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalCancellation({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'INTROUVABLE' });
});

test('POST reject: forwards id and returns { ok: true }', () => {
  const fakes = makeFake({ rejectResult: { ok: true } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalCancellation({ params: { id: '7' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(fakes.calls.reject, [7]);
});

test('POST reject: model returns DEJA_TRAITE → 409', () => {
  const fakes = makeFake({ rejectResult: { error: 'DEJA_TRAITE', status: 409 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalCancellation({ params: { id: '7' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'DEJA_TRAITE' });
});

test('POST reject: invalid id → 400', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalCancellation({ params: { id: '0' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INVALID_ID' });
});
