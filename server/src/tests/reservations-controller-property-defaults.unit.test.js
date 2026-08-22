const test = require('node:test');
const assert = require('node:assert/strict');

// Non-regression coverage for specs/devis-pdf-and-tourist-tax-fixes.md §3.3 rule 13:
// `reservationsController.create` enforces property option defaults on the server side
// so a UI bug, a raw API caller, or any future client surface cannot skip them.
//
// We avoid spinning the controller's full DB stack by stubbing the pricing engine, the
// model and the defaults model. The interesting unit under test is the IIFE in `create`
// that merges defaults into the `selectedOptions` array passed to the engine.

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

function buildController(defaults, captures, carriedOptionIds = []) {
  // Light mocks for every module the controller pulls in.
  const propertyOptionDefaultsModel = {
    listForProperty(propertyId) {
      captures.lastDefaultsLookupPropertyId = propertyId;
      return defaults;
    },
  };

  const pricingMock = {
    calculateReservationQuote(args) {
      captures.lastQuoteArgs = args;
      return {
        totalPrice: 0, finalPrice: 0, depositAmount: 0, balanceAmount: 0,
        optionLines: [], resourceLines: [], nightlyBreakdown: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      };
    },
  };

  const noopModel = new Proxy({}, { get: () => () => null });
  const noopUtil = new Proxy({}, { get: () => () => null });

  const controllerModule = '../controllers/reservationsController';

  return withMocks({
    '../utils/pricing': pricingMock,
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-06-04' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': noopUtil,
    '../models/reservationsModel': new Proxy({}, { get: (_, k) => {
      if (k === 'getPropertyIdOf') return () => null;
      if (k === 'getPropertyCapacity') return () => ({ adults: 99, children: 99, babies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (k === 'validateAvailability') return () => null;
      if (k === 'insertReservation') return (...args) => { captures.insertedReservation = args; return 1; };
      // specs/tourist-tax-included-services-deduction.md rule 5 — what the stored reservation carries.
      if (k === 'listCarriedOptionIds') return () => carriedOptionIds;
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
      if (k === 'replaceOptions') return () => null;
      if (k === 'replaceCustomOptions') return () => null;
      if (k === 'insertCustomOptions') return () => null;
      if (k === 'replaceResources') return () => null;
      if (k === 'insertResourceLines') return () => null;
      if (k === 'replaceNights') return () => null;
      if (k === 'deleteCustomOptions') return () => null;
      if (k === 'deleteResources') return () => null;
      if (k === 'addHistoryEntry') return () => null;
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': propertyOptionDefaultsModel,
    '../database': { prepare: () => ({ run: () => null, get: () => null, all: () => [] }) },
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

test('create merges property defaults into selectedOptions before quoting (rule 13)', () => {
  const captures = {};
  const controller = buildController(
    [{ optionId: 42, offered: false }, { optionId: 7, offered: true }],
    captures,
  );
  const req = {
    body: {
      propertyId: 1, clientId: 1,
      startDate: '2099-09-10', endDate: '2099-09-12',
      adults: 2, children: 0, teens: 0, babies: 0,
      checkInTime: '15:00', checkOutTime: '10:00',
      options: [{ optionId: 99, quantity: 1 }],
    },
  };
  controller.create(req, fakeRes());
  const selectedOptionIds = (captures.lastQuoteArgs.selectedOptions || []).map((o) => Number(o.optionId)).sort((a, b) => a - b);
  assert.deepEqual(selectedOptionIds, [7, 42, 99], 'both defaults are added on top of the caller-provided 99');
});

test('create does not duplicate a default already present in the payload', () => {
  const captures = {};
  const controller = buildController([{ optionId: 42, offered: false }], captures);
  const req = {
    body: {
      propertyId: 1, clientId: 1, startDate: '2099-09-10', endDate: '2099-09-12',
      adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '15:00', checkOutTime: '10:00',
      options: [{ optionId: 42, quantity: 2 }], // already includes the default
    },
  };
  controller.create(req, fakeRes());
  const lines = (captures.lastQuoteArgs.selectedOptions || []).filter((o) => Number(o.optionId) === 42);
  assert.equal(lines.length, 1, 'exactly one line for the explicit option');
  assert.equal(lines[0].quantity, 2, 'the caller-provided quantity wins');
});

test('create is a no-op when the property has no defaults configured', () => {
  const captures = {};
  const controller = buildController([], captures);
  const req = {
    body: {
      propertyId: 1, clientId: 1, startDate: '2099-09-10', endDate: '2099-09-12',
      adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '15:00', checkOutTime: '10:00',
      options: [{ optionId: 99, quantity: 1 }],
    },
  };
  controller.create(req, fakeRes());
  const ids = (captures.lastQuoteArgs.selectedOptions || []).map((o) => Number(o.optionId));
  assert.deepEqual(ids, [99]);
});

test('create propagates the offered=true default into offeredOptionIds (rule 11)', () => {
  const captures = {};
  const controller = buildController(
    [{ optionId: 7, offered: true }, { optionId: 42, offered: false }],
    captures,
  );
  const req = {
    body: {
      propertyId: 1, clientId: 1, startDate: '2099-09-10', endDate: '2099-09-12',
      adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '15:00', checkOutTime: '10:00',
      options: [], offeredOptionIds: [],
    },
  };
  controller.create(req, fakeRes());
  const offered = (captures.lastQuoteArgs.offeredOptionIds || []).map(Number).sort((a, b) => a - b);
  assert.ok(offered.includes(7), 'offered=true default is in offeredOptionIds');
  assert.ok(!offered.includes(42), 'offered=false default is NOT in offeredOptionIds');
});


// ── update: a service included in the rate cannot be dropped ────────────────────────────
// specs/tourist-tax-included-services-deduction.md rules 4-5. The fiche locks the Switch ON; the
// server makes it a guarantee, so the declared tourist-tax base never depends on a keystroke.
// Bounded by what the reservation ALREADY carries — specs/reservation-option-immutability.md rule 3.

function updateReq(body) {
  return { params: { id: 1 }, body: { propertyId: 1, clientId: 1, startDate: '2099-09-10', endDate: '2099-09-12', adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '15:00', checkOutTime: '10:00', ...body } };
}

test('update restores an offered default the payload dropped when the reservation carries it', () => {
  const captures = {};
  const controller = buildController([{ optionId: 7, offered: true }], captures, [7]);
  controller.update(updateReq({ options: [{ optionId: 99, quantity: 1 }], offeredOptionIds: [] }), fakeRes());

  const ids = (captures.lastQuoteArgs.selectedOptions || []).map((o) => Number(o.optionId)).sort((a, b) => a - b);
  assert.deepEqual(ids, [7, 99], 'the included service is put back');
  assert.ok((captures.lastQuoteArgs.offeredOptionIds || []).map(Number).includes(7), 'and stays offered');
});

test('update does not add an offered default the reservation never carried', () => {
  const captures = {};
  const controller = buildController([{ optionId: 7, offered: true }], captures, []);
  controller.update(updateReq({ options: [{ optionId: 99, quantity: 1 }], offeredOptionIds: [] }), fakeRes());

  const ids = (captures.lastQuoteArgs.selectedOptions || []).map((o) => Number(o.optionId));
  assert.deepEqual(ids, [99], 'immutability wins: an absent default stays absent');
});

test('update leaves a BILLED default removable — only an included service is locked', () => {
  const captures = {};
  const controller = buildController([{ optionId: 42, offered: false }], captures, [42]);
  controller.update(updateReq({ options: [], offeredOptionIds: [] }), fakeRes());

  const ids = (captures.lastQuoteArgs.selectedOptions || []).map((o) => Number(o.optionId));
  assert.deepEqual(ids, [], 'a paid default is an ordinary option the operator may remove');
});

// ── the live preview quotes the same party as the save ──────────────────────────────────
// specs/tourist-tax-included-services-deduction.md rule 16. A baby pays nothing but occupies the
// lodging, and the tourist tax divides the night by the OCCUPANTS. `create`/`update` have always
// forwarded `babies`; `calculatePrice` did not, so a stay with a cot showed one tax on the fiche and
// stored another (Lodge #22275: 16,38 € on screen, 13,05 € declared).
test('calculatePrice forwards babies to the engine, like create and update do', () => {
  const captures = {};
  const controller = buildController([], captures);
  controller.calculatePrice({
    body: {
      propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-13',
      adults: 3, children: 1, teens: 0, babies: 1, babyBeds: 1,
      checkInTime: '15:00', checkOutTime: '10:00', options: [],
    },
  }, fakeRes());

  assert.equal(captures.lastQuoteArgs.babies, 1, 'the cot occupant reaches the tourist-tax divisor');
  assert.equal(captures.lastQuoteArgs.adults, 3);
  assert.equal(captures.lastQuoteArgs.children, 1);
});
