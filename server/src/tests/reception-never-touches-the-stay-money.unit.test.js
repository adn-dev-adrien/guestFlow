// specs/collect-stay-payment-at-check-in.md §3.6 — le rôle réception ne voit jamais l'argent du
// séjour, et n'en écrit jamais.
//
// Trois règles portant sur ce que voit et ce qu'écrit un compte de réception n'avaient **aucun test**
// (relevé le 2026-09-01 par le rapport de couverture). C'est précisément la sorte de règle qu'on ne
// veut pas découvrir cassée : elle décide ce qu'une personne extérieure à la comptabilité peut faire
// bouger. Et le mécanisme choisi est « échouer en se fermant » — le champ interdit est retiré en
// silence, jamais rejeté, pour qu'un client un peu ancien ne perde pas tout un check-in sur un
// champ qu'il n'aurait pas dû envoyer.
const test = require('node:test');
const assert = require('node:assert/strict');

const { toReceptionSasCommit, toReceptionReservationView } = require('../utils/receptionView');
// `buildStayPayment` répond « cette étape est-elle applicable ? » : elle vit dans le contrôleur du
// SAS, exposée pour être épinglée sans monter tout le harnais HTTP.
const { __test: { buildStayPayment } } = require('../controllers/sasController');

// specs/collect-stay-payment-at-check-in.md rule 25 — fail-closed sur l'écriture : `stayPaid` et
// `stayPaidCash` venant d'un compte réception sont retirés, jamais honorés.
test('un commit de réception perd les champs qui règlent le séjour', () => {
  const body = {
    stayPaid: true,
    stayPaidCash: true,
    cautionReceived: true,
    complementSettled: true,
    breakfastCoffee: 2,
  };
  const kept = toReceptionSasCommit(body);
  assert.equal('stayPaid' in kept, false);
  assert.equal('stayPaidCash' in kept, false);
  // …et le reste du check-in passe : la réception fait son travail, elle ne touche pas au séjour.
  assert.deepEqual(kept, { cautionReceived: true, complementSettled: true, breakfastCoffee: 2 });
});

// Même règle, appliquée au règlement UNIFIÉ : il encaisse le séjour, donc il tombe aussi.
test('le mode de paiement unique est retiré lui aussi', () => {
  const kept = toReceptionSasCommit({ arrivalPaymentMode: 'card', arrivalPaymentSplit: false, cautionReceived: true });
  assert.deepEqual(kept, { cautionReceived: true });
  // Le complément garde son propre champ : c'est le seul encaissement que la réception peut faire.
  assert.equal('complementSettled' in toReceptionSasCommit({ complementSettled: true }), true);
});

test('un commit sans champ interdit traverse intact', () => {
  const body = { cautionReceived: true, breakfastTime: '09:00' };
  assert.deepEqual(toReceptionSasCommit(body), body);
});

test('un corps vide ou absent ne fait pas tomber le commit', () => {
  assert.deepEqual(toReceptionSasCommit(), {});
  assert.deepEqual(toReceptionSasCommit(null), {});
});

// specs/collect-stay-payment-at-check-in.md rules 7 + 24 — côté LECTURE : aucun montant du séjour
// n'est servi. La règle est tenue par une liste blanche, pas par une liste noire : un champ d'argent
// ajouté demain reste dehors par défaut, ce qui est le bon sens de la sécurité.
test('la fiche servie à la réception ne porte aucun montant du séjour', () => {
  const view = toReceptionReservationView({
    id: 7,
    startDate: '2026-08-30',
    depositAmount: 200,
    balanceAmount: 400,
    complementAmount: 50,
    finalPrice: 650,
    totalPrice: 650,
    balancePaid: 1,
    arrivalPaymentGroup: '{"at":"2026-08-30","cash":0,"total":600,"buckets":["balance","complement"]}',
    arrivalPaymentReduction: 50,
  });
  for (const champ of [
    'depositAmount', 'balanceAmount', 'finalPrice', 'totalPrice',
    'arrivalPaymentGroup', 'arrivalPaymentReduction',
  ]) {
    assert.equal(champ in view, false, `${champ} ne doit pas être servi`);
  }
});

// specs/collect-stay-payment-at-check-in.md rule 7 — l'étape « Séjour à régler » n'est pas
// applicable : le serveur répond « non », il ne se contente pas de cacher un bouton côté écran.
test('l’étape de règlement du séjour n’est jamais applicable pour la réception', () => {
  const stay = { depositAmount: 0, balanceAmount: 400, balancePaid: 0 };
  assert.equal(buildStayPayment(stay, { isDeparture: false, receptionOnly: false }).applicable, true);
  const bridee = buildStayPayment(stay, { isDeparture: false, receptionOnly: true });
  assert.equal(bridee.applicable, false);
  assert.equal(bridee.total ?? 0, 0, 'et aucun montant ne transite');
});
