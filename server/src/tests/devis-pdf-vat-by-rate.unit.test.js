// specs/pricing-components.md §3 rule 15 (decision D12, class C-E8) — the devis PDF prints a « Récapitulatif TVA » table:
// one row per rate, the same template for one rate or several, and nothing for a « Sans TVA » regime (its legal mention
// is the whole VAT statement). The amounts are the VAT component's, summed per rate (`vatByRateOf`), never recut here.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { generateDevisPdf } = require('../utils/devisPdf');
const { vatByRateOf, vatByRateOfSingleRate } = require('../utils/vatRecap');
const { labels } = require('../utils/devisPdfLabels');

const SUBJECT = { regime: 'subject', rate: 10 };
const NOT_SUBJECT = { regime: 'not_subject', rate: 0, legalMentionText: 'TVA non applicable, art. 293 B du CGI', legalMentionTextEn: 'VAT not applicable' };

function stay(overrides = {}) {
  return {
    accommodationNetPrice: 100, accommodationVatAmount: 10, optionsNetPrice: 0, optionsVatAmount: 0, resourcesNetPrice: 0, resourcesVatAmount: 0,
    vatPercentageAccommodation: 10, vatPercentageOptions: 10, vatPercentageResources: 10, vatRegime: SUBJECT,
    finalPrice: 110, touristTaxTotal: 6, ...overrides,
  };
}

async function textOf(quote, { language = 'fr', vatRegime = quote.vatRegime } = {}) {
  const calls = [];
  const realText = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function patched(text, ...rest) {
    calls.push(String(text));
    return realText.call(this, text, ...rest);
  };
  try {
    const full = {
      id: 1, kind: 'devis', startDate: '2027-07-01', endDate: '2027-07-04', adults: 2, children: 0, babies: 0, finalPrice: quote.finalPrice,
      totalPrice: quote.finalPrice, touristTaxTotal: 6, pdfLanguage: language, vatRegime, client: {}, options: [], resources: [],
    };
    await generateDevisPdf(full, {}, quote);
  } finally {
    PDFDocument.prototype.text = realText;
  }
  return calls;
}

const money = (text) => text.replace(/[  ]/g, ' ');

test('one rate: the table holds one row and a total row that equals it', async () => {
  const quote = stay();
  const text = (await textOf(quote)).map(money);
  assert.ok(text.includes('Récapitulatif TVA'));
  const at = text.indexOf('Récapitulatif TVA');
  assert.deepEqual(text.slice(at + 1, at + 5), ['Taux', 'Base HT', 'TVA', 'TTC']);
  assert.deepEqual(text.slice(at + 5, at + 9), ['10 %', '100,00 €', '10,00 €', '110,00 €']);
  assert.deepEqual(text.slice(at + 9, at + 13), ['Total', '100,00 €', '10,00 €', '110,00 €']);
  assert.ok(text.includes('La taxe de séjour n’est pas soumise à la TVA.'));
});

test('two rates: one row per rate, ascending, and the VAT column adds up to totalVatAmount', async () => {
  const quote = stay({
    optionsNetPrice: 75, optionsVatAmount: 15, resourcesNetPrice: 0, resourcesVatAmount: 0, vatPercentageOptions: 20, vatPercentageResources: 20,
    finalPrice: 200, totalVatAmount: 25,
  });
  const rows = vatByRateOf(quote);
  assert.deepEqual(rows.map((row) => [row.rate, row.base, row.vat, row.ttc]), [[10, 100, 10, 110], [20, 75, 15, 90]]);
  assert.equal(rows.reduce((sum, row) => sum + row.vat, 0), quote.totalVatAmount);
  const text = (await textOf(quote)).map(money);
  const at = text.indexOf('Récapitulatif TVA');
  assert.deepEqual(text.slice(at + 5, at + 9), ['10 %', '100,00 €', '10,00 €', '110,00 €']);
  assert.deepEqual(text.slice(at + 9, at + 13), ['20 %', '75,00 €', '15,00 €', '90,00 €']);
  assert.deepEqual(text.slice(at + 13, at + 17), ['Total', '175,00 €', '25,00 €', '200,00 €']);
});

test('families sharing a rate merge into one row; a family without amount at its own rate prints none', () => {
  const rows = vatByRateOf(stay({ optionsNetPrice: 50, optionsVatAmount: 5, vatPercentageResources: 20 }));
  assert.deepEqual(rows.map((row) => [row.rate, row.label, row.base, row.vat]), [[10, 'TVA 10 %', 150, 15]]);
  assert.equal(vatByRateOf(stay({ vatPercentageAccommodation: 5.5 }))[0].label, 'TVA 5,5 %');
});

test('« Sans TVA »: no VAT table, the legal mention stays', async () => {
  const quote = stay({ vatRegime: NOT_SUBJECT, finalPrice: 110 });
  assert.deepEqual(vatByRateOf(quote), []);
  const text = await textOf(quote);
  assert.ok(!text.includes('Récapitulatif TVA'));
  assert.ok(text.includes(NOT_SUBJECT.legalMentionText));
});

test('English devis: the table is translated', async () => {
  const text = (await textOf(stay(), { language: 'en' })).map(money);
  assert.ok(text.includes(labels('en').vatRecapHeading));
  assert.ok(text.includes('Tourist tax is not subject to VAT.'));
  assert.ok(!text.includes('Récapitulatif TVA'));
});

test('a stored stay keeps one rate: one row from its two totals, none under « Sans TVA »', () => {
  assert.deepEqual(vatByRateOfSingleRate({ regime: SUBJECT, rate: 10, net: 100, vat: 10 }), [{
    rate: 10, label: 'TVA 10 %', base: 100, vat: 10, ttc: 110,
  }]);
  assert.deepEqual(vatByRateOfSingleRate({ regime: NOT_SUBJECT, rate: 0, net: 110, vat: 0 }), []);
});
