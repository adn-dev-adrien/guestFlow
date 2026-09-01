// specs/arrival-payment-detail-and-adjustment.md §3.2 — what the guest ACTUALLY handed over for the
// single arrival payment. Pure: no DB, no engine. What matters here is that the réduction stays a
// réduction ON THE ACCOMMODATION — it may eat that line whole and not a cent more, so the taxe de
// séjour, owed to the commune whatever the operator granted, is never quietly discounted.
const test = require('node:test');
const assert = require('node:assert');

const { resolveArrivalPaymentAdjustment } = require('../utils/arrivalPaymentAdjustment');

// 720,82 € de solde + 132 € de complément, dont 720,82 € d'hébergement.
const PAYMENT = { bucketsTotal: 852.82, accommodation: 720.82 };

// specs/arrival-payment-detail-and-adjustment.md rule 9
test('no target: nothing is adjusted, and the total is the buckets', () => {
  for (const target of [null, undefined, '']) {
    const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target });
    assert.deepEqual(
      { reduction: r.reduction, tip: r.tip, total: r.total, floored: r.floored },
      { reduction: 0, tip: 0, total: 852.82, floored: false },
    );
  }
});

// specs/arrival-payment-detail-and-adjustment.md rule 10
test('below the computed total: the difference is a réduction accordée', () => {
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: 800 });
  assert.equal(r.reduction, 52.82);
  assert.equal(r.tip, 0);
  assert.equal(r.total, 800);
  assert.equal(r.floored, false);
});

// specs/arrival-payment-detail-and-adjustment.md rule 12
test('above the computed total: the surplus is a pourboire', () => {
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: 900 });
  assert.equal(r.tip, 47.18);
  assert.equal(r.reduction, 0);
  assert.equal(r.total, 900);
});

// specs/arrival-payment-detail-and-adjustment.md rule 11
test('the floor is the payment minus its accommodation', () => {
  // 852,82 − 720,82 : les prestations et la taxe de séjour ne sont pas négociables ici.
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: null });
  assert.equal(r.floor, 132);
});

// specs/arrival-payment-detail-and-adjustment.md rule 16
test('a target under the floor is RAISED to it, and says so', () => {
  // L'opérateur voulait 50 € ; la réduction s'arrête à l'hébergement. On honore l'intention aussi
  // loin que les livres le permettent au lieu de refuser la saisie — et `floored` le dit au champ.
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: 50 });
  assert.equal(r.total, 132);
  assert.equal(r.reduction, 720.82);
  assert.equal(r.floored, true);
});

test('the réduction may eat the whole accommodation, and not a cent more', () => {
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: 132 });
  assert.equal(r.reduction, 720.82);
  assert.equal(r.floored, false);
});

// specs/arrival-payment-detail-and-adjustment.md rule 11
test('a payment with no accommodation cannot be reduced at all', () => {
  // Un séjour prépayé dont le groupe ne couvre que les compléments : rien à réduire, et le plancher
  // le dit (il vaut le total).
  const r = resolveArrivalPaymentAdjustment({ bucketsTotal: 132, accommodation: 0, target: 100 });
  assert.equal(r.floor, 132);
  assert.equal(r.total, 132);
  assert.equal(r.reduction, 0);
  assert.equal(r.floored, true);
});

// specs/arrival-payment-detail-and-adjustment.md rule 16
test('a nonsense target is ignored rather than stored', () => {
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: 'huit cents' });
  assert.equal(r.reduction, 0);
  assert.equal(r.total, 852.82);
});

test('a negative target lands on the floor, never below zero', () => {
  const r = resolveArrivalPaymentAdjustment({ ...PAYMENT, target: -100 });
  assert.equal(r.total, 132);
  assert.equal(r.floored, true);
});

test('a corrupt accommodation share can never open a bigger réduction than the payment', () => {
  // Défensif : un instantané de contribution aberrant ne doit pas autoriser une remise supérieure à
  // ce qui a été encaissé — le plancher reste ≥ 0.
  const r = resolveArrivalPaymentAdjustment({ bucketsTotal: 100, accommodation: 900, target: 0 });
  assert.equal(r.floor, 0);
  assert.equal(r.reduction, 100);
});

test('everything is rounded to the cent, like every stored amount', () => {
  const r = resolveArrivalPaymentAdjustment({ bucketsTotal: 100.005, accommodation: 50, target: 66.666 });
  assert.equal(r.total, 66.67);
  assert.equal(r.reduction, 33.34);
});
