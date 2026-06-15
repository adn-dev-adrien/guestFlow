const test = require('node:test');
const assert = require('node:assert/strict');

// Regression guard for the « Caisse interne » button doing nothing (2026-06-15): the controller's
// updatePayment used resolveComplementPayment but the import was missing, so any PATCH carrying
// complementPaidCash / endOfStayComplementPaidCash threw `ReferenceError: resolveComplementPayment
// is not defined` → HTTP 500 → the client never toggled the button. These tests call updatePayment
// directly and assert it returns 200 + persists paid+cash. Crucially, the real utils/complementPayment
// is NOT mocked here, so the test fails again the moment the import is dropped.

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

// `prev` = the reservation's stored complement state before the PATCH (drives resolveComplementPayment).
function buildController({ captures, prev = {} }) {
  const dbMock = { transaction: (fn) => (...a) => fn(...a), prepare: () => ({ get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }) };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getBasic') return () => ({ id: 1 });                 // exists → no 404
    if (k === 'getRow') return () => ({ complementPaid: 0, complementPaidCash: 0, complementPaidDate: null,
      endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0, endOfStayComplementPaidDate: null, ...prev });
    if (k === 'updatePaymentField') return (sql, ...args) => { captures.calls.push({ sql, args }); };
    return () => null;
  } });

  const controllerModule = '../controllers/reservationsController';
  return withMocks({
    // utils/complementPayment is deliberately NOT mocked → the real resolveComplementPayment is
    // required, so this test exercises (and guards) the controller's import wiring.
    '../utils/pricing': { calculateReservationQuote: () => ({}) },
    '../utils/financeValidation': require('../utils/financeValidation'),
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-06-15' },
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

test('updatePayment — complementPaidCash ON returns 200 (not 500) and persists paid+cash', () => {
  const captures = { calls: [] };
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body: { complementPaidCash: true } }, res);

  assert.equal(res.statusCode, 200, 'no ReferenceError 500 — resolveComplementPayment is imported');
  const call = captures.calls.find((c) => /complementPaidCash/.test(c.sql) && !/endOfStay/.test(c.sql));
  assert.ok(call, 'the arrival-complement update ran');
  // updatePaymentField(sql, paid, date, cash, id)
  assert.equal(call.args[0], 1, 'paid = 1 (« caisse interne » implies paid)');
  assert.equal(call.args[2], 1, 'cash = 1');
});

test('updatePayment — endOfStayComplementPaidCash ON returns 200 and persists paid+cash', () => {
  const captures = { calls: [] };
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body: { endOfStayComplementPaidCash: true } }, res);

  assert.equal(res.statusCode, 200);
  const call = captures.calls.find((c) => /endOfStayComplementPaidCash/.test(c.sql));
  assert.ok(call, 'the end-of-stay-complement update ran');
  assert.equal(call.args[0], 1, 'paid = 1');
  assert.equal(call.args[2], 1, 'cash = 1');
});

test('updatePayment — toggling caisse interne OFF on a paid complement keeps it paid (compta), cash=0', () => {
  const captures = { calls: [] };
  const controller = buildController({ captures, prev: { complementPaid: 1, complementPaidCash: 1, complementPaidDate: '2026-06-01' } });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body: { complementPaidCash: false } }, res);

  assert.equal(res.statusCode, 200);
  const call = captures.calls.find((c) => /complementPaidCash/.test(c.sql) && !/endOfStay/.test(c.sql));
  assert.ok(call);
  assert.equal(call.args[0], 1, 'stays paid (compta) after un-flagging cash');
  assert.equal(call.args[2], 0, 'cash cleared');
});
