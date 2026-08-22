/**
 * specs/defer-arrival-complement-to-checkout.md §3.3 — la fiche décide aussi.
 *
 * L'interrupteur « Percevoir en fin de séjour » écrit le MÊME marqueur que le récap du SAS arrivée,
 * il est tracé dans l'historique, et il fait basculer le split avant même le début du séjour — sinon
 * la carte fusionnée et le panneau de droite se contrediraient.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { splitComplementBuckets } = require('../utils/complementBuckets');

// ── le split ────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100;
const invariant = (input) => {
  const out = splitComplementBuckets(input);
  assert.equal(
    round2(out.arrival + out.duringStay + out.endOfStay),
    round2(round2(Number(input.complementAmount || 0))
      + round2(Number(input.midStaySettledTotal || 0))
      + round2(Number(input.endOfStayComplementTotal || 0))),
    'le split ne change jamais un total',
  );
  return out;
};

test('règle 16 — reporté avant le début du séjour : le complément d\'arrivée passe en fin de séjour', () => {
  assert.deepEqual(
    invariant({ complementAmount: 24, complementPaid: 0, endOfStayComplementTotal: 10, stayStarted: false, deferred: true }),
    { arrival: 0, duringStay: 0, endOfStay: 34 },
  );
});

test('règle 16 — sans le marqueur, un séjour à venir garde son complément d\'arrivée', () => {
  assert.deepEqual(
    invariant({ complementAmount: 24, complementPaid: 0, endOfStayComplementTotal: 10, stayStarted: false, deferred: false }),
    { arrival: 24, duringStay: 0, endOfStay: 10 },
  );
});

test('un complément ENCAISSÉ reste sous « arrivée », marqueur ou pas', () => {
  assert.deepEqual(
    invariant({ complementAmount: 24, complementPaid: 1, endOfStayComplementTotal: 10, stayStarted: true, deferred: true }),
    { arrival: 24, duringStay: 0, endOfStay: 10 },
  );
});

// ── la comptabilité ne bouge pas d'un centime ───────────────────────────────

test('règle 18 — reportée ou non, la même réservation produit les mêmes écritures', () => {
  const { __test: { buildEntry } } = require('../models/accountingModel');
  const row = (deferred) => ({
    id: 1, firstName: 'Jean', lastName: 'Dupont', platform: 'direct',
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-07-01',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-07-05',
    complementAmount: 24, complementPaid: 1, complementPaidDate: '2026-07-10',
    finalPrice: 224, totalPrice: 224, touristTaxTotal: 0, touristTaxInComplement: 0,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
    clientGrossAmount: null, complementAllocation: null,
    complementDeferredToCheckout: deferred,
  });
  for (const kind of ['deposit', 'balance', 'complement']) {
    assert.deepEqual(
      buildEntry(row(1), kind), buildEntry(row(0), kind),
      `l'écriture « ${kind} » doit être identique, reportée ou non`,
    );
  }
});

// ── l'écriture du marqueur par la fiche ─────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function buildController({ captures, prev = {} }) {
  const origRequire = Module.prototype.require;
  const dbMock = { transaction: (fn) => (...a) => fn(...a), prepare: () => ({ get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }) };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getBasic') return () => ({ id: 1 });
    if (k === 'getRow') return () => ({ complementDeferredToCheckout: 0, ...prev });
    if (k === 'setComplementDeferredToCheckout') return (id, next) => { captures.deferred.push({ id, next }); };
    if (k === 'addHistoryEntry') return (id, type, changes) => { captures.history.push({ id, type, changes }); };
    return () => null;
  } });
  const modules = {
    '../utils/pricing': { calculateReservationQuote: () => ({}) },
    '../utils/financeValidation': require('../utils/financeValidation'),
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-07-01' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': reservationsModelMock,
    '../models/settingsModel': { read: () => ({}), allowEditPastReservations: () => false },
    '../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../database': dbMock,
  };
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  } finally { Module.prototype.require = origRequire; }
}

test('règles 12-14 — le PATCH pose le marqueur et le trace dans l\'historique', () => {
  const captures = { deferred: [], history: [] };
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.updatePayment({ params: { id: '1' }, body: { complementDeferredToCheckout: true } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(captures.deferred, [{ id: 1, next: true }]);
  assert.equal(captures.history.length, 1);
  assert.equal(captures.history[0].changes[0].to, 'Perçu en fin de séjour');
});

test('règle 13 — bidirectionnel : le remettre à l\'arrivée efface le marqueur', () => {
  const captures = { deferred: [], history: [] };
  const controller = buildController({ captures, prev: { complementDeferredToCheckout: 1 } });
  controller.updatePayment({ params: { id: '1' }, body: { complementDeferredToCheckout: false } }, fakeRes());
  assert.deepEqual(captures.deferred, [{ id: 1, next: false }]);
  assert.equal(captures.history[0].changes[0].to, 'Perçu à l\'arrivée');
});

test('même valeur → aucune écriture, aucune ligne d\'historique', () => {
  const captures = { deferred: [], history: [] };
  const controller = buildController({ captures, prev: { complementDeferredToCheckout: 1 } });
  controller.updatePayment({ params: { id: '1' }, body: { complementDeferredToCheckout: true } }, fakeRes());
  assert.equal(captures.deferred.length, 0);
  assert.equal(captures.history.length, 0);
});
