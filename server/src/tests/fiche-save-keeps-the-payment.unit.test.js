// specs/single-payment-from-the-fiche.md rule 11bis — a fiche save may never un-pay a bucket.
//
// The bug this pins, measured in production on réservation 22281 (2026-08-31): the operator opens a
// fiche, clicks « Encaisser en une fois » — the server settles the solde and the complément de fin de
// séjour and records the group — then clicks « Enregistrer ». The form was loaded BEFORE the money was
// recorded, so it still held « solde payé = non »; the save echoed that stale value back, the server
// read it as a dé-paiement, and `releaseStayBucket` dissolved the single payment. Every time.
//
// The three payment flags are not form fields — « Marquer solde payé », the SAS and « Encaisser en une
// fois » each write them through their own endpoint — so what the browser sends back is at best
// unchanged and at worst stale. The stored state therefore wins.
//
// Same mock skeleton as `reservations-controller-bed-linen-invariant`: no DB stack, every model and
// util stubbed, then `update` is driven with a synthetic body and we inspect what
// `model.updateReservation` and the pricing engine actually received.
const test = require('node:test');
const assert = require('node:assert/strict');

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
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The stored reservation: everything was collected at the door in ONE payment, and the group says so.
const SETTLED_ROW = {
  id: 7,
  propertyId: 1,
  depositPaid: 0,
  depositPaidDate: null,
  depositDisabled: 1,
  balancePaid: 1,
  balancePaidDate: '2026-08-30',
  balanceAmount: 231.98,
  complementPaid: 1,
  complementPaidDate: '2026-08-30',
  complementAmount: 45,
  endOfStayComplementAmount: 50,
  endOfStayComplementPaid: 1,
  arrivalPaymentGroup: '{"at":"2026-08-30","cash":0,"total":281.98,"buckets":["balance","endOfStayComplement"]}',
};

function buildController({ captures, storedRow = SETTLED_ROW }) {
  const pricingMock = {
    calculateReservationQuote(input) {
      captures.quoteInput = input;
      return {
        totalPrice: 0, finalPrice: 0, depositAmount: 0, balanceAmount: 0, complementAmount: 0,
        optionLines: [], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      };
    },
  };
  const dbMock = {
    prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }),
  };

  return withMocks({
    '../utils/pricing': pricingMock,
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-08-31' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        if (k === 'getRow') return () => ({ ...storedRow });
        if (k === 'getForUpdate') return () => ({ ...storedRow });
        if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2026-08-30' });
        if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
        if (k === 'validateAvailability') return () => null;
        if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
        if (k === 'updateReservation') return (id, body) => { captures.payload = body; };
        // Anything the save calls on the way through is a no-op here; only the payload matters.
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  }, () => {
    const path = '../controllers/reservationsController';
    delete require.cache[require.resolve(path)];
    return require(path);
  });
}

// What the browser sends after « Encaisser en une fois »: the form was loaded BEFORE the payment, so
// the three flags are the pre-payment ones. This body is the bug.
function staleBody(over = {}) {
  return {
    propertyId: 1,
    clientId: 1,
    startDate: '2026-08-30',
    endDate: '2026-08-31',
    adults: 2, children: 0, teens: 0, babies: 0,
    checkInTime: '16:00', checkOutTime: '10:00',
    singleBeds: 0, doubleBeds: 1, babyBeds: 0,
    depositPaid: false,
    depositPaidDate: '',
    balancePaid: false,
    balancePaidDate: '',
    complementPaid: false,
    complementPaidDate: '',
    ...over,
  };
}

function runUpdate(body, storedRow) {
  const captures = {};
  const controller = buildController({ captures, storedRow });
  const res = fakeRes();
  controller.update({ params: { id: '7' }, body, user: { role: 'admin' } }, res);
  return { captures, res };
}

test('a stale « solde non payé » in the save no longer un-pays the solde', () => {
  const { captures } = runUpdate(staleBody());
  assert.equal(captures.payload.balancePaid, true);
  assert.equal(captures.payload.balancePaidDate, '2026-08-30');
});

test('…nor the complément d’arrivée', () => {
  const { captures } = runUpdate(staleBody());
  assert.equal(captures.payload.complementPaid, true);
  assert.equal(captures.payload.complementPaidDate, '2026-08-30');
});

test('…nor the acompte', () => {
  const { captures } = runUpdate(
    staleBody(),
    { ...SETTLED_ROW, depositDisabled: 0, depositPaid: 1, depositPaidDate: '2026-07-01' },
  );
  assert.equal(captures.payload.depositPaid, true);
  assert.equal(captures.payload.depositPaidDate, '2026-07-01');
});

test('a save cannot PAY a bucket either — the flags are simply not its business', () => {
  // The mirror case: a browser claiming « payé » on a bucket the server knows is unpaid must not
  // book money. Only the dedicated endpoints collect.
  const { captures } = runUpdate(
    staleBody({ balancePaid: true, balancePaidDate: '2026-08-31' }),
    { ...SETTLED_ROW, balancePaid: 0, balancePaidDate: null },
  );
  assert.equal(captures.payload.balancePaid, false);
  assert.equal(captures.payload.balancePaidDate, null);
});

test('disabling the deposit still force-zeroes it — the one flag this save owns', () => {
  // specs/disable-deposit-per-reservation.md: the toggle IS a form field, and turning it on must
  // clear a deposit that was flagged paid, or the accounting re-emits a phantom entry.
  const { captures } = runUpdate(
    staleBody({ depositDisabled: true }),
    { ...SETTLED_ROW, depositDisabled: 0, depositPaid: 1, depositPaidDate: '2026-07-01' },
  );
  assert.equal(captures.payload.depositPaid, false);
  assert.equal(captures.payload.depositPaidDate, null);
});

test('the quote is priced on the stored flags, not on the browser’s', () => {
  // Otherwise the engine's frozen-schedule branches would disagree with the row about to be written:
  // a solde the engine thinks is unpaid gets recomputed, and the amount that was collected moves.
  const { captures } = runUpdate(staleBody());
  assert.equal(captures.quoteInput.balancePaid, true);
  assert.equal(captures.quoteInput.complementPaid, true);
});
