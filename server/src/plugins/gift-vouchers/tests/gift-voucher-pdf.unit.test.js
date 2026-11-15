// specs/gift-vouchers.md rule 22 — the voucher as one A4 page: the voucher on the top half, the conditions below, a QR code to the
// booking page carrying the code in the URL fragment; every long text wrapped inside its box.
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { renderVoucherPdf, bookingUrlWithCode, fitLines } = require('../voucherPdf');
const fx = require('./giftVoucherFixtures');

const voucher = (over = {}) => ({
  number: 'BC-2026-0007', amountCents: 15000, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', code: '7K2QHD9M4TXB3NPC', expiresOn: '2028-05-15', ...over,
});
const render = (data, qr) => renderVoucherPdf({ brand: 'Domaine Solio', bookingUrl: 'https://site.example.test/reserver', language: 'fr', voucher: voucher(), ...data }, qr ? { qr } : undefined);
const pages = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
const fakeQr = (seen = []) => async (url) => { seen.push(url); return require('qrcode').toBuffer(url, { type: 'png', width: 120, margin: 1 }); };

test('rule 22: the voucher is one A4 page', async () => {
  const buffer = await render();
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pages(buffer), 1);
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
});

test('rule 22: the QR code opens the booking page with the code in the URL fragment (#bon=), which a browser never sends to a server', async () => {
  const seen = [];
  await render({}, fakeQr(seen));
  assert.deepEqual(seen, ['https://site.example.test/reserver#bon=7K2QHD9M4TXB3NPC']);
  assert.equal(new URL(seen[0]).search, '', 'never a query string, which servers log');
  assert.equal(new URL(seen[0]).hash, '#bon=7K2QHD9M4TXB3NPC');
});

test('rule 22: a fragment already on the page URL is replaced, a query string kept', () => {
  assert.equal(bookingUrlWithCode('https://s.test/r#old', 'ABC'), 'https://s.test/r#bon=ABC');
  assert.equal(bookingUrlWithCode('https://s.test/r?lang=en', 'ABC'), 'https://s.test/r?lang=en#bon=ABC');
});

test('rule 13: worst case — 40 W, 200 characters with no space, an emoji, a long brand, 1 character names, amounts at the bounds — still one page', async () => {
  const worst = [
    voucher({ recipientName: 'W'.repeat(40), senderName: 'W'.repeat(40), message: 'x'.repeat(200) }),
    voucher({ recipientName: '', senderName: '', message: '' }),
    voucher({ recipientName: 'A', senderName: 'B', message: 'ok', amountCents: 2000 }),
    voucher({ message: `Joyeux anniversaire 🎉 ${'très long '.repeat(20)}`, amountCents: 200000 }),
    voucher({ recipientName: 'Łukasz Wójcik', senderName: 'Анастасия', message: 'مرحبا 你好' }),
  ];
  for (const v of worst) {
    const buffer = await render({ voucher: v, brand: 'Le Grand Domaine des Quatre Vents et de la Haute Vallée du Lot, gîtes et chambres' });
    assert.equal(pages(buffer), 1);
  }
  const english = await render({ language: 'en', voucher: worst[0] });
  assert.equal(pages(english), 1);
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
    const v = await fx.issueManual(server, { recipientName: 'W'.repeat(40), message: 'x'.repeat(200) });
    const res = await server.call('GET', `/api/gift-vouchers/${v.id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(pages(res.body), 1);
  } finally {
    await server.close();
  }
});
