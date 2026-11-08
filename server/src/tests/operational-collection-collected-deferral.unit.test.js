// Audit R30-M-L1 (2026-11-08) — specs/dashboard-collection-alert.md §edge cases (reading R30-M-L1).
// specs/defer-arrival-complement-to-checkout.md rule 24: since then the block stays `deferred` over an arrival complement COLLECTED at a 0 € end of stay (the merged paid card);
// the Dashboard's arrivals cell then drew the money already taken at the door as « Complément reporté ». A complement
// is « reporté » only while something of it is left to collect.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOperationalCollection } = require('../utils/operationalCollection');
const { buildCheckoutComplement } = require('../utils/checkoutComplement');
const { todayIso } = require('../utils/localDate');

const build = (r) => buildOperationalCollection(r, buildCheckoutComplement(r, { amount: Number(r.complementAmount || 0), detail: [] }));
const complementPart = (side) => side.parts.find((p) => p.key === 'complement');
const BASE = {
  platform: 'Airbnb', depositAmount: 0, balanceAmount: 500, balancePaid: 0,
  complementAmount: 20, complementDeferredToCheckout: 1, endOfStayComplementAmount: 0,
};

for (const [label, paid] of [['in the books', { complementPaidCash: 0 }], ['in the caisse interne', { complementPaidCash: 1 }]]) {
  test(`R30-M-L1 — a deferred complement collected ${label} at a 0 € end of stay reads « OK », not « reporté »`, () => {
    const row = { ...BASE, complementPaid: 1, complementPaidDate: todayIso(), ...paid };
    assert.equal(buildCheckoutComplement(row).deferred, true, 'the block stays merged (defer-arrival-complement-to-checkout rule 24)');
    const c = build(row);
    assert.equal(complementPart(c.arrival).state, 'ok');
    assert.equal(c.arrival.deferred, false);
    assert.equal(c.arrival.alert, false);
    assert.equal(c.arrival.amountDue, 0);
    assert.equal(complementPart(c.departure).state, 'ok');
    assert.equal(c.departure.alert, false);
  });
}

test('R30-M-L1 — still due, alone or with an end of stay, the complement stays « reporté » with no arrival alert', () => {
  for (const eos of [0, 12]) {
    const c = build({ ...BASE, complementPaid: 0, endOfStayComplementAmount: eos });
    assert.equal(complementPart(c.arrival).state, 'deferred', `eos ${eos}`);
    assert.equal(c.arrival.alert, false);
    assert.equal(c.arrival.amountDue, 0);
    assert.equal(complementPart(c.departure).state, 'pending');
    assert.equal(c.departure.amountDue, 20 + eos);
  }
});

test('R30-M-L1 — without a block, the raw marker over a collected complement is not « reporté » either', () => {
  const c = buildOperationalCollection({ ...BASE, complementPaid: 1, complementPaidDate: todayIso() });
  assert.equal(complementPart(c.arrival).state, 'ok');
  assert.equal(c.arrival.deferred, false);
});
