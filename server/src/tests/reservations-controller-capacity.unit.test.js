const test = require('node:test');
const assert = require('node:assert/strict');

// specs/property-capacity-single-total.md §3 rules 2, 6 and 9 — the controller enforces the ONE-total
// rule on create, lets the operator force it through, and NEVER re-checks a reservation whose
// occupancy didn't move (so a legacy over-capacity booking stays editable).

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

function buildController({ capacity, stored = null, captures = {} }) {
  const pricingMock = {
    calculateReservationQuote: () => ({
      totalPrice: 0, finalPrice: 100, depositAmount: 0, balanceAmount: 100,
      optionLines: [], resourceLines: [], nightlyBreakdown: [],
      depositDueDate: null, balanceDueDate: null, nights: 2, error: null,
    }),
  };
  const dbMock = { prepare: () => ({ get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }) };

  return withMocks({
    '../utils/pricing': pricingMock,
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-08-14' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, { get: (_, k) => {
      if (k === 'getPropertyCapacity') return () => capacity;
      if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
      if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
      if (k === 'validateAvailability') return () => null;
      if (k === 'insertReservation') return () => { captures.inserted = true; return 42; };
      if (k === 'updateReservation') return (id) => { captures.updated = { id }; };
      if (k === 'getReservationNumber') return () => 'R-42';
      if (k === 'getForUpdate') return () => stored;
      if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2099-09-10' });
      if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] });
      if (k === 'resolveArrivalExtrasBaseline') return () => null;
      if (k === 'totalsByReservation') return () => ({ book: 0 });
      return () => null;
    } }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../utils/googleCalendarSync': { schedulePush: () => null },
    '../database': dbMock,
  }, () => {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  });
}

const LODGE = { maxGuests: 5, maxBabies: 1, singleBeds: 99, doubleBeds: 99 };
const STAY = {
  clientId: 1, platform: 'direct', options: [],
  propertyId: 2, startDate: '2099-09-10', endDate: '2099-09-12',
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 1, children: 1, teens: 0, babies: 0,
};

test('create: 1 adulte + 1 enfant is accepted on a 5-guest property', () => {
  const captures = {};
  const controller = buildController({ capacity: LODGE, captures });
  const res = fakeRes();
  controller.create({ body: { ...STAY } }, res);
  assert.equal(res.statusCode, 200, res.body && res.body.error);
  assert.ok(captures.inserted, 'the reservation was persisted');
});

test('create: six over-2s on a 5-guest property is rejected with the one-total message', () => {
  const controller = buildController({ capacity: LODGE });
  const res = fakeRes();
  controller.create({ body: { ...STAY, adults: 4, children: 1, teens: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /voyageurs: 6\/5/);
});

test('create: forceCapacity lets the operator through', () => {
  const captures = {};
  const controller = buildController({ capacity: LODGE, captures });
  const res = fakeRes();
  controller.create({ body: { ...STAY, adults: 6, forceCapacity: true } }, res);
  assert.equal(res.statusCode, 200, res.body && res.body.error);
  assert.ok(captures.inserted, 'the forced reservation was persisted');
});

test('update: a legacy over-capacity reservation saves when the occupancy does not move (rule 9)', () => {
  const captures = {};
  const stored = { ...STAY, adults: 8 }; // 8 adultes + 1 enfant = 9 > 5, saved before this rule existed
  const controller = buildController({ capacity: LODGE, stored, captures });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: { ...STAY, adults: 8, customPrice: 900 } }, res);
  assert.equal(res.statusCode, 200, res.body && res.body.error);
  assert.ok(captures.updated, 'the finance-only edit was persisted');
});

test('update: raising the occupancy over capacity IS rejected', () => {
  const stored = { ...STAY, adults: 2 };
  const controller = buildController({ capacity: LODGE, stored });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: { ...STAY, adults: 7 } }, res); // 7 adultes + 1 enfant
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /voyageurs: 8\/5/);
});
