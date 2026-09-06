// specs/payment-schedule-and-cancellation.md rule 25 — une réservation ANNULÉE est en lecture seule.
// specs/adjustable-complement-amounts.md rule 10 — l'ajustement des compléments hérite de cette garde
// comme tout le reste de la fiche : il n'y a pas de porte à part pour l'argent.
//
// Pourquoi c'est important : les montants et les échéances d'un séjour annulé sont de l'HISTOIRE — la
// comptabilité les relit — et ses dates sont retournées à la vente. Une écriture y ferait l'un des
// deux dégâts : réécrire les livres d'un mois clos, ou ressusciter une réservation que plus personne
// n'attend. La garde répond 409 avec un code, pas un message : le client sait quoi en faire.
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

// `cancelledGuard` interroge la base directement : c'est le `kind` stocké qui tranche, jamais un
// champ du formulaire — sinon le navigateur déciderait lui-même s'il a le droit d'écrire.
function buildController(captures, { kind = 'cancelled' } = {}) {
  return withMocks({
    '../utils/pricing': {
      calculateReservationQuote: () => ({
        totalPrice: 0, finalPrice: 0, depositAmount: 0, balanceAmount: 0, complementAmount: 0,
        optionLines: [], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      }),
    },
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-08-31' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        const stored = { id: 7, kind, startDate: '2026-08-30', endDate: '2026-08-31', propertyId: 1 };
        if (k === 'getRow' || k === 'getForUpdate' || k === 'getBasic') return () => ({ ...stored });
        if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2026-08-30' });
        if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
        if (k === 'validateAvailability') return () => null;
        if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
        if (k === 'updateReservation') return (id, body) => { captures.payload = body; };
        if (k === 'updatePaymentFields') return (id, body) => { captures.payment = body; };
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare: () => ({ get: () => ({ kind }), run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });
}

const BODY = {
  propertyId: 1, clientId: 1, startDate: '2026-08-30', endDate: '2026-08-31',
  adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '16:00', checkOutTime: '10:00',
  singleBeds: 0, doubleBeds: 1, babyBeds: 0,
};

function call(handler, body, opts) {
  const captures = {};
  const controller = buildController(captures, opts);
  const res = fakeRes();
  controller[handler]({ params: { id: '7' }, body, user: { role: 'admin' } }, res);
  return { captures, res };
}

test('rule 25 — enregistrer une réservation annulée est refusé, et rien n’est écrit', () => {
  const { captures, res } = call('update', BODY);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_CANCELLED');
  assert.equal(captures.payload, undefined);
});

// specs/adjustable-complement-amounts.md rule 10 — l'ajustement d'un complément passe par le même
// enregistrement, donc par la même garde : pas de chemin de contournement.
test('rule 10 — ajuster un complément sur une réservation annulée est refusé aussi', () => {
  const { captures, res } = call('update', { ...BODY, complementAmountOverride: 14 });
  assert.equal(res.statusCode, 409);
  assert.equal(captures.payload, undefined);
});

test('rule 25 — le paiement d’une réservation annulée est verrouillé de la même façon', () => {
  const { captures, res } = call('updatePayment', { balancePaid: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RESERVATION_CANCELLED');
  assert.equal(captures.payment, undefined);
});

test('une réservation ordinaire traverse la garde sans encombre', () => {
  const { res } = call('update', BODY, { kind: 'reservation' });
  assert.notEqual(res.statusCode, 409);
});
