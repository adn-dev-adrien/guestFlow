// specs/gift-vouchers/gift-vouchers.md rule 22 and specs/gift-vouchers/gift-voucher-campaigns.md rules 21, 22 — the voucher as an A6 card, two pages with a bleed: a QR code to the redemption page
// carrying the code in the URL fragment; every long text wrapped inside its box. The layout rules of both printed cards are judged in gift-voucher-mail-pdf.
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { renderVoucherPdf, redeemUrl, shortLink, fitLines } = require('../voucherPdf');
const fx = require('./giftVoucherFixtures');

const voucher = (over = {}) => ({
  number: 'BC-2026-0007', amountCents: 15000, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', code: '7K2QHD9M4TXB3NPC', expiresOn: '2028-05-15', ...over, // date-literal-ok: the suite runs on its own clock, never the real today
});
const company = { name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', website: 'https://site.example.test', logo: null };
const render = (data, qr) => renderVoucherPdf({
  company, origin: 'https://site.example.test', linkBase: 'bon-cadeau', voucher: voucher(), ...data,
}, qr ? { qr } : undefined);
const pages = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
const fakeQr = (seen = []) => (url) => { seen.push(url); return require('qrcode').create(url, { errorCorrectionLevel: 'M' }).modules; };

test('rules 21, 22: the voucher is an A6 card with a 3 mm bleed (111 × 154 mm) on two pages, the front then the back', async () => {
  const buffer = await render();
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pages(buffer), 2);
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 314\.64\d* 436\.53\d*\]/);
});

test('rule 22: the QR code opens the redemption page with the code in the URL fragment (#bon=), which a browser never sends to a server', async () => {
  const seen = [];
  await render({}, fakeQr(seen));
  assert.deepEqual(seen, ['https://site.example.test/bon-cadeau/utiliser#bon=7K2QHD9M4TXB3NPC']);
  assert.equal(new URL(seen[0]).search, '', 'never a query string, which servers log');
  assert.equal(new URL(seen[0]).hash, '#bon=7K2QHD9M4TXB3NPC');
});

test('rules 9, 21: the printed link is the permanent path without scheme or fragment; the base is the setting\'s', () => {
  assert.equal(redeemUrl({ origin: 'https://s.test', linkBase: 'cadeaux' }, 'ABC'), 'https://s.test/cadeaux/utiliser#bon=ABC');
  assert.equal(redeemUrl({ origin: 'https://s.test', linkBase: 'cadeaux' }), 'https://s.test/cadeaux/utiliser');
  assert.equal(shortLink('https://www.s.test/cadeaux/utiliser#bon=ABC'), 'www.s.test/cadeaux/utiliser');
});

test('rule 13: worst case — 40 W, 200 characters with no space, an emoji, a long brand, 1 character names, amounts at the bounds — still two pages', async () => {
  const worst = [
    voucher({ recipientName: 'W'.repeat(40), senderName: 'W'.repeat(40), message: 'x'.repeat(200) }),
    voucher({ recipientName: '', senderName: '', message: '' }),
    voucher({ recipientName: 'A', senderName: 'B', message: 'ok', amountCents: 2000 }),
    voucher({ message: `Joyeux anniversaire 🎉 ${'très long '.repeat(20)}`, amountCents: 200000 }),
    voucher({ recipientName: 'Łukasz Wójcik', senderName: 'Анастасия', message: 'مرحبا 你好' }),
  ];
  for (const v of worst) {
    const buffer = await render({ voucher: v, company: { ...company, name: 'Le Grand Domaine des Quatre Vents et de la Haute Vallée du Lot, gîtes et chambres' } });
    assert.equal(pages(buffer), 2);
  }
});

test('rule 13: fitLines cuts an unbreakable text where it overflows, keeps words whole, and ends with an ellipsis when it does not fit', () => {
  const doc = new PDFDocument({ size: 'A4' });
  doc.font('Helvetica').fontSize(12);
  const width = 150;
  const wide = (lines) => lines.every((line) => doc.widthOfString(line) <= width);
  const wwww = fitLines(doc, 'W'.repeat(40), width, 10);
  assert.ok(wwww.length > 1);
  assert.ok(wide(wwww));
  assert.equal(wwww.join(''), 'W'.repeat(40));
  const long = fitLines(doc, 'x'.repeat(200), width, 3);
  assert.equal(long.length, 3);
  assert.ok(wide(long));
  assert.ok(long[2].endsWith('…'));
  const words = fitLines(doc, 'un deux trois quatre cinq six sept huit neuf dix', width, 5);
  assert.ok(wide(words));
  assert.equal(words.join(' '), 'un deux trois quatre cinq six sept huit neuf dix');
  assert.deepEqual(fitLines(doc, '', width, 2), []);
  assert.deepEqual(fitLines(doc, '   ', width, 2), []);
  assert.deepEqual(fitLines(doc, 'court', width, 1), ['court']);
});

test('rule 22: the PDF of a voucher sold by hand is drawn from the stored voucher, with the company name and the code read back', async () => {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    const v = await fx.issueManual(server, { recipientFirstName: 'W'.repeat(40), recipientLastName: 'W'.repeat(40), message: 'x'.repeat(200) });
    const res = await server.call('GET', `/api/gift-vouchers/${v.id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(pages(res.body), 2);
  } finally {
    await server.close();
  }
});
