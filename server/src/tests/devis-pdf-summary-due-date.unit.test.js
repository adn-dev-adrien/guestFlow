// The page-1 summary of a devis (specs/ui-review-2026-10-19-operations.md rule 19): « due by 25 September
// 2026 » is wider than its column in English and used to run over the amount of the next line. It now
// shrinks to fit; a date that already fits is drawn at the usual size.

const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { generateDevisPdf } = require('../utils/devisPdf');

const devis = (lang, due) => ({
  devisNumber: '2026-09-001', startDate: '2026-10-10', endDate: '2026-10-13', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct', totalPrice: 300, finalPrice: 300, touristTaxTotal: 0,
  depositAmount: 100, depositDueDate: due, balanceAmount: 200, balanceDueDate: due, pdfLanguage: lang,
  property: { id: 1, name: 'Villa A' }, client: { id: 1, firstName: 'Jane', lastName: 'Smith' }, options: [], resources: [],
  nights: [{ date: '2026-10-10', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 }, { date: '2026-10-11', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 }, { date: '2026-10-12', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 }],
});

async function sizesOfDueDates(lang, due) {
  const realText = PDFDocument.prototype.text;
  const sizes = [];
  PDFDocument.prototype.text = function patched(text, ...rest) {
    if (/^(due by|avant le)/.test(String(text))) sizes.push({ size: this._fontSize, fits: this.widthOfString(String(text)) });
    return realText.call(this, text, ...rest);
  };
  try {
    await generateDevisPdf(devis(lang, due), { companyName: 'Co' });
  } finally {
    PDFDocument.prototype.text = realText;
  }
  return sizes;
}

test('a long English due date shrinks to fit its column', async () => {
  const sizes = await sizesOfDueDates('en', '2026-09-25');
  assert.ok(sizes.length >= 2);
  assert.ok(sizes[0].size < 9, `size ${sizes[0].size}`);
});

test('a date that fits keeps the usual size (French, or a short English date)', async () => {
  assert.ok((await sizesOfDueDates('fr', '2026-09-25')).every((s) => s.size === 9));
  assert.ok((await sizesOfDueDates('en', '2026-06-03')).every((s) => s.size === 9));
});
