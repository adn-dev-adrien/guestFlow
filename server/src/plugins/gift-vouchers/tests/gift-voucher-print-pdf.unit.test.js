// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 21, 24, 47 — print sheets: the picture and the logo are embedded once per document, a card of a sheet is the same crop
// of its front as the single PDF's, no text is wrapped by pdfkit under another, and the front price label holds both its lines.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['gift-vouchers'])) return;

const pdf = require('../voucherPdf');
const printLayout = require('../printLayout');
const { picture } = require('./visualFixtures');

const MM = 72 / 25.4;
const company = {
  name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', department: 'Lot', website: 'https://site.example.test', logo: null,
};
const campaign = { slug: 'bain-nordique', validityMonths: 18, frontPricePosition: 'bottom-right' };
const base = { origin: 'https://site.example.test', linkBase: 'bon-cadeau' };

async function recorded(run) {
  const calls = { text: [], image: [], roundedRect: [] };
  const original = {};
  Object.keys(calls).forEach((name) => {
    original[name] = PDFDocument.prototype[name];
    PDFDocument.prototype[name] = function recordedCall(...args) {
      calls[name].push(args);
      return original[name].apply(this, args);
    };
  });
  try {
    return { result: await run(), calls };
  } finally {
    Object.entries(original).forEach(([name, fn]) => { PDFDocument.prototype[name] = fn; });
  }
}

const countImages = (buffer) => (buffer.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

test('F8 — an 8-card print embeds the front picture once, and a logo once more', async () => {
  const front = await picture(1300, 1832, { format: 'jpeg', background: '#aa5500' });
  const logo = await picture(300, 300, { format: 'jpeg', background: '#336699' });
  const layout = printLayout.plan({ mode: 'recto-verso', perSheet: 4, count: 8, flip: 'left-right' }).layout;
  const buffer = await pdf.renderPrintSheets({
    layout, title: 'm', draw: pdf.merchantDrawing({
      campaign, front, company: { ...company, logo }, ...base, fromCents: 5000,
    }),
  });
  assert.equal(countImages(buffer), 2, 'one front, one logo, however many cards');
});

test('F16 — a card of a print sheet crops its front like the single PDF: the picture covers the bleed box, not only the trim', async () => {
  const front = await picture(1300, 1832, { format: 'jpeg', background: '#aa5500' });
  const widthOf = (calls) => calls.image.map(([, , , options]) => options.width);
  const single = await recorded(() => pdf.renderMerchantCardPdf({
    campaign, front, company, ...base, fromCents: null,
  }));
  const layout = printLayout.plan({ mode: 'recto-verso', perSheet: 1, count: 1, flip: 'left-right' }).layout;
  const sheet = await recorded(() => pdf.renderPrintSheets({ layout, title: 'm', draw: pdf.merchantDrawing({ campaign, front, company, ...base }) }));
  assert.ok(Math.abs(widthOf(single.calls)[0] - widthOf(sheet.calls)[0]) < 0.01, 'the same picture size on the single card and on the sheet card');
  assert.ok(widthOf(sheet.calls)[0] >= (105 + 6) * MM - 0.01, 'it covers the bleed box (105 mm + 2 × 3 mm), the sheet clips it to the trim');
});

test('F24 — no text is drawn with a width: pdfkit would wrap a long hyphenated link under the next line', async () => {
  const long = { ...campaign, slug: 'un-tres-long-nom-de-bon-cadeau-avec-beaucoup-de-mots-separes-par-des-tirets-pour-voir' };
  const { calls } = await recorded(() => pdf.renderMerchantCardPdf({
    campaign: long, front: null, company: { ...company, name: 'Un domaine au nom très long qui ne tient pas sur une seule ligne de la carte' }, ...base, fromCents: 5000,
  }));
  assert.deepEqual(calls.text.filter(([, , , options]) => options && options.width !== undefined).map(([str]) => str), []);
  const link = calls.text.find(([str]) => /un-tres-long-nom/.test(String(str)));
  assert.ok(link, 'the link is printed');
});

test('F25 — the front price label is tall enough for « à partir de » and the price, with its padding', async () => {
  const front = await picture(1300, 1832, { format: 'jpeg', background: '#aa5500' });
  const { calls } = await recorded(() => pdf.renderMerchantCardPdf({
    campaign, front, company, ...base, fromCents: 5000,
  }));
  const label = calls.roundedRect.find(([, , w, h, radius]) => radius > 5 && h < 60 && w < 120);
  assert.ok(label, 'the label is drawn');
  const lines = pdf.BACK_LAYOUT.pt.frontSmall + pdf.BACK_LAYOUT.pt.frontPrice;
  assert.ok(label[3] >= lines * 1.1 + 2 * 2 * MM, `height ${label[3]} holds both lines and the padding`);
});
