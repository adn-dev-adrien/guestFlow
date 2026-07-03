// Qonto payment-link VAT items builder (specs/payment-links-vat.md). MONEY-CRITICAL: the sum of the
// per-item Qonto totals MUST equal the charged amount to the cent, using Qonto's real half-up rule
// (verified in sandbox 2026-07-03). We replicate Qonto's per-line total to assert exactness.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatItems, lineTotalCents, htFromTtc, rateToBasis } = require('../utils/paymentLinkItems');

// Mirror of Qonto's charge for a built basket: Σ round_half_up(HT × (1+rate/100)).
function qontoCharge(items) {
  return items.reduce((s, it) => s + lineTotalCents(Math.round(it.amountCents), rateToBasis(it.vatRate)), 0);
}

test('lineTotalCents matches the live-probed Qonto half-up rounding', () => {
  assert.equal(lineTotalCents(23295, 1000), 25625); // 232.95 @10 → 256.245 → 256.25
  assert.equal(lineTotalCents(10005, 1000), 11006); // 100.05 @10 → 110.055 → 110.06
  assert.equal(lineTotalCents(23296, 1000), 25626); // 232.96 @10 → 256.256 → 256.26
  assert.equal(lineTotalCents(10000, 1000), 11000); // 100.00 @10 → 110.00
  assert.equal(lineTotalCents(5000, 0), 5000);      // 0 % → unchanged
});

test('public full stay: taxable stay @10 + tourist tax @0 → exact 266.05', () => {
  const { items, expectedTotalCents } = buildVatItems({
    components: [
      { title: 'Séjour et prestations', grossCents: 25625, taxable: true },
      { title: 'Taxe de séjour', grossCents: 980, taxable: false },
    ],
    vatRatePercent: 10,
  });
  assert.equal(expectedTotalCents, 26605);
  assert.equal(qontoCharge(items), 26605, 'Qonto charges exactly the stay total');
  const stay = items.find((i) => i.vatRate === 10);
  assert.equal(stay.amountCents, 23295, 'stay HT = floor(256.25 / 1.10)');
  const tax = items.find((i) => i.title === 'Taxe de séjour');
  assert.equal(tax.vatRate, 0);
  assert.equal(tax.amountCents, 980, 'no residual needed here');
});

test('residual is folded into the 0 % tourist-tax line and total stays exact', () => {
  // 256.24 stay @10 is an "unreachable" TTC: floor-HT 232.94 → Qonto 256.23 → residual 1 cent.
  const { items, expectedTotalCents } = buildVatItems({
    components: [
      { title: 'Séjour', grossCents: 25624, taxable: true },
      { title: 'Taxe de séjour', grossCents: 980, taxable: false },
    ],
    vatRatePercent: 10,
  });
  assert.equal(expectedTotalCents, 26604);
  assert.equal(qontoCharge(items), 26604, 'residual absorbed → exact');
  assert.equal(items.find((i) => i.vatRate === 10).amountCents, 23294);
  assert.equal(items.find((i) => i.title === 'Taxe de séjour').amountCents, 981, 'tax line carries the +1 cent');
});

test('deposit-only (no 0 % line): residual becomes an Ajustement line, total exact', () => {
  const { items } = buildVatItems({
    components: [{ title: 'Acompte séjour', grossCents: 25624, taxable: true }],
    vatRatePercent: 10,
  });
  assert.equal(qontoCharge(items), 25624, 'exact via adjustment');
  const adj = items.find((i) => i.title === 'Ajustement');
  assert.ok(adj && adj.vatRate === 0 && adj.amountCents === 1, 'a 1-cent 0 % adjustment line');
});

test('vatRate 0 globally: everything is a 0 % line, no adjustment, exact', () => {
  const { items, expectedTotalCents } = buildVatItems({
    components: [
      { title: 'Séjour', grossCents: 20000, taxable: true },
      { title: 'Taxe de séjour', grossCents: 980, taxable: false },
    ],
    vatRatePercent: 0,
  });
  assert.equal(expectedTotalCents, 20980);
  assert.equal(qontoCharge(items), 20980);
  assert.ok(items.every((i) => i.vatRate === 0));
  assert.equal(items.length, 2, 'no adjustment line when residual is 0');
});

test('zero/empty components are dropped (tourist tax collected on arrival → single stay line)', () => {
  const { items, expectedTotalCents } = buildVatItems({
    components: [
      { title: 'Séjour', grossCents: 25625, taxable: true },
      { title: 'Taxe de séjour', grossCents: 0, taxable: false },
    ],
    vatRatePercent: 10,
  });
  assert.equal(expectedTotalCents, 25625);
  assert.equal(items.length, 1, 'the 0 tax line is dropped');
  assert.equal(qontoCharge(items), 25625);
});

test('EXHAUSTIVE: every stay total 1..2000 € at 10 % (+9,80 tax) is charged to the exact cent', () => {
  for (let ttc = 100; ttc <= 200000; ttc += 1) { // cents, step 1 cent, up to 2000 €
    const { items, expectedTotalCents } = buildVatItems({
      components: [
        { title: 'Séjour', grossCents: ttc, taxable: true },
        { title: 'Taxe de séjour', grossCents: 980, taxable: false },
      ],
      vatRatePercent: 10,
    });
    assert.equal(qontoCharge(items), expectedTotalCents, `drift at ttc=${ttc}`);
    assert.ok(items.every((i) => i.amountCents >= 0), `negative line at ttc=${ttc}`);
  }
});

test('EXHAUSTIVE: deposit-only 1..2000 € at 20 % is exact and non-negative', () => {
  for (let ttc = 100; ttc <= 200000; ttc += 7) {
    const { items, expectedTotalCents } = buildVatItems({
      components: [{ title: 'Acompte', grossCents: ttc, taxable: true }],
      vatRatePercent: 20,
    });
    assert.equal(qontoCharge(items), expectedTotalCents, `drift at ttc=${ttc}`);
    assert.ok(items.every((i) => i.amountCents >= 0), `negative line at ttc=${ttc}`);
  }
});

test('htFromTtc floors so the round-trip never exceeds the target', () => {
  for (const [ttc, R] of [[25625, 1000], [25624, 1000], [11006, 1000], [50000, 2000], [12345, 850]]) {
    const ht = htFromTtc(ttc, R);
    assert.ok(lineTotalCents(ht, R) <= ttc, `${ttc}@${R}: line total must not exceed target`);
  }
});
