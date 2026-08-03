// Merged « complément de fin de séjour » shown when the arrival complement was deferred to check-out.
// See specs/defer-arrival-complement-to-checkout.md §3.2.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCheckoutComplement, END_OF_STAY_CLEANING_LABEL } = require('../utils/checkoutComplement');

const arrivalDetail = {
  amount: 38,
  paid: 0,
  detail: [
    { kind: 'option', label: 'Linge de toilette', qty: 4, unitPrice: 8, amount: 32 },
    { kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: 6, amount: 6 },
  ],
};

function reservation(over = {}) {
  return {
    complementAmount: 38,
    complementPaid: 0,
    complementPaidCash: 0,
    complementPaidDate: null,
    complementDeferredToCheckout: 1,
    endOfStayComplementAmount: 40,
    endOfStayComplementPaid: 0,
    endOfStayComplementPaidCash: 0,
    endOfStayComplementPaidDate: null,
    endOfStayComplementDetail: JSON.stringify([{ label: END_OF_STAY_CLEANING_LABEL, amount: 40 }]),
    ...over,
  };
}

test('buildCheckoutComplement: one total = arrival + end-of-stay, lines concatenated with their origin', () => {
  const out = buildCheckoutComplement(reservation(), arrivalDetail);
  assert.equal(out.deferred, true);
  assert.equal(out.amount, 78);
  assert.equal(out.arrivalAmount, 38);
  assert.equal(out.endOfStayAmount, 40);
  assert.deepEqual(out.lines.map((l) => [l.label, l.amount, l.origin]), [
    ['Linge de toilette', 32, 'arrival'],
    ['Taxe de séjour', 6, 'arrival'],
    [END_OF_STAY_CLEANING_LABEL, 40, 'endOfStay'],
  ]);
  // The listed detail always reconciles with the total.
  assert.equal(out.lines.reduce((s, l) => s + l.amount, 0), out.amount);
});

test('buildCheckoutComplement: the tourist tax rides the merged list (collection view, accounting untouched)', () => {
  const out = buildCheckoutComplement(reservation(), arrivalDetail);
  const tax = out.lines.find((l) => l.label === 'Taxe de séjour');
  assert.ok(tax, 'tourist tax is part of the single amount the operator collects');
  assert.equal(tax.origin, 'arrival', 'but it keeps its arrival origin — accountingModel books it as before');
});

test('buildCheckoutComplement: not deferred when the marker is off, or once the arrival part is paid', () => {
  assert.equal(buildCheckoutComplement(reservation({ complementDeferredToCheckout: 0 }), arrivalDetail).deferred, false);
  assert.equal(buildCheckoutComplement(reservation({ complementPaid: 1 }), arrivalDetail).deferred, false);
  // Nothing on the arrival side → nothing to merge.
  assert.equal(buildCheckoutComplement(reservation({ complementAmount: 0 }), { amount: 0, paid: 0, detail: [] }).deferred, false);
});

test('buildCheckoutComplement: paid only when BOTH buckets are settled (a zero bucket is trivially settled)', () => {
  assert.equal(buildCheckoutComplement(reservation({ complementPaid: 1 }), arrivalDetail).paid, false);
  assert.equal(buildCheckoutComplement(reservation({ complementPaid: 1, endOfStayComplementPaid: 1 }), arrivalDetail).paid, true);
  assert.equal(
    buildCheckoutComplement(reservation({ complementPaid: 1, endOfStayComplementAmount: 0, endOfStayComplementDetail: null }), arrivalDetail).paid,
    true,
  );
});

test('buildCheckoutComplement: caisse interne on either bucket flags the merged card; zero lines are dropped', () => {
  assert.equal(buildCheckoutComplement(reservation({ endOfStayComplementPaidCash: 1 }), arrivalDetail).paidCash, true);
  const out = buildCheckoutComplement(
    reservation({ endOfStayComplementDetail: JSON.stringify([{ label: 'Rien', amount: 0 }]) }),
    arrivalDetail,
  );
  assert.deepEqual(out.lines.map((l) => l.label), ['Linge de toilette', 'Taxe de séjour']);
});

test('buildCheckoutComplement: tolerates a broken / absent end-of-stay detail JSON', () => {
  const out = buildCheckoutComplement(reservation({ endOfStayComplementDetail: '{oops' }), arrivalDetail);
  assert.equal(out.amount, 78, 'the authoritative amounts still come from the columns');
  assert.deepEqual(out.lines.map((l) => l.origin), ['arrival', 'arrival']);
});
