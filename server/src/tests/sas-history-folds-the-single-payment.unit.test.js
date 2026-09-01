// specs/single-payment-at-check-in.md §3.2 rule 10 — quand le check-in a encaissé EN UNE FOIS,
// l'historique de la fiche porte UNE ligne, pas une par échéance.
//
// Règle écrite en v2.9.0 et jamais implémentée : l'audit du SAS listait « Acompte encaissé »,
// « Solde encaissé » et « Complément encaissé » séparément, racontant trois gestes là où le client
// n'en avait fait qu'un. Trouvée en relisant les règles une à une le 2026-09-01.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Le contrôleur tire tout le modèle : on lui substitue le strict nécessaire (le groupe stocké).
function loadWithGroup(group) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/reservationsModel') {
      return new Proxy({}, { get: (_, k) => (k === 'getRow' ? () => ({ arrivalPaymentGroup: group }) : () => null) });
    }
    return origRequire.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/sasController')];
    return require('../controllers/sasController').__test.foldGroupedPayment;
  } finally { Module.prototype.require = origRequire; }
}

const GROUP = '{"at":"2026-08-30","cash":0,"total":530,"buckets":["balance","complement"]}';
const paidLines = () => ([
  { field: 'balancePaid', label: 'Solde encaissé', fromText: 'non', toText: 'oui' },
  { field: 'complementPaid', label: 'Complément encaissé', fromText: 'non', toText: 'oui' },
]);

test('les lignes par échéance sont repliées en une seule, qui dit le montant, le moyen et la date', () => {
  const fold = loadWithGroup(GROUP);
  const out = fold(1, paidLines());
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Encaissé à l'arrivée — paiement unique");
  assert.equal(out[0].toText, '530 € — CB / Chèque le 2026-08-30 — solde, complément');
});

test('le reste du check-in garde ses propres lignes', () => {
  // Le ménage, le petit-déjeuner, la caution sont d'autres décisions : les replier les effacerait.
  const fold = loadWithGroup(GROUP);
  const out = fold(1, [
    ...paidLines(),
    { field: 'cautionReceived', label: 'Caution reçue', fromText: 'non', toText: 'oui' },
  ]);
  assert.deepEqual(out.map((c) => c.field), ['cautionReceived', 'arrivalPayment']);
});

test('une caisse interne le dit', () => {
  const fold = loadWithGroup('{"at":"2026-08-30","cash":1,"total":530,"buckets":["balance","complement"]}');
  assert.match(fold(1, paidLines())[0].toText, /caisse interne/);
});

test('sans groupe, rien n’est replié — ce sont bien des gestes séparés', () => {
  const fold = loadWithGroup(null);
  assert.equal(fold(1, paidLines()).length, 2);
});

test('une seule échéance encaissée n’est pas un « paiement unique »', () => {
  const fold = loadWithGroup(GROUP);
  const one = [{ field: 'balancePaid', label: 'Solde encaissé', fromText: 'non', toText: 'oui' }];
  assert.deepEqual(fold(1, one), one);
});
