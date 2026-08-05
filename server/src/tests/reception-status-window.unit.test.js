// specs/reception-sas-today-only.md §3.2 rule 6 — for the « Accueil » role the status toggles follow
// the SAME day window as the SAS: « Prêt » / « Arrivé » on the arrival date, « Parti » on the
// departure date. Unlike the SAS itself, a COMMITTED SAS does not lock them (fixing a mis-tick is not
// a re-edit). Admin is never limited.
//
// Dates come from the real clock (the controller reads `new Date()`), with a 2-day margin so a run at
// 02:00 — still inside yesterday's 04:00 tail — can't flip a « past » case.

const test = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');

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

function isoDay(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = isoDay(0);
const PAST = isoDay(-2);
const FUTURE = isoDay(2);

function buildController({ captures, row }) {
  const dbMock = { transaction: (fn) => (...a) => fn(...a), prepare: () => ({ get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }) };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getBasic') return () => ({ id: 1 });
    if (k === 'getRow') return () => row;
    if (k === 'updatePaymentField') return (sql, ...args) => { captures.writes.push({ sql, args }); };
    return () => null;
  } });

  const controllerModule = '../controllers/reservationsController';
  return withMocks({
    // utils/sasEditWindow + constants/roles stay real — this test guards the actual wiring.
    '../utils/pricing': { calculateReservationQuote: () => ({}) },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => TODAY },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': reservationsModelMock,
    '../models/settingsModel': { read: () => ({}), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

const RECEPTION_USER = { id: 2, roles: ['reception'] };
const ADMIN_USER = { id: 1, roles: ['admin'] };

function baseRow(over = {}) {
  return {
    id: 1, startDate: TODAY, endDate: TODAY,
    arrivalSasDoneAt: null, departureSasDoneAt: null,
    complementPaid: 0, complementPaidCash: 0, complementPaidDate: null,
    endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0, endOfStayComplementPaidDate: null,
    ...over,
  };
}

function patchPayment({ user, row, body }) {
  const captures = { writes: [] };
  const controller = buildController({ captures, row });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body, user }, res);
  return { res, captures };
}

// ---- refusals ----

test('updatePayment — reception flipping « Prêt » on a past arrival → 403 STATUS_LOCKED/past, no write', () => {
  const { res, captures } = patchPayment({
    user: RECEPTION_USER, row: baseRow({ startDate: PAST, endDate: PAST }), body: { checkInReady: true },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'STATUS_LOCKED', reason: 'past' });
  assert.deepEqual(captures.writes, []);
});

test('updatePayment — reception flipping « Arrivé » on a future arrival → 403 STATUS_LOCKED/future', () => {
  const { res, captures } = patchPayment({
    user: RECEPTION_USER, row: baseRow({ startDate: FUTURE, endDate: FUTURE }), body: { checkInDone: true },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'STATUS_LOCKED', reason: 'future' });
  assert.deepEqual(captures.writes, []);
});

test('updatePayment — reception flipping « Parti » on a past departure → 403 STATUS_LOCKED/past', () => {
  const { res } = patchPayment({
    user: RECEPTION_USER, row: baseRow({ startDate: PAST, endDate: PAST }), body: { checkOutDone: true },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'STATUS_LOCKED', reason: 'past' });
});

test('updatePayment — the arrival window governs « Prêt », the departure one governs « Parti »', () => {
  // Arrived 2 days ago, leaves today: « Parti » is allowed, « Prêt » is not.
  const row = baseRow({ startDate: PAST, endDate: TODAY });
  assert.equal(patchPayment({ user: RECEPTION_USER, row, body: { checkOutDone: true } }).res.statusCode, 200);
  assert.equal(patchPayment({ user: RECEPTION_USER, row, body: { checkInReady: true } }).res.statusCode, 403);
});

// ---- allowed ----

test("updatePayment — reception on today's reservation → 200 for the three status fields", () => {
  for (const body of [{ checkInReady: true }, { checkInDone: true }, { checkOutDone: true }]) {
    const { res } = patchPayment({ user: RECEPTION_USER, row: baseRow(), body });
    assert.equal(res.statusCode, 200);
  }
});

test('updatePayment — a COMMITTED SAS still leaves the toggles editable inside the window (rule 6)', () => {
  const row = baseRow({ arrivalSasDoneAt: `${TODAY} 15:12:00`, departureSasDoneAt: `${TODAY} 10:30:00` });
  assert.equal(patchPayment({ user: RECEPTION_USER, row, body: { checkInDone: false } }).res.statusCode, 200);
  assert.equal(patchPayment({ user: RECEPTION_USER, row, body: { checkOutDone: false } }).res.statusCode, 200);
});

test('updatePayment — admin is never limited by the window', () => {
  const row = baseRow({ startDate: PAST, endDate: PAST });
  assert.equal(patchPayment({ user: ADMIN_USER, row, body: { checkInReady: true } }).res.statusCode, 200);
  assert.equal(patchPayment({ user: ADMIN_USER, row, body: { checkOutDone: true } }).res.statusCode, 200);
});

// ---- the pre-existing financial-field guard still runs first ----

test('updatePayment — a reception payload carrying money is stripped, not 403-ed, inside the window', () => {
  // specs/reception-role-checkin-only.md §3.5 rule 10: financial fields are dropped silently; only the
  // status fields survive — so this payload is a plain in-window status write.
  const { res } = patchPayment({
    user: RECEPTION_USER, row: baseRow(), body: { checkInDone: true, depositPaid: true, complementPaid: true },
  });
  assert.equal(res.statusCode, 200);
});

test('updatePayment — a reception payload with ONLY money touches no window (no status field)', () => {
  const { res } = patchPayment({
    user: RECEPTION_USER, row: baseRow({ startDate: PAST, endDate: PAST }), body: { depositPaid: true },
  });
  // Every field was stripped → nothing to lock, the request is a no-op rather than a 403.
  assert.equal(res.statusCode, 200);
});
