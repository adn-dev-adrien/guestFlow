const test = require('node:test');
const assert = require('node:assert/strict');

// specs/bed-config-in-linen-card.md §10 hotfix follow-up #2.
//
// For direct bookings (platform = 'direct' or empty), the form NEVER renders the gross
// input — see `client/src/components/reservation/FinanceSection.js:129`, which gates the
// input on `platform !== 'direct'`. So the stored value sits frozen the moment finalPrice
// recomputes. The controller now coerces `clientGrossAmount = quote.finalPrice` for direct
// bookings before the GROSS_BELOW_NET validator runs.
//
// User-reported scenario (2026-06-05, reservation #12089): direct booking, operator added
// the bed-linen option which bumped finalPrice from 620 to 648; clientGrossAmount stayed
// at 620; save returned 400 GROSS_BELOW_NET. With this coercion, gross is rewritten to
// 648 server-side and the save succeeds.

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

function buildController({ quoteFinalPrice = 648, captures }) {
  const pricingMock = {
    calculateReservationQuote() {
      return {
        totalPrice: 0, finalPrice: quoteFinalPrice, depositAmount: 0, balanceAmount: 0,
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
      if (k === 'insertReservation') return (body) => { captures.inserted = { clientGrossAmount: body.clientGrossAmount, platform: body.platform }; return 1; };
      if (k === 'updateReservation') return (id, body) => { captures.updated = { id, clientGrossAmount: body.clientGrossAmount, platform: body.platform }; };
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

function bodyFor(platform, clientGrossAmount, opts = {}) {
  return {
    propertyId: 1, clientId: 1,
    startDate: '2099-09-10', endDate: '2099-09-12',
    adults: 2, children: 0, teens: 0, babies: 0,
    checkInTime: '15:00', checkOutTime: '10:00',
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    platform,
    clientGrossAmount,
    options: [],
    ...opts,
  };
}

test('create — direct + clientGrossAmount stale below finalPrice → controller coerces to finalPrice, save succeeds', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 648, captures });
  const req = { body: bodyFor('direct', 620) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(res.statusCode, 200, 'no GROSS_BELOW_NET — direct is coerced');
  assert.equal(captures.inserted.clientGrossAmount, 648, 'gross was rewritten to finalPrice');
});

test('create — platform=Airbnb + gross below net → still 400 (the operator-entered gross is authoritative)', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 648, captures });
  const req = { body: bodyFor('Airbnb', 620) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'GROSS_BELOW_NET');
});

test('update — direct + clientGrossAmount stale below finalPrice → coerced to finalPrice', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 648, captures });
  const req = { params: { id: '12089' }, body: bodyFor('direct', 620) };
  const res = fakeRes();
  controller.update(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captures.updated.clientGrossAmount, 648);
});

test('update — platform=Airbnb + gross >= net → validates normally', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 600, captures });
  const req = { params: { id: '12089' }, body: bodyFor('Airbnb', 700) };
  const res = fakeRes();
  controller.update(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captures.updated.clientGrossAmount, 700, 'platform gross is NOT coerced');
});

test('create — empty platform (= treated as direct) is also coerced', () => {
  // Some legacy payloads omit `platform` entirely; the form normalises to "direct" on the
  // client but a third-party caller might send empty. Coercion still applies.
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 648, captures });
  const req = { body: bodyFor('', 0) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captures.inserted.clientGrossAmount, 648);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// specs/bed-config-in-linen-card.md §10 hotfix follow-up #4 — empty platform must never
// be persisted. The controller normalises NULL / '' / whitespace to 'direct' before any
// downstream logic runs. Pairs with the boot migration that backfills legacy rows.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('create — NULL platform is normalised to direct before persistence', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 100, captures });
  const req = { body: bodyFor(null, 0) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captures.inserted.platform, 'direct', 'NULL platform → direct');
});

test('create — empty-string platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 100, captures });
  const req = { body: bodyFor('', 0) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(captures.inserted.platform, 'direct', "'' platform → direct");
});

test('create — whitespace-only platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 100, captures });
  const req = { body: bodyFor('   ', 0) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(captures.inserted.platform, 'direct', "'   ' platform → direct");
});

test('update — NULL platform is normalised to direct', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 100, captures });
  const req = { params: { id: '999' }, body: bodyFor(null, 0) };
  const res = fakeRes();
  controller.update(req, res);
  assert.equal(captures.updated.platform, 'direct');
});

test('create — real platform value is preserved (no false-positive coercion)', () => {
  const captures = {};
  const controller = buildController({ quoteFinalPrice: 100, captures });
  // Use a high gross so the validator passes (Airbnb gross >= net).
  const req = { body: bodyFor('Airbnb', 150) };
  const res = fakeRes();
  controller.create(req, res);
  assert.equal(captures.inserted.platform, 'Airbnb', 'non-empty platform left intact');
});
