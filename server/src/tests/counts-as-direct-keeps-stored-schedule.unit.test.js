// specs/plugins-phase-p-productisation.md rule 45 (review of PR #803) — an existing stay on a channel
// counted as direct keeps the schedule it was stored with: the engine's direct rule applies to new
// stays only. Before, the next recompute opened an overdue acompte on a stay sold as one payment,
// dropped a stored acompte through the last-minute rule, and refused any save of a past fiche.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const realPricing = require('../utils/pricing');
const { calculateReservationQuote } = realPricing;
const { setDirectChannels } = require('../utils/platformNameFormat');
const { buildAuditSnapshotFromPayload } = require('../utils/reservationAudit');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

test.beforeEach(() => setDirectChannels(['lodgify']));
test.after(() => setDirectChannels([]));

const lodgifyDb = () => pricingAuditDb({ touristTax: 1, platforms: [{ name: 'Lodgify', countsAsDirect: 1, collects: 0, remits: 0 }] });
const STORED = { ...STAY, platform: 'Lodgify', startDate: '2026-04-01', endDate: '2026-04-03', bookingDate: '2026-01-10' };

test('sold as a single payment, nothing paid: deposit stays 0, no acompte deadline (was 180 overdue)', () => {
  const q = calculateReservationQuote({ ...STORED, db: lodgifyDb(), bookingId: 7, depositAmount: 0, balanceAmount: 600 });
  assert.deepEqual([q.depositAmount, q.balanceAmount, q.depositDueDate], [0, 600, null]);
});

test('…with a platform amount and a commission, the net stays the one it had (was 546)', () => {
  const q = calculateReservationQuote({
    ...STORED, db: lodgifyDb(), bookingId: 7, depositAmount: 0, balanceAmount: 600,
    platformGrossAmount: 600, platformCommissionAmount: 60,
  });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.platformNetReceivedAmount, 540);
});

test('a stored acompte on a last-minute stay is kept (was dropped)', () => {
  const q = calculateReservationQuote({
    ...STORED, db: lodgifyDb(), bookingId: 7, bookingDate: '2026-03-25', platformTakesDeposit: 1,
    depositAmount: 180, balanceAmount: 420,
  });
  assert.deepEqual([q.depositAmount, q.balanceAmount], [180, 420]);
});

test('a new stay on the channel takes the direct acompte', () => {
  const q = calculateReservationQuote({ ...STORED, db: lodgifyDb() });
  assert.equal(q.depositAmount, 180);
});

// The save of a past fiche: the real engine (on the fixture database), the real past-reservation lock.
function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function withMocks(modules, fn) {
  const orig = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    return Object.prototype.hasOwnProperty.call(modules, id) ? modules[id] : orig.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = orig; }
}

test('a past single-payment fiche can still be saved (was refused PAST_RESERVATION_LOCKED)', () => {
  const db = lodgifyDb();
  const payload = {
    propertyId: 1, clientId: 1, startDate: STORED.startDate, endDate: STORED.endDate,
    adults: 2, children: 0, teens: 0, babies: 0, checkInTime: '15:00', checkOutTime: '10:00',
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, platform: 'Lodgify', discountPercent: 0, customPrice: '',
    depositAmount: 0, balanceAmount: 602, notes: 'note',
  };
  const storedQuote = { ...calculateReservationQuote({ ...STORED, db, bookingId: 7, depositAmount: 0, balanceAmount: 602 }) };
  const row = { id: 7, propertyId: 1, kind: 'reservation', platform: 'Lodgify', startDate: STORED.startDate, endDate: STORED.endDate, depositAmount: 0, balanceAmount: 602, depositDueDate: null, balanceDueDate: storedQuote.balanceDueDate, createdAt: '2026-01-10' };
  const dbSnapshot = { ...buildAuditSnapshotFromPayload(payload, storedQuote), startDate: STORED.startDate };
  const captures = {};
  const controller = withMocks({
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-10-27' },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        if (k === 'getRow' || k === 'getForUpdate') return () => ({ ...row });
        if (k === 'getAuditSnapshotFromDb') return () => dbSnapshot;
        if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
        if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
        if (k === 'updateReservation') return (_id, saved, savedQuote) => { captures.quote = savedQuote; };
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({}) },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../utils/pricing': { ...realPricing, calculateReservationQuote: (input) => realPricing.calculateReservationQuote({ ...input, db }) },
    '../database': { prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const path = '../controllers/reservationsController';
    delete require.cache[require.resolve(path)];
    return require(path);
  });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body: payload, user: { role: 'admin' } }, res);
  assert.notEqual(res.body && res.body.code, 'PAST_RESERVATION_LOCKED', JSON.stringify(res.body));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(captures.quote.depositDueDate, null);
});
