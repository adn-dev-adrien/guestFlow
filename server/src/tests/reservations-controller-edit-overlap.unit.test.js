const test = require('node:test');
const assert = require('node:assert/strict');

// specs/edit-reservation-blocked-by-overlap.md — editing an EXISTING reservation must not be rejected
// by an availability/capacity conflict the edit didn't introduce. When the placement (property + dates +
// times) is unchanged, a pre-existing overlap is NOT re-checked (so a finance-only edit, e.g. the
// platform payment, saves). Moving the reservation INTO a conflict still validates.

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

// `stored` = what getForUpdate returns (the reservation as persisted). `availabilityError` /
// `capacityCfg` let a test force a conflict. `captures.validateCalled` tracks whether the guard ran.
function buildController({ stored, availabilityError = null, capacity, captures }) {
  const pricingMock = {
    calculateReservationQuote() {
      return {
        totalPrice: 0, finalPrice: 100, depositAmount: 0, balanceAmount: 100,
        optionLines: [], resourceLines: [], nightlyBreakdown: [],
        depositDueDate: null, balanceDueDate: null, nights: 2, error: null,
      };
    },
  };
  const dbMock = { prepare() { return { get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }; } };
  const cap = capacity || { maxAdults: 99, maxChildren: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 };

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
      if (k === 'getPropertyCapacity') return () => cap;
      if (k === 'getPropertyBeds') return () => ({ singleBeds: cap.singleBeds, doubleBeds: cap.doubleBeds, babyBeds: cap.babyBeds });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: cap.babyBeds });
      if (k === 'validateAvailability') return () => { captures.validateCalled = true; return availabilityError; };
      if (k === 'updateReservation') return (id) => { captures.updated = { id }; };
      if (k === 'addHistoryEntry') return () => null;
      if (k === 'insertNights') return () => null;
      if (k === 'replaceOptions') return () => null;
      if (k === 'getReservationNumber') return () => 'R-1';
      if (k === 'getForUpdate') return () => stored;
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  }, () => {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  });
}

const PLACEMENT = {
  propertyId: 1, startDate: '2099-09-10', endDate: '2099-09-12', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
};
function body(over = {}) {
  return { clientId: 1, platform: 'Airbnb', options: [], ...PLACEMENT, ...over };
}

test('edit with unchanged placement: a pre-existing overlap does NOT block the save', () => {
  const captures = {};
  const controller = buildController({ stored: { ...PLACEMENT }, availabilityError: { error: 'Ce logement est déjà réservé pour ces dates.' }, captures });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: body() }, res);
  assert.equal(res.statusCode, 200, 'save succeeds despite the pre-existing overlap');
  assert.ok(captures.updated, 'updateReservation was called');
  assert.notEqual(captures.validateCalled, true, 'the availability guard was skipped (placement unchanged)');
});

test('moving the reservation into a conflict IS still rejected', () => {
  const captures = {};
  const controller = buildController({ stored: { ...PLACEMENT }, availabilityError: { error: 'Ce logement est déjà réservé pour ces dates.' }, captures });
  const res = fakeRes();
  // endDate changed → placement changed → the guard runs and the conflict is enforced.
  controller.update({ params: { id: '7' }, body: body({ endDate: '2099-09-14' }) }, res);
  assert.equal(captures.validateCalled, true, 'the availability guard ran (dates changed)');
  assert.equal(res.statusCode, 409, 'the conflict is rejected');
});

test('edit with unchanged occupancy: a pre-existing capacity excess does NOT block the save', () => {
  const captures = {};
  // Property allows 0 babies but the stored reservation already has 1 (e.g. an iCal import).
  const controller = buildController({
    stored: { ...PLACEMENT, babies: 1 },
    capacity: { maxAdults: 99, maxChildren: 99, maxBabies: 0, singleBeds: 99, doubleBeds: 99, babyBeds: 0 },
    captures,
  });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: body({ babies: 1 }) }, res);
  assert.equal(res.statusCode, 200, 'finance-only edit saves despite the pre-existing capacity excess');
  assert.ok(captures.updated, 'updateReservation was called');
});

test('increasing occupancy beyond capacity IS still rejected', () => {
  const captures = {};
  const controller = buildController({
    stored: { ...PLACEMENT, babies: 0 },
    capacity: { maxAdults: 99, maxChildren: 99, maxBabies: 0, singleBeds: 99, doubleBeds: 99, babyBeds: 0 },
    captures,
  });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: body({ babies: 1 }) }, res); // babies 0 → 1, over capacity
  assert.equal(res.statusCode, 400, 'the capacity excess introduced by the edit is rejected');
});
