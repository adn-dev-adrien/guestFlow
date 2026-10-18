// specs/payment-links-vat.md rule 9 — the « Taxe de séjour » item of a Qonto link is the stay's tax to
// the cent; the rounding residual rides on its own « Ajustement » item. Final review 2026-10-18, N3: a
// Gîte link read « Taxe de séjour 21,61 € » for 21,60 € (6 × 3 × 1,20), a devis link 7,21 € for 7,20 €.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatItems, lineTotalCents, rateToBasis } = require('../utils/paymentLinkItems');
const { storedLinkComponents } = require('../utils/storedLinkComponents');

const qontoCharge = (items) => items.reduce((s, it) => s + lineTotalCents(Math.round(it.amountCents), rateToBasis(it.vatRate)), 0);
const titles = { deposit: 'Acompte séjour', balance: 'Séjour Gite', full: 'Séjour' };

test('rule 9 — Gîte solde 465,60 € with 21,60 € of tax: the tax item reads 21,60 €, the total is exact', () => {
  const basket = storedLinkComponents(
    { balanceAmount: 465.6, touristTaxTotal: 6 * 3 * 1.2 },
    'balance',
    { vatRatePercent: 10, taxOnArrival: false, titles },
  );
  const { items, expectedTotalCents } = buildVatItems(basket);
  assert.equal(expectedTotalCents, 46560);
  assert.equal(qontoCharge(items), 46560, 'Qonto charges the solde exactly');
  assert.equal(items.find((i) => i.vatRate === 10).amountCents, 40363, 'stay HT 403,63 €');
  assert.equal(items.find((i) => i.title === 'Taxe de séjour').amountCents, 2160);
  assert.equal(items.find((i) => i.title === 'Ajustement').amountCents, 1);
});

test('rule 9 — devis solde with 7,20 € of tax: 7,20 € on the tax item', () => {
  const { items } = buildVatItems({
    components: [
      { title: 'Séjour et prestations', grossCents: 25624, taxable: true },
      { title: 'Taxe de séjour', grossCents: 720, taxable: false },
    ],
    vatRatePercent: 10,
  });
  assert.equal(items.find((i) => i.title === 'Taxe de séjour').amountCents, 720);
  assert.equal(qontoCharge(items), 25624 + 720);
});

test('rule 9 — the tax item is exact for every stay total from 1 € to 2 000 €', () => {
  for (let stay = 100; stay <= 200000; stay += 1) {
    const { items, expectedTotalCents } = buildVatItems({
      components: [
        { title: 'Séjour', grossCents: stay, taxable: true },
        { title: 'Taxe de séjour', grossCents: 2160, taxable: false },
      ],
      vatRatePercent: 10,
    });
    assert.equal(items.find((i) => i.title === 'Taxe de séjour').amountCents, 2160);
    assert.equal(qontoCharge(items), expectedTotalCents);
  }
});
