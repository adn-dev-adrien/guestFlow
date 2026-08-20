const test = require('node:test');
const assert = require('node:assert/strict');

const PDFDocument = require('pdfkit');

const { generateDevisPdf, __test } = require('../utils/devisPdf');
const { resolveRowGeometry } = __test;

// specs/devis-pdf-row-layout.md — a pricing-table row is as tall as what it prints. PDFKit encodes
// text as glyph indexes, so the rendered bytes can't be inspected: the geometry is proven here, on
// the pure resolver the renderer feeds its measured heights to.

// The very heights the renderer measures: one designation line, one badge / struck-original line.
const probe = new PDFDocument();
const LINE_9PT = probe.font('Helvetica').fontSize(9).heightOfString('0', { width: 200 });
const LINE_75PT = probe.font('Helvetica-Bold').fontSize(7.5).heightOfString('OFFERT', { width: 200 });

test('a plain row keeps the label and the amount on the same line', () => {
  const g = resolveRowGeometry({ descHeight: LINE_9PT, moneyLineHeight: LINE_9PT });
  assert.equal(g.lineY, g.amountY);
  assert.ok(g.rowH >= g.lineY + LINE_9PT, 'the row must contain its single line');
});

test('a designation that wraps grows the row instead of spilling out of it', () => {
  const one = resolveRowGeometry({ descHeight: LINE_9PT, moneyLineHeight: LINE_9PT });
  const three = resolveRowGeometry({ descHeight: LINE_9PT * 3, moneyLineHeight: LINE_9PT });
  // The two extra lines are added to the row, not printed over the next one (± the rounding to a
  // whole point the resolver applies to the row height).
  assert.ok(Math.abs((three.rowH - one.rowH) - LINE_9PT * 2) < 1);
  assert.ok(three.rowH >= three.lineY + LINE_9PT * 3, 'the row must contain all three lines');
});

test('an « Offert » badge takes its own line above the label, with breathing room', () => {
  const plain = resolveRowGeometry({ descHeight: LINE_9PT, moneyLineHeight: LINE_9PT });
  const badged = resolveRowGeometry({ descHeight: LINE_9PT, badgeHeight: LINE_75PT, moneyLineHeight: LINE_9PT });
  assert.ok(badged.lineY >= badged.badgeY + LINE_75PT + 4, 'at least 4pt between the badge and the label');
  assert.ok(badged.rowH > plain.rowH, 'the badge makes the row taller, it does not overprint the label');
  assert.ok(badged.rowH >= badged.lineY + LINE_9PT, 'the row must still contain the label');
});

test('a struck original prints above the billed amount, both inside the row', () => {
  const g = resolveRowGeometry({
    descHeight: LINE_9PT, moneyLineHeight: LINE_9PT, struckLineHeight: LINE_75PT, showOriginal: true,
  });
  assert.equal(g.amountY, g.lineY + LINE_75PT, 'the billed amount sits one struck line below the original');
  assert.ok(g.rowH >= g.amountY + LINE_9PT, 'the row must contain both money lines');
});

test('the tallest column drives the row height — a long offered label included', () => {
  const label = resolveRowGeometry({
    descHeight: LINE_9PT * 3, badgeHeight: LINE_75PT, moneyLineHeight: LINE_9PT,
    struckLineHeight: LINE_75PT, showOriginal: true,
  });
  assert.ok(label.rowH >= label.lineY + LINE_9PT * 3, 'a 3-line label fits');
  assert.ok(label.rowH >= label.amountY + LINE_9PT, 'the struck + billed money block fits too');

  // …and when the money column is the taller one, it drives the height instead.
  const money = resolveRowGeometry({
    descHeight: LINE_9PT, moneyLineHeight: LINE_9PT, struckLineHeight: LINE_75PT, showOriginal: true,
  });
  assert.ok(money.rowH >= money.amountY + LINE_9PT);
});

test('an empty designation still yields a usable row', () => {
  const g = resolveRowGeometry();
  assert.ok(g.rowH > 0 && g.lineY > 0 && g.amountY === g.lineY);
});

test('a devis whose option labels wrap renders without throwing', async () => {
  const longTitle = "Location du linge de toilette pour l'ensemble des voyageurs, serviettes et draps de bain compris";
  const devis = {
    devisNumber: '2026-08-050',
    startDate: '2099-06-01', endDate: '2099-06-03', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 0, teens: 0, babies: 0,
    totalPrice: 200, finalPrice: 280, touristTaxRate: 1, touristTaxTotal: 3.2,
    property: { id: 1, name: 'Villa A' },
    client: { id: 1, firstName: 'Jean', lastName: 'Dupont' },
    options: [
      { optionId: 1, title: longTitle, priceType: 'per_person', quantity: 4, billedUnits: 4, unitPrice: 20, totalPrice: 80, offered: 0 },
      { optionId: 2, title: longTitle, priceType: 'per_person', quantity: 4, billedUnits: 4, unitPrice: 20, totalPrice: 0, offered: 1 },
    ],
    resources: [],
    nights: [
      { date: '2099-06-01', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
      { date: '2099-06-02', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
    ],
  };
  const buf = await generateDevisPdf(devis, { companyName: 'My Co', vatRate: 10 });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
