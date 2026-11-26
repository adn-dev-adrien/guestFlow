// specs/pricing/pricing-components.md §3 rule 91 — owner 2026-11-15 « Brancher quand même », read with « éviter de toucher les anciens séjours »:
// a new link on a stay booked once 4.2.0 is installed names the lines its sale detail collects in the acompte and the solde, each at
// its own rate, for exactly the bucket's amount; a stay booked before (and every link already minted) keeps its basket.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const { saleLineComponents, storedLinkComponents } = require('../utils/storedLinkComponents');
const { buildVatItems } = require('../utils/paymentLinkItems');
const { __test: payments } = require('../controllers/paymentsController');

const TITLES = { deposit: 'Acompte séjour', balance: 'Solde séjour', full: 'Paiement séjour' };
const line = (kind, label, totalCents, extra = {}) => ({ kind, label, totalCents, collectAt: 'plan', settledCents: 0, offered: false, vat: { rate: 10 }, ...extra });
const DETAIL = {
  lines: [
    line('accommodation', 'Hébergement', 30000),
    line('touristTax', 'Taxe de séjour', 400, { vat: { rate: 0 } }),
    line('option', 'Ménage', 6000),
    line('option', 'Panier', 2500, { offered: true, totalCents: 0 }),
    line('resource', 'Bain nordique', 4000, { collectAt: 'arrival' }),
    line('option', 'Vin', 1800, { settledCents: 1800 }),
  ],
};
const stayRow = { depositAmount: 108, balanceAmount: 254, finalPrice: 358, touristTaxTotal: 4, touristTaxAddedGuestsAmount: 0 };

test('rule 91 — the bucket is shared over the plan lines still owed, by largest remainder, for its exact amount', () => {
  const stored = storedLinkComponents(stayRow, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES });
  const basket = saleLineComponents(stored, DETAIL);
  assert.deepEqual(basket.components.map((c) => c.title), ['Solde séjour — Hébergement', 'Solde séjour — Ménage', 'Taxe de séjour']);
  const taxable = stored.components[0].grossCents;
  assert.equal(basket.components[0].grossCents + basket.components[1].grossCents, taxable);
  assert.equal(basket.components[0].grossCents, Math.round((taxable * 30000) / 36000));
  const items = buildVatItems(basket);
  assert.equal(items.expectedTotalCents, buildVatItems(stored).expectedTotalCents);
});

test('rule 91 — one line to share over keeps the basket as it is; no detail keeps it too', () => {
  const stored = storedLinkComponents(stayRow, 'full', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES });
  assert.equal(saleLineComponents(stored, { lines: [line('accommodation', 'Hébergement', 30000)] }), stored);
  assert.equal(saleLineComponents(stored, null), stored);
});

test('rule 91 — each share is cut at its line\'s own rate', () => {
  const { items } = buildVatItems({
    components: [
      { title: 'Solde séjour — Hébergement', grossCents: 11000, taxable: true, vatRatePercent: 10 },
      { title: 'Solde séjour — Vin', grossCents: 1200, taxable: true, vatRatePercent: 20 },
    ],
    vatRatePercent: 10,
  });
  assert.deepEqual(items.map((i) => [i.amountCents, i.vatRate]), [[10000, 10], [1000, 20]]);
});

test('rule 91 (2026-11-15) — a stay booked before 4.2.0 keeps its basket; a stay booked after reads its sale lines', () => {
  const stored = storedLinkComponents(stayRow, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES });
  let read = 0;
  const detailOf = () => { read += 1; return DETAIL; };
  assert.equal(payments.onSaleLines({ id: 1, readsSaleLines: 0 }, stored, detailOf), stored);
  assert.equal(read, 0);
  assert.equal(payments.onSaleLines({ id: 1, readsSaleLines: 1 }, stored, detailOf).components.length, 3);
  assert.equal(payments.onSaleLines({ id: 1, readsSaleLines: 1 }, stored, () => { throw new Error('no quote'); }), stored);
});
