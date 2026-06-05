const test = require('node:test');
const assert = require('node:assert/strict');

// specs/bed-config-in-linen-card.md §3 rule 7 + §7.1.
// reservationsController.create AND update coerce singleBeds/doubleBeds/babyBeds to 0 when
// the final reservation_options list (after the property-defaults auto-merge on create;
// as-submitted on update) contains no option with countsAsBedLinen = 1.
//
// Same mock skeleton as `reservations-controller-property-defaults.unit.test.js`: we don't
// spin up the full DB stack, we stub every model + util the controller pulls in, then drive
// `create` / `update` with a synthetic req.body and inspect what `model.insertReservation` /
// `model.updateReservation` actually received.

const Module = require('module');

function withMocks(modules, fn) {
  const origResolve = Module._resolveFilename;
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally {
    Module._resolveFilename = origResolve;
    Module.prototype.require = origRequire;
  }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// `bedLinenFlaggedIds` = the set of option ids the test treats as `countsAsBedLinen = 1`.
// The db mock's `prepare(...).get(...ids)` returns truthy when any of the ids passed are
// in the set — that's exactly what `hasBedLinenOption` looks for.
function buildController({ defaults = [], bedLinenFlaggedIds = new Set(), captures }) {
  const propertyOptionDefaultsModel = {
    listForProperty: () => defaults,
  };
  const pricingMock = {
    calculateReservationQuote() {
      return {
        totalPrice: 0, finalPrice: 0, depositAmount: 0, balanceAmount: 0,
        optionLines: [], resourceLines: [], nightlyBreakdown: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      };
    },
  };
  const dbMock = {
    prepare() {
      return {
        // The only `get` call from the controller's `hasBedLinenOption` helper passes the
        // option ids as positional args. Return a truthy row iff any arg is bed-linen-flagged.
        get(...args) {
          for (const v of args) {
            if (bedLinenFlaggedIds.has(Number(v))) return { 1: 1 };
          }
          return undefined;
        },
        run() { return { changes: 0 }; },
        all() { return []; },
      };
    },
  };

  const controllerModule = '../controllers/reservationsController';

  return withMocks({
    '../utils/pricing': pricingMock,
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-06-04' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, { get: (_, k) => {
      if (k === 'getPropertyIdOf') return () => null;
      if (k === 'getPropertyCapacity') return () => ({ maxAdults: 99, maxChildren: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (k === 'validateAvailability') return () => null;
      if (k === 'insertReservation') return (body) => { captures.inserted = { singleBeds: body.singleBeds, doubleBeds: body.doubleBeds, babyBeds: body.babyBeds }; return 1; };
      if (k === 'updateReservation') return (id, body) => { captures.updated = { id, singleBeds: body.singleBeds, doubleBeds: body.doubleBeds, babyBeds: body.babyBeds }; };
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getForUpdate') return () => ({ propertyId: 1 });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      if (k === 'replaceOptions') return () => null;
      if (k === 'replaceCustomOptions') return () => null;
      if (k === 'insertOptions') return () => null;
      if (k === 'insertCustomOptions') return () => null;
      if (k === 'replaceResources') return () => null;
      if (k === 'insertResourceLines') return () => null;
      if (k === 'insertNights') return () => null;
      if (k === 'replaceNights') return () => null;
      if (k === 'deleteCustomOptions') return () => null;
      if (k === 'deleteResources') return () => null;
      if (k === 'addHistoryEntry') return () => null;
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': propertyOptionDefaultsModel,
    '../database': dbMock,
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

function basicBody({ singleBeds, doubleBeds, babyBeds, options = [] }) {
  return {
    propertyId: 1, clientId: 1,
    startDate: '2099-09-10', endDate: '2099-09-12',
    adults: 2, children: 0, teens: 0, babies: 0,
    checkInTime: '15:00', checkOutTime: '10:00',
    singleBeds, doubleBeds, babyBeds,
    options,
  };
}

test('create: bed-linen option in payload + counts > 0 → counts persisted intact', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  // babyBeds: 0 to keep `checkBabyBeds` happy (no babies/children in the fixture). The test
  // is about the bed-linen coercion, not about the baby-bed availability check.
  const req = { body: basicBody({ singleBeds: 2, doubleBeds: 3, babyBeds: 0, options: [{ optionId: 1, quantity: 1 }] }) };
  controller.create(req, fakeRes());
  assert.deepEqual(captures.inserted, { singleBeds: 2, doubleBeds: 3, babyBeds: 0 });
});

test('create: NO bed-linen option (and no property default) + counts > 0 → counts coerced to 0', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  const req = { body: basicBody({ singleBeds: 4, doubleBeds: 2, babyBeds: 1, options: [{ optionId: 99, quantity: 1 }] }) };
  controller.create(req, fakeRes());
  assert.deepEqual(captures.inserted, { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('create: property declares bed-linen as default → auto-merge re-adds the option, counts persisted', () => {
  const captures = {};
  const controller = buildController({
    defaults: [{ optionId: 1, offered: false }], // property default
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  // Caller submits NOTHING — auto-merge fills in optionId=1 from the property default.
  const req = { body: basicBody({ singleBeds: 3, doubleBeds: 1, babyBeds: 0, options: [] }) };
  controller.create(req, fakeRes());
  assert.deepEqual(captures.inserted, { singleBeds: 3, doubleBeds: 1, babyBeds: 0 });
});

test('update: bed-linen option removed from payload + counts > 0 → counts coerced to 0', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  // No bed-linen option in the payload — coercion fires. (`update` does NOT auto-merge
  // property defaults, so the operator's choice to drop the option sticks.)
  const req = {
    params: { id: '42' },
    body: basicBody({ singleBeds: 5, doubleBeds: 2, babyBeds: 1, options: [{ optionId: 99, quantity: 1 }] }),
  };
  controller.update(req, fakeRes());
  assert.deepEqual(captures.updated, { id: 42, singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('update: bed-linen option kept ON + counts > 0 → counts persisted intact', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  const req = {
    params: { id: '43' },
    body: basicBody({ singleBeds: 2, doubleBeds: 1, babyBeds: 0, options: [{ optionId: 1, quantity: 1 }] }),
  };
  controller.update(req, fakeRes());
  assert.deepEqual(captures.updated, { id: 43, singleBeds: 2, doubleBeds: 1, babyBeds: 0 });
});
