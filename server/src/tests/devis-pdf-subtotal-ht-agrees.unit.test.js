// specs/pricing-components.md §3 rules 15 and 65 — on a devis PDF, « Sous-total HT » IS the base total of the « Récapitulatif TVA » printed below it:
// the VAT is cut once per rate group, never again row by row (three rows of 1,05 € at 10 % add up to 2,85 € HT one by one, 2,86 € cut once).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { generateDevisPdf } = require('../utils/devisPdf');

const SUBJECT = { regime: 'subject', rate: 10 };

async function printed(quote, full) {
  const calls = [];
  const realText = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function patched(text, ...rest) {
    calls.push(String(text).replace(/[  ]/g, ' '));
    return realText.call(this, text, ...rest);
  };
  try {
    await generateDevisPdf(full, {}, quote);
  } finally {
    PDFDocument.prototype.text = realText;
  }
  return calls;
}

test('rule 65 — three rows that round apart: Sous-total HT equals the recap’s base total', async () => {
  const row = (title) => ({ title, quantity: 1, unitPrice: 1.05, totalPrice: 1.05, billedUnits: 1, priceType: 'per_stay' });
  const quote = {
    accommodationNetPrice: 0, accommodationVatAmount: 0, optionsNetPrice: 2.86, optionsVatAmount: 0.29, resourcesNetPrice: 0, resourcesVatAmount: 0,
    vatPercentageAccommodation: 10, vatPercentageOptions: 10, vatPercentageResources: 10, vatRegime: SUBJECT, finalPrice: 3.15, touristTaxTotal: 0,
  };
  const full = {
    id: 1, kind: 'devis', startDate: '2027-07-01', endDate: '2027-07-02', adults: 2, children: 0, babies: 0, finalPrice: 3.15, totalPrice: 0,
    touristTaxTotal: 0, pdfLanguage: 'fr', vatRegime: SUBJECT, client: {}, options: [row('A'), row('B'), row('C')], resources: [],
  };
  const text = await printed(quote, full);
  const recap = text.indexOf('Récapitulatif TVA');
  assert.ok(recap > 0, 'the recap is printed');
  const total = text.indexOf('Total', recap);
  const recapBase = text[total + 1];
  const subtotalAt = text.indexOf('Sous-total HT');
  assert.ok(subtotalAt >= 0);
  assert.equal(text[subtotalAt + 1], recapBase, 'one cut, one figure');
  assert.equal(recapBase, '2,86 €');
});
