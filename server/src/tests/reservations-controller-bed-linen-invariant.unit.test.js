const test = require('node:test');
const assert = require('node:assert/strict');

// specs/bed-config-in-linen-card.md §3 rule 7 + §7.1 (+ §10 follow-up 2026-06-08).
// reservationsController.create AND update coerce single/double bed counts to 0 when the final
// reservation_options list (after the property-defaults auto-merge on create; as-submitted on
// update) contains no option with countsAsBedLinen = 1. BABY BEDS are EXEMPT — they are kept
// regardless of the bed-linen option (they track an independent resource needed when babies > 0).
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
    prepare(sql) {
      const isSingleIdLookup = /SELECT\s+countsAsBedLinen\s+FROM\s+options\s+WHERE\s+id\s*=\s*\?/i.test(String(sql || ''));
      return {
        // `hasBedLinenOption`'s IN-query — returns `{1:1}` truthy iff any arg matches. (The
        // per-id `SELECT countsAsBedLinen` branch is retained for safety but is no longer
        // exercised: the update re-merge that used it was removed — see
        // specs/reservation-option-immutability.md.)
        get(...args) {
          if (isSingleIdLookup) {
            return { countsAsBedLinen: bedLinenFlaggedIds.has(Number(args[0])) ? 1 : 0 };
          }
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

function basicBody({ singleBeds, doubleBeds, babyBeds, babies = 0, options = [] }) {
  return {
    propertyId: 1, clientId: 1,
    startDate: '2099-09-10', endDate: '2099-09-12',
    adults: 2, children: 0, teens: 0, babies,
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

test('create: NO bed-linen option → single/double coerced to 0, but baby beds kept', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  // babies:1 so the (valid) baby bed survives the no-linen invariant — §10 follow-up: baby beds
  // are independent of the bed-linen option. Single/double still zero (no linen contract).
  const req = { body: basicBody({ singleBeds: 4, doubleBeds: 2, babyBeds: 1, babies: 1, options: [{ optionId: 99, quantity: 1 }] }) };
  controller.create(req, fakeRes());
  assert.deepEqual(captures.inserted, { singleBeds: 0, doubleBeds: 0, babyBeds: 1 });
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

test('update: bed-linen option removed → single/double coerced to 0, but baby beds kept', () => {
  const captures = {};
  const controller = buildController({
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  // No bed-linen option in the payload — single/double coercion fires. (`update` does NOT
  // auto-merge property defaults, so dropping the option sticks.) Baby beds (babies:1) are kept.
  const req = {
    params: { id: '42' },
    body: basicBody({ singleBeds: 5, doubleBeds: 2, babyBeds: 1, babies: 1, options: [{ optionId: 99, quantity: 1 }] }),
  };
  controller.update(req, fakeRes());
  assert.deepEqual(captures.updated, { id: 42, singleBeds: 0, doubleBeds: 0, babyBeds: 1 });
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

test('update: bed-linen property default is NOT re-merged → existing reservation is frozen (specs/reservation-option-immutability.md)', () => {
  // The reservation belongs to a property where bed-linen is a default, but the operator submits a
  // payload with no bed-linen option. Per the immutability rule, `update` does NOT re-merge property
  // defaults: an existing reservation is never retro-fitted with an option it doesn't carry. The
  // submitted set has no linen option, so the rule-7 invariant zeros single/double beds.
  const captures = {};
  const controller = buildController({
    defaults: [{ optionId: 1, offered: false }], // property default: option 1 = bed-linen
    bedLinenFlaggedIds: new Set([1]),
    captures,
  });
  const req = {
    params: { id: '44' },
    body: basicBody({ singleBeds: 3, doubleBeds: 2, babyBeds: 0, options: [] }),
  };
  controller.update(req, fakeRes());
  // No re-merge → the persisted option set stays exactly as submitted (empty), and beds zero out.
  assert.deepEqual(req.body.options, []);
  assert.deepEqual(captures.updated, { id: 44, singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('update: NON-bed-linen property default is NOT re-merged either (historical preservation holds for all defaults)', () => {
  // specs/reservation-option-immutability.md — on `update` NO property default is re-merged
  // (bed-linen included; this test pins a non-linen default). A "Ménage" or "Petit-déjeuner" default
  // the operator removed from this reservation stays removed; nothing silently reappears on edit.
  const captures = {};
  const controller = buildController({
    defaults: [{ optionId: 2, offered: false }], // property default: option 2 = a NON-linen option
    bedLinenFlaggedIds: new Set([1]), // option 2 is NOT bed-linen-flagged
    captures,
  });
  const req = {
    params: { id: '45' },
    // Payload omits the non-linen default + has no bed-linen option either.
    body: basicBody({ singleBeds: 4, doubleBeds: 0, babyBeds: 0, options: [] }),
  };
  controller.update(req, fakeRes());
  // Nothing re-merged → options stay empty; no bed-linen anywhere → bed invariant zeros counts.
  assert.deepEqual(req.body.options, []);
  assert.deepEqual(captures.updated, { id: 45, singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});
