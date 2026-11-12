// specs/pricing-components.md §3 rules 31, 51, 62 — saleDetail: one payload, every amount in cents and every label French; the VAT is
// cut per (class, rate) group and shared over the lines by largest remainder, a catalogue article may carry its own class.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSaleDetail } = require('../utils/saleDetail');

const regime = { regime: 'subject', rate: 10 };
const quote = (extra = {}) => ({
  nights: 3, finalPrice: 400, touristTaxTotal: 6, vatRegime: regime, preArrivalAmount: 336, resolvedComplementAmount: 70, endOfStayComplementTotal: 0,
  optionLines: [
    { optionId: 1, title: 'Bain nordique', quantity: 1, totalPrice: 40, inComplement: 1 },
    { optionId: 2, title: 'Panier', quantity: 2, totalPrice: 30, inComplement: 1, discountCents: 500, grossTotalPrice: 35 },
    { optionId: 3, title: 'Cadeau', quantity: 1, totalPrice: 0, offered: true, originalTotalPrice: 20 },
  ],
  resourceLines: [{ resourceId: 4, name: 'Vélo', quantity: 1, totalPrice: 30, inComplement: 0 }],
  ...extra,
});

test('rule 31 — the payload carries the stay lines first, then the sold lines with their status and moment', () => {
  const detail = buildSaleDetail({ quote: quote(), facts: { 'opt:2': { source: 'shop', collectAt: 'departure', lineId: 7, table: 'option' } }, phase: 'during' });
  assert.deepEqual(detail.lines.map((l) => [l.label, l.totalCents]), [['Hébergement', 30000], ['Taxe de séjour', 600], ['Bain nordique', 4000], ['Panier', 3000], ['Cadeau', 0], ['Vélo', 3000]]);
  const byLabel = Object.fromEntries(detail.lines.map((l) => [l.label, l]));
  assert.deepEqual([byLabel.Panier.sourceLabel, byLabel.Panier.statusLabel, byLabel.Panier.momentLabel, byLabel.Panier.ref], ['Boutique', 'À payer au départ', 'Au départ', 'option:7']);
  assert.deepEqual([byLabel['Bain nordique'].statusLabel, byLabel.Cadeau.statusLabel, byLabel['Vélo'].statusLabel], ['À payer à l’arrivée', 'Offerte', 'Dans l’acompte et le solde']);
  assert.deepEqual([byLabel.Panier.grossCents, byLabel.Panier.discountCents], [3500, 500]);
  assert.equal(detail.phase, 'during');
  assert.deepEqual(detail.buckets, { plan: 33600, arrival: 7000, departure: 0 });
});

test('rule 21 — a line whose allocations cover its due amount reads « Payée le jj/mm »', () => {
  const detail = buildSaleDetail({ quote: quote(), facts: { 'opt:1': { lineId: 3, table: 'option', settledCents: 4000, paidAt: '2026-11-12' } } });
  const paid = detail.lines.find((l) => l.label === 'Bain nordique');
  assert.deepEqual([paid.status, paid.statusLabel], ['paid', 'Payée le 12/11']);
  assert.equal(detail.totals.settledCents, 4000);
  assert.equal(detail.totals.dueCents, detail.totals.totalCents - 4000);
});

test('rule 17 — on a platform stay a line outside the complement is inside the platform price', () => {
  const detail = buildSaleDetail({ quote: quote(), platformStay: true });
  assert.equal(detail.lines.find((l) => l.label === 'Vélo').statusLabel, 'Comprise dans le prix plateforme');
  assert.equal(detail.lines.find((l) => l.label === 'Bain nordique').statusLabel, 'À payer à l’arrivée');
});

test('rules 51, 62 — the VAT is cut once per (class, rate) group and shared over its lines to the cent', () => {
  const detail = buildSaleDetail({ quote: quote({ touristTaxTotal: 0 }), vatClassOf: (line, kind) => (kind === 'resource' ? 'resources' : 'options') });
  const taxable = detail.lines.filter((l) => l.vat.rate > 0);
  const groupVat = Math.round((7000 * 10) / 110);
  assert.equal(taxable.filter((l) => l.kind === 'option').reduce((sum, l) => sum + l.vat.vatCents, 0), groupVat);
  for (const line of taxable) assert.equal(line.vat.vatCents + line.vat.netCents, line.totalCents);
  assert.ok(detail.totals.vatByRate.length >= 1);
});

test('rule 51 — an article of the class « outOfScope » carries no VAT, and a franchise regime none at all', () => {
  const out = buildSaleDetail({ quote: quote(), vatClassOf: (line) => (line.optionId === 1 ? 'outOfScope' : 'options') });
  assert.deepEqual(out.lines.find((l) => l.label === 'Bain nordique').vat, { rate: 0, vatCents: 0, netCents: 4000 });
  const franchise = buildSaleDetail({ quote: quote({ vatRegime: { regime: 'not_subject', rate: 0 } }), vatClassOf: () => 'options' });
  assert.ok(franchise.lines.every((l) => l.vat.vatCents === 0));
});
