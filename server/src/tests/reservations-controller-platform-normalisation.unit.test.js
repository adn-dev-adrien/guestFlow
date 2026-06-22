const test = require('node:test');
const assert = require('node:assert/strict');

// specs/bed-config-in-linen-card.md §10 hotfix follow-up #4 — empty platform must never be persisted.
// The controller normalises NULL / '' / whitespace to 'direct' before any downstream logic runs.
//
// (The former « gross coercion / GROSS_BELOW_NET » tests were removed 2026-06-22 with the
// « Prix payé par le client » field — the platform commission is now operator-entered and the
// accounting recognises the CA on the total séjour, so there is no gross input to coerce/validate.)

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

function buildController({ quoteFinalPrice = 100, quoteBalanceAmount, captures }) {
  const balanceAmount = quoteBalanceAmount === undefined ? quoteFinalPrice : quoteBalanceAmount;
  const pricingMock = {
    calculateReservationQuote(input) {
      captures.quoteInput = input; // last input the controller passed to the engine
      return {
        totalPrice: 0, finalPrice: quoteFinalPrice, depositAmount: 0, balanceAmount,
        optionLines: [], resourceLines: [], nightlyBreakdown: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      };
    },
  };
  const dbMock = {
    prepare() {
      return {
        get() { return { countsAsBedLinen: 0 }; },
        run() { return { changes: 0 }; },
        all() { return []; },
      };
    },
  };

  const controllerModule = '../controllers/reservationsController';
  return withMocks({
    '../utils/pricing': pricingMock,
    '../utils/financeValidation': require('../utils/financeValidation'),
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
      if (k === 'insertReservation') return (body) => { captures.inserted = { platform: body.platform }; return 1; };
      if (k === 'updateReservation') return (id, body) => { captures.updated = { id, platform: body.platform }; };
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getForUpdate') return () => ({ propertyId: 1 });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

function bodyFor(platform, opts = {}) {
  return {
    propertyId: 1, clientId: 1,
    startDate: '2099-09-10', endDate: '2099-09-12',
    adults: 2, children: 0, teens: 0, babies: 0,
    checkInTime: '15:00', checkOutTime: '10:00',
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    platform,
    options: [],
    ...opts,
  };
}

test('create — NULL platform is normalised to direct before persistence', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.create({ body: bodyFor(null) }, fakeRes());
  assert.equal(captures.inserted.platform, 'direct', 'NULL platform → direct');
});

test('create — empty-string platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.create({ body: bodyFor('') }, fakeRes());
  assert.equal(captures.inserted.platform, 'direct', "'' platform → direct");
});

test('create — whitespace-only platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.create({ body: bodyFor('   ') }, fakeRes());
  assert.equal(captures.inserted.platform, 'direct', "'   ' platform → direct");
});

test('update — NULL platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.update({ params: { id: '999' }, body: bodyFor(null) }, fakeRes());
  assert.equal(captures.updated.platform, 'direct');
});

test('create — a real platform value is preserved', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.create({ body: bodyFor('Airbnb') }, fakeRes());
  assert.equal(captures.inserted.platform, 'Airbnb', 'non-empty platform left intact');
});

// specs/platform-payment-entry.md + platform-commission-line.md — the engine must receive `platform`,
// `platformGrossAmount` (brut → pins finalPrice) and `platformCommissionAmount` (→ solde = net) on SAVE,
// not just the live preview. Regression: Yann P. — stored finalPrice ignored the brut (983 vs 994) and
// older résas had a full-total solde because these never reached the engine on create/update.
test('create forwards platform + brut + commission to the pricing engine', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.create({ body: bodyFor('Gîtes de France', { platformGrossAmount: 994, platformCommissionAmount: 91 }) }, fakeRes());
  assert.equal(captures.quoteInput.platform, 'Gîtes de France', 'platform reaches the engine on create');
  assert.equal(captures.quoteInput.platformGrossAmount, 994, 'brut reaches the engine on create');
  assert.equal(captures.quoteInput.platformCommissionAmount, 91, 'commission reaches the engine on create');
});

test('update forwards platform + brut + commission to the pricing engine', () => {
  const captures = {};
  const controller = buildController({ captures });
  controller.update({ params: { id: '999' }, body: bodyFor('Gîtes de France', { platformGrossAmount: 994, platformCommissionAmount: 91 }) }, fakeRes());
  assert.equal(captures.quoteInput.platform, 'Gîtes de France');
  assert.equal(captures.quoteInput.platformGrossAmount, 994);
  assert.equal(captures.quoteInput.platformCommissionAmount, 91);
});
