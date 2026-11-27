// specs/gift-vouchers/gift-voucher-campaigns.md rules 21, 49 and specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 21, 26 (fix of 2026-11-27) — the front keeps
// the visual's proportions: it covers the trim, never the bleed box, the bleed mirrors its edges, a card of a print sheet has no mirror; the price is a translucent fir medallion.
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
const campaign = { slug: 'bain-nordique', validityMonths: 18, frontPricePosition: 'top-right' };
const base = { origin: 'https://site.example.test', linkBase: 'bon-cadeau' };

async function recorded(run) {
  const names = ['image', 'transform', 'circle', 'fillOpacity', 'fillColor', 'text', 'rect', 'restore'];
  const calls = Object.fromEntries(names.map((name) => [name, []]));
  const original = {};
  names.forEach((name) => {
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

const near = (a, b, tolerance = 0.5) => Math.abs(a - b) < tolerance;
const TRIM = { left: 8 * MM, right: (8 + 105) * MM, top: 8 * MM, bottom: (8 + 148) * MM };
/** The reflections about an edge of a merchant card's trim (pdfkit's own flips of images and text are about other lines). */
const mirrors = (calls) => calls.transform.filter(([a, , , d, e, f]) => (a === -1 && [TRIM.left, TRIM.right].some((edge) => near(e, 2 * edge)))
  || (d === -1 && [TRIM.top, TRIM.bottom].some((edge) => near(f, 2 * edge))));

test('rule 21 — an A6 visual is drawn exactly on the 105 × 148 mm trim, at its proportions: nothing of it is lost at the cut', async () => {
  const front = await picture(1240, 1748);
  const { calls } = await recorded(() => pdf.renderMerchantCardPdf({ campaign, front, company, ...base }));
  const [, x, y, size] = calls.image[calls.image.length - 1];
  const trim = (5 + 3) * MM;
  assert.ok(near(x, trim) && near(y, trim), `at the trim's corner, not the bleed's: ${x}, ${y}`);
  assert.ok(near(size.width, 105 * MM) && near(size.height, 148 * MM), `the trim's size: ${size.width} × ${size.height}`);
});

test('rule 21 — a visual of the 2 % the library admits keeps its proportions: it covers the trim, never stretched', async () => {
  const front = await picture(1312, 1819);
  const { calls } = await recorded(() => pdf.renderMerchantCardPdf({ campaign, front, company, ...base }));
  const [, , , size] = calls.image[calls.image.length - 1];
  assert.ok(near(size.width / size.height, 1312 / 1819, 0.001), 'the picture\'s own ratio');
  assert.ok(near(size.height, 148 * MM) && size.width >= 105 * MM - 0.01, 'the trim covered, the height fitted');
  assert.ok(size.width <= 105 * MM * 1.02, 'at most the 2 % of the library cropped');
});

test('rule 49 — the 3 mm bleed of a single card mirrors the visual\'s edges round the trim; a card of a print sheet, clipped to its trim, draws no mirror', async () => {
  const front = await picture(1240, 1748);
  const single = await recorded(() => pdf.renderMerchantCardPdf({ campaign, front, company, ...base }));
  const reflections = mirrors(single.calls);
  assert.equal(reflections.length, 8, 'four sides and four corners');
  const trimLeft = (5 + 3) * MM;
  const trimRight = trimLeft + 105 * MM;
  const lines = new Set(reflections.filter(([a]) => a === -1).map(([, , , , e]) => Math.round(e / 2)));
  assert.deepEqual([...lines].sort((m, n) => m - n), [Math.round(trimLeft), Math.round(trimRight)], 'mirrored about the trim\'s left and right edges');
  assert.equal(single.calls.image.length, 9, 'the picture, then eight mirrored copies of it');
  const bleed = { left: 5 * MM, right: (5 + 111) * MM, top: 5 * MM, bottom: (5 + 154) * MM };
  const strips = single.calls.rect.filter(([x, y, w, h]) => near(x, bleed.left) || near(x + w, bleed.right) || near(y, bleed.top) || near(y + h, bleed.bottom));
  assert.ok(strips.length >= 8, `every mirrored strip reaches the bleed's edge: ${strips.length}`);
  const layout = printLayout.plan({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'left-right' }).layout;
  const sheet = await recorded(() => pdf.renderPrintSheets({ layout, title: 'm', draw: pdf.merchantDrawing({ campaign, front, company, ...base }) }));
  assert.equal(mirrors(sheet.calls).length, 0);
  assert.equal(sheet.calls.image.length, 4, 'one picture per front');
});

test('rule 21 (week-weekend) — the price is a round fir medallion at 60 %, its words in white, inside the safe area', async () => {
  const front = await picture(1240, 1748);
  const { calls } = await recorded(() => pdf.renderMerchantCardPdf({
    campaign, front, company, ...base, fromCents: 5000,
  }));
  const [cx, cy, r] = calls.circle[0]; // the front is drawn first; the back's numbered discs follow
  const safeRight = (5 + 3 + 105 - 5) * MM;
  const safeTop = (5 + 3 + 5) * MM;
  assert.ok(near(cx + r, safeRight) && near(cy - r, safeTop), 'in the top-right corner of the safe area');
  assert.ok(calls.fillOpacity.some(([opacity]) => opacity === pdf.FRONT_PRICE_DISC.opacity && opacity === 0.6), 'translucent: the visual shows through');
  const white = calls.fillColor.filter(([color]) => color === '#ffffff').length;
  assert.ok(white >= 2, '« à partir de » and the price in white');
  assert.ok(calls.text.some(([str]) => str === '50 €') && calls.text.some(([str]) => str === 'à partir de'));
  const order = (name, match) => calls[name].findIndex(match);
  const priceAt = calls.text.findIndex(([str]) => str === '50 €');
  assert.ok(calls.fillColor.findIndex(([color]) => color === '#ffffff') > -1 && order('fillOpacity', ([o]) => o === 0.6) > -1 && priceAt > -1);
});
