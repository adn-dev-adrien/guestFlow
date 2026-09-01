// specs/arrival-payment-detail-and-adjustment.md §3.2 — le point d'entrée qui enregistre « ce que le
// client a vraiment remis ».
//
// Deux règles que seul le contrôleur porte : l'ajustement reste possible APRÈS l'encaissement — c'est
// le cas d'usage principal, on s'aperçoit après coup qu'on a consenti 50 € — et il laisse une trace
// lisible dans l'historique. Sans cette trace, une baisse de la comptabilité serait indistinguable
// d'une erreur, ce qui est exactement le silence qui a coûté quatre releases en août.
//
// Même squelette de doublures que `fiche-save-keeps-the-payment` : pas de base, chaque modèle et util
// remplacé, puis on inspecte ce que le contrôleur a réellement demandé.
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

// Une réservation dont TOUT est déjà encaissé, en une fois : l'état dans lequel un opérateur se rend
// compte, une semaine plus tard, qu'il avait consenti une remise.
const SETTLED = {
  id: 7,
  propertyId: 1,
  createdAt: '2026-08-01',
  balanceAmount: 400,
  balancePaid: 1,
  balancePaidDate: '2026-08-30',
  complementAmount: 100,
  complementPaid: 1,
  complementPaidDate: '2026-08-30',
  arrivalPaymentGroup: '{"at":"2026-08-30","cash":0,"total":500,"buckets":["balance","complement"]}',
};

function buildController({ captures, group = SETTLED.arrivalPaymentGroup, resolved }) {
  return withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ error: null }) },
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-09-06' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        if (k === 'getRow') return () => ({ ...SETTLED, arrivalPaymentGroup: group });
        if (k === 'getByIdWithDetails') return () => ({ ...SETTLED, arrivalPaymentGroup: group, options: [], resources: [] });
        if (k === 'buildArrivalComplementDetail') return () => ({ detail: [] });
        if (k === 'setArrivalPaymentAdjustment') {
          return (id, args) => { captures.adjust = { id, ...args }; return resolved; };
        }
        if (k === 'addHistoryEntry') return (id, type, changes) => { captures.history = changes; };
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({}), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': { prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });
}

function adjust(total, opts = {}) {
  const captures = {};
  const controller = buildController({
    captures,
    resolved: opts.resolved ?? { reduction: 50, tip: 0, total: 450, floor: 100, floored: false },
    ...opts,
  });
  const res = fakeRes();
  controller.settleArrivalPayment(
    { params: { id: '7' }, body: { mode: 'adjust', total }, user: { role: 'admin' } },
    res,
  );
  return { captures, res };
}

// specs/arrival-payment-detail-and-adjustment.md rule 14 — ajustable APRÈS coup, sur un séjour dont
// toutes les échéances sont déjà encaissées. C'est le cas d'usage principal, pas une tolérance.
test('un paiement déjà encaissé reste ajustable', () => {
  const { captures, res } = adjust(450);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captures.adjust, { id: 7, target: 450 });
});

test('vider le champ restaure le calcul automatique', () => {
  const { captures } = adjust('', { resolved: { reduction: 0, tip: 0, total: 500, floor: 100, floored: false } });
  assert.equal(captures.adjust.target, null);
});

test('un montant qui n’est pas un nombre est refusé, pas stocké', () => {
  const { captures, res } = adjust('beaucoup');
  assert.equal(res.statusCode, 400);
  assert.equal(captures.adjust, undefined);
});

test('sans paiement unique, il n’y a rien à ajuster', () => {
  // Règle 13 : pas de groupe, pas d'ajustement — et le refus est explicite plutôt que silencieux.
  const { res } = adjust(450, { group: null, resolved: null });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'ADJUST_NO_GROUP');
});

// specs/arrival-payment-detail-and-adjustment.md rule 17 — tracé dans l'historique : c'est de
// l'argent, ça doit se relire des mois plus tard.
test('l’ajustement écrit une ligne d’historique qui dit le geste', () => {
  const { captures } = adjust(450);
  assert.equal(captures.history.length, 1);
  const [line] = captures.history;
  assert.equal(line.label, "Total encaissé à l'arrivée");
  assert.equal(line.from, '500 €');
  assert.match(line.to, /450 €.*réduction 50 €/);
});

test('un pourboire se lit aussi dans l’historique', () => {
  const { captures } = adjust(520, { resolved: { reduction: 0, tip: 20, total: 520, floor: 100, floored: false } });
  assert.match(captures.history[0].to, /520 €.*pourboire 20 €/);
});

test('un ajustement qui ne change rien n’écrit pas de ligne', () => {
  // Sinon l'historique se remplirait de bruit à chaque enregistrement, et le bruit cache le signal.
  const { captures } = adjust(500, { resolved: { reduction: 0, tip: 0, total: 500, floor: 100, floored: false } });
  assert.equal(captures.history, undefined);
});
