// specs/single-payment-from-the-fiche.md rules 9 + 4 — ce que l'encaissement unique écrit dans
// l'historique de la fiche, et qui a le droit de l'écrire.
//
// Pourquoi ce fichier existe : la dissolution d'un groupe laisse une trace depuis le 2026-08-31
// (`arrival-payment-dissolution-is-traced`), mais sa CRÉATION n'en avait aucune sous test. Or c'est
// la moitié qui compte pour l'opérateur : relire « 250 € — CB / Chèque le 30/08 — solde, complément »
// six mois plus tard est la seule façon de savoir ce qu'il a encaissé ce jour-là, et à quel titre.
//
// Même harnais de doublures que `arrival-payment-adjust-endpoint` : pas de base, le modèle remplacé,
// puis on inspecte ce que le contrôleur a réellement demandé.
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

// Une réservation dont le solde et le complément de fin de séjour sont dus : la forme exacte de la
// 22281 en production, celle qui a motivé la règle 2bis.
const DUE = {
  id: 7,
  propertyId: 1,
  createdAt: '2026-08-01',
  balanceAmount: 200,
  balancePaid: 0,
  complementAmount: 50,
  complementPaid: 0,
  arrivalPaymentGroup: null,
};

function buildController(captures, { settled, row = DUE } = {}) {
  return withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ error: null }) },
    '../utils/financeValidation': { validateFinanceInputs: () => null, validateClientGrossAmount: () => null },
    '../utils/occupancy': { getNightBlocksFromTimes: () => ({}), buildOccupiedDatesFromReservations: () => [] },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-09-01' },
    '../utils/reservationAudit': { buildAuditSnapshotFromPayload: () => ({}), computeAuditChanges: () => [] },
    '../utils/bedDistribution': { suggestBedDistribution: () => null },
    '../utils/forceItemContribsCapture': { captureContribsOnFlip: () => null, clearContribsOnUnflip: () => null },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        if (k === 'getRow') return () => ({ ...row });
        if (k === 'getByIdWithDetails') return () => ({ ...row, options: [], resources: [] });
        if (k === 'buildArrivalComplementDetail') return () => ({ detail: [] });
        if (k === 'settleArrivalBuckets') {
          return (id, args) => { captures.settle = { id, ...args }; return settled; };
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

const COLLECTED = { buckets: ['balance', 'complement'], total: 250, grouped: true };

function settle(body, opts = {}) {
  const captures = {};
  const controller = buildController(captures, { settled: opts.settled ?? COLLECTED, row: opts.row });
  const res = fakeRes();
  controller.settleArrivalPayment(
    { params: { id: '7' }, body, user: opts.user ?? { role: 'admin' } },
    res,
  );
  return { captures, res };
}

// specs/single-payment-from-the-fiche.md rule 9 — le montant, le moyen ET les échéances couvertes.
// Les trois : sans le moyen on ne sait pas si c'est en banque, sans les échéances on ne sait pas ce
// que le client a soldé.
test('encaisser en une fois écrit une ligne qui dit tout ce qui a été encaissé', () => {
  const { captures, res } = settle({ mode: 'card', date: '2026-08-30' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(captures.settle, { id: 7, mode: 'card', date: '2026-08-30' });
  assert.equal(captures.history.length, 1);
  const [line] = captures.history;
  assert.equal(line.label, "Paiement unique encaissé à l'arrivée");
  assert.equal(line.to, '250 € — CB / Chèque le 2026-08-30 — balance, complement');
});

test('la caisse interne se nomme dans l’historique, elle ne se devine pas', () => {
  const { captures } = settle({ mode: 'cash', date: '2026-08-30' });
  assert.match(captures.history[0].to, /caisse interne le 2026-08-30/);
});

// specs/single-payment-from-the-fiche.md rule 10 — l'annulation laisse sa propre trace : un
// encaissement qui disparaît sans un mot est ce qui a coûté quatre releases en août.
test('annuler le paiement écrit ce qui a été défait', () => {
  const { captures } = settle({ mode: 'undo' }, {
    row: { ...DUE, arrivalPaymentGroup: '{"at":"2026-08-30","cash":0,"total":250,"buckets":["balance","complement"]}' },
  });
  assert.equal(captures.history[0].to, 'annulé');
  assert.equal(captures.history[0].from, '250 € (balance, complement)');
});

test('un encaissement qui ne porte sur rien n’écrit pas de ligne', () => {
  const { captures } = settle({ mode: 'card', date: '2026-08-30' }, {
    settled: { buckets: [], total: 0, grouped: false },
  });
  assert.equal(captures.history, undefined);
});

// specs/single-payment-from-the-fiche.md rule 4 — la réception ne voit jamais les montants du
// séjour, donc elle ne les encaisse pas non plus. Le refus est côté SERVEUR : cacher le bouton ne
// serait qu'un décor.
test('un compte réception ne peut pas encaisser le séjour', () => {
  const { captures, res } = settle({ mode: 'card', date: '2026-08-30' }, {
    user: { role: 'reception' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(captures.settle, undefined, 'et rien n’est écrit');
});

test('un compte à la fois réception et admin reste un admin', () => {
  const { res } = settle({ mode: 'card', date: '2026-08-30' }, {
    user: { roles: ['reception', 'admin'] },
  });
  assert.equal(res.statusCode, 200);
});
