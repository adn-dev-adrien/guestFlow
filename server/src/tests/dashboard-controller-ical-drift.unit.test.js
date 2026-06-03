const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');

// HTTP shaping for the iCal date-drift Dashboard endpoints (specs/ical-sync-override-locked-dates.md §4.3).
// The drift model is faked — we are only validating route → controller → response shape.

function makeFake({ pending = [], approveResult = { ok: true }, rejectResult = { ok: true } } = {}) {
  const calls = { listPending: 0, approve: [], reject: [] };
  return {
    calls,
    icalDateDriftModel: {
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

test('GET ical-date-drift: empty list → { alerts: [] }', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.icalDateDrift({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { alerts: [] });
});

test('GET ical-date-drift: forwards the model payload as-is', () => {
  const pending = [
    { id: 1, reservationId: 10, clientName: 'Jean Dupont', propertyName: 'Gîte', previousStartDate: '2026-07-10', previousEndDate: '2026-07-13', newStartDate: '2026-07-15', newEndDate: '2026-07-18', detectedAt: '2026-06-03 09:00:00', reservationExists: true },
    { id: 2, reservationId: 11, clientName: '#11',          propertyName: '',     previousStartDate: '2026-08-01', previousEndDate: '2026-08-05', newStartDate: '2026-08-03', newEndDate: '2026-08-07', detectedAt: '2026-06-03 08:00:00', reservationExists: false },
  ];
  const fakes = makeFake({ pending });
  const c = buildController(fakes);
  const res = fakeRes();
  c.icalDateDrift({}, res);
  assert.deepEqual(res.body, { alerts: pending });
});

test('POST approve: forwards the parsed id and returns { ok: true }', () => {
  const fakes = makeFake({ approveResult: { ok: true } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalDateDrift({ params: { id: '42' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(fakes.calls.approve, [42]);
});

test('POST approve: invalid id → 400', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalDateDrift({ params: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INVALID_ID' });
  assert.deepEqual(fakes.calls.approve, []);
});

test('POST approve: model returns DEJA_TRAITE → 409', () => {
  const fakes = makeFake({ approveResult: { error: 'DEJA_TRAITE', status: 409 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalDateDrift({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'DEJA_TRAITE' });
});

test('POST approve: model returns RESERVATION_SUPPRIMEE → 410', () => {
  const fakes = makeFake({ approveResult: { error: 'RESERVATION_SUPPRIMEE', status: 410 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalDateDrift({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, { error: 'RESERVATION_SUPPRIMEE' });
});

test('POST approve: model returns INTROUVABLE → 404', () => {
  const fakes = makeFake({ approveResult: { error: 'INTROUVABLE', status: 404 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.approveIcalDateDrift({ params: { id: '5' } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'INTROUVABLE' });
});

test('POST reject: forwards id and returns { ok: true }', () => {
  const fakes = makeFake({ rejectResult: { ok: true } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalDateDrift({ params: { id: '7' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(fakes.calls.reject, [7]);
});

test('POST reject: model returns DEJA_TRAITE → 409', () => {
  const fakes = makeFake({ rejectResult: { error: 'DEJA_TRAITE', status: 409 } });
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalDateDrift({ params: { id: '7' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'DEJA_TRAITE' });
});

test('POST reject: invalid id → 400', () => {
  const fakes = makeFake();
  const c = buildController(fakes);
  const res = fakeRes();
  c.rejectIcalDateDrift({ params: { id: '-3' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INVALID_ID' });
});
