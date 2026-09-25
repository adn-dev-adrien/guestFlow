// specs/platform-payout-due-date.md §3.5 rule 38 — a started or finished stay keeps the solde
// deadline it was stored with.
//
// The bug this pins, measured on réservation 22219 (Booking, 17–19 July 2026) on 2026-09-25: the
// operator edits nothing but « Paiement plateforme » — the virement reçu — and the save comes back
// 400 « Cette réservation est passée ou en cours… ». Nothing they typed is forbidden: the fiche was
// saved under the old J-30 derivation (solde due 10/07), and the engine now derives the platform
// payout regime (départ 19/07 + 10 = 29/07). That re-derivation is a change on a field the
// past-reservation allowlist does not carry, so EVERY later edit of an old platform fiche is refused.
//
// Same mock skeleton as `fiche-save-keeps-the-payment`, with one difference: `reservationAudit` is
// NOT stubbed — the real snapshot/diff is what produces the refusal, so the test would prove nothing
// without it.
const test = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');

const { buildAuditSnapshotFromPayload } = require('../utils/reservationAudit');

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
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// What the engine derives TODAY for a Booking stay ending on 19/07 with a 10-day payout delay.
const RECOMPUTED_DEADLINE = '2026-07-29';
// What the row has carried since it was saved, under the old J-30 rule.
const STORED_DEADLINE = '2026-07-10';

function quoteFor(balanceDueDate) {
  return {
    totalPrice: 1074.5, finalPrice: 1283.34, depositAmount: 0, balanceAmount: 1283.34,
    complementAmount: 0, touristTaxRate: 0, touristTaxTotal: 0,
    optionLines: [], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [],
    depositDueDate: null, balanceDueDate, nights: 2, error: null,
  };
}

function body(over = {}) {
  return {
    propertyId: 1,
    clientId: 79,
    startDate: '2026-07-17',
    endDate: '2026-07-19',
    adults: 8, children: 0, teens: 0, babies: 0,
    checkInTime: '16:00', checkOutTime: '10:00',
    // Zeroed by the save itself when no bed-linen option is selected — kept at 0 so the two
    // snapshots differ on the deadline and on nothing else.
    singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    platform: 'Booking',
    discountPercent: 0,
    customPrice: 1059.26,
    depositDisabled: true,
    platformGrossAmount: 1283.34,
    // The one thing the operator changed.
    platformPayoutAmount: 1075.27,
    platformCommissionAmount: 188.87,
    ...over,
  };
}

function runUpdate({ storedDeadline, startDate = '2026-07-17' }) {
  const captures = {};
  const payload = body();
  // The row as the DB holds it: priced identically, but with the deadline of its own era.
  const dbSnapshot = {
    ...buildAuditSnapshotFromPayload(payload, quoteFor(storedDeadline)),
    startDate,
  };

  const controller = withMocks({
    '../utils/pricing': {
      calculateReservationQuote(input) {
        captures.quoteInput = input;
        return quoteFor(RECOMPUTED_DEADLINE);
      },
    },
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-09-25' },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        const row = { id: 22219, propertyId: 1, startDate, endDate: '2026-07-19', balanceDueDate: storedDeadline };
        if (k === 'getRow') return () => ({ ...row });
        if (k === 'getForUpdate') return () => ({ ...row });
        if (k === 'getAuditSnapshotFromDb') return () => dbSnapshot;
        if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
        if (k === 'validateAvailability') return () => null;
        if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
        if (k === 'updateReservation') return (_id, saved, savedQuote) => { captures.payload = saved; captures.quote = savedQuote; };
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({}) },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const path = '../controllers/reservationsController';
    delete require.cache[require.resolve(path)];
    return require(path);
  });

  const res = fakeRes();
  controller.update({ params: { id: '22219' }, body: payload, user: { role: 'admin' } }, res);
  return { captures, res };
}

test('a platform-payment edit on a past fiche is saved, not refused', () => {
  const { res } = runUpdate({ storedDeadline: STORED_DEADLINE });
  assert.notEqual(res.body && res.body.code, 'PAST_RESERVATION_LOCKED');
  assert.equal(res.statusCode, 200);
});

test('…and the solde deadline it was stored with is the one written back', () => {
  const { captures } = runUpdate({ storedDeadline: STORED_DEADLINE });
  assert.equal(captures.quote.balanceDueDate, STORED_DEADLINE);
});

test('a future fiche still re-derives its deadline from the payout regime', () => {
  // The freeze is the past-reservation lock's business only: a stay that has not started must keep
  // following the platform payout rule, or the « Virement plateforme en retard » alert loses its anchor.
  const { captures } = runUpdate({ storedDeadline: STORED_DEADLINE, startDate: '2027-07-17' });
  assert.equal(captures.quote.balanceDueDate, RECOMPUTED_DEADLINE);
});
