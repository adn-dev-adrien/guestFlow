// specs/adjustable-complement-amounts.md rule 7 — le montant ajusté d'un complément est validé côté
// SERVEUR : nombre fini ≥ 0, sinon `NEGATIVE_AMOUNT` / `NOT_A_NUMBER`.
//
// Pourquoi ce fichier existe : le validateur `validateMoneyAmount` a ses propres tests depuis
// longtemps, mais rien ne prouvait que les deux champs d'ajustement lui étaient BRANCHÉS. C'est le
// genre d'oubli qui ne se voit pas — un champ manquant dans la liste du contrôleur laisserait passer
// un complément négatif jusqu'en base, et le devis comme la comptabilité en hériteraient.
//
// Le harnais est celui de `fiche-save-keeps-the-payment`, à une différence près, qui est tout
// l'intérêt : le VRAI `financeValidation` est chargé.
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

function buildController(captures) {
  return withMocks({
    '../utils/pricing': {
      calculateReservationQuote: () => ({
        totalPrice: 0, finalPrice: 0, depositAmount: 0, balanceAmount: 0, complementAmount: 0,
        optionLines: [], resourceLines: [], nightlyBreakdown: [], midStayExtrasLines: [],
        depositDueDate: null, balanceDueDate: null, nights: 1, error: null,
      }),
    },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-08-31' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        const stored = { id: 7, startDate: '2026-08-30', endDate: '2026-08-31', propertyId: 1 };
        if (k === 'getRow' || k === 'getForUpdate') return () => ({ ...stored });
        if (k === 'getAuditSnapshotFromDb') return () => ({ startDate: '2026-08-30' });
        if (k === 'getPropertyCapacity') return () => ({ maxGuests: 99, maxBabies: 99, singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getPropertyBeds') return () => ({ singleBeds: 99, doubleBeds: 99, babyBeds: 99 });
        if (k === 'getBabyBedAvailability') return () => ({ availableBabyBeds: 99 });
        if (k === 'validateAvailability') return () => null;
        if (k === 'getPricingSnapshot') return () => ({ lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null });
        if (k === 'updateReservation') return (id, body) => { captures.payload = body; };
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({ allowEditPastReservations: 0 }), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });
}

function save(over) {
  const captures = {};
  const controller = buildController(captures);
  const res = fakeRes();
  controller.update({
    params: { id: '7' },
    body: {
      propertyId: 1, clientId: 1, startDate: '2026-08-30', endDate: '2026-08-31',
      adults: 2, children: 0, teens: 0, babies: 0,
      checkInTime: '16:00', checkOutTime: '10:00',
      singleBeds: 0, doubleBeds: 1, babyBeds: 0,
      ...over,
    },
    user: { role: 'admin' },
  }, res);
  return { captures, res };
}

test('rule 7 — un complément d’arrivée négatif est refusé, pas stocké', () => {
  const { captures, res } = save({ complementAmountOverride: -5 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NEGATIVE_AMOUNT');
  assert.equal(captures.payload, undefined);
});

test('rule 7 — le complément de fin de séjour est branché sur le même validateur', () => {
  const { res } = save({ endOfStayComplementAmountOverride: -0.01 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NEGATIVE_AMOUNT');
});

test('rule 7 — ce qui n’est pas un nombre est refusé, jamais coercé', () => {
  const { res } = save({ complementAmountOverride: 'quatre-vingts' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NOT_A_NUMBER');
});

// specs/adjustable-complement-amounts.md rule 3 — le champ vide vaut « calcul automatique » : c'est
// la valeur que le navigateur envoie dès que l'opérateur efface le montant, et elle doit traverser.
test('rule 7 — un champ vide traverse : c’est le retour au calcul automatique', () => {
  const { res } = save({ complementAmountOverride: '', endOfStayComplementAmountOverride: '' });
  assert.notEqual(res.statusCode, 400);
});

test('rule 7 — un montant valide traverse, y compris 0', () => {
  const { res } = save({ complementAmountOverride: 0 });
  assert.notEqual(res.statusCode, 400);
});
