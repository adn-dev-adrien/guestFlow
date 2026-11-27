// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 21 (G19) — the plain front of a card with no picture: the company's name on up to three centred lines inside the safe area,
// the type shrinking until all of it fits, never one line running off the card.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const pdf = require('../voucherPdf');
const code = require('../code');

const MM = 72 / 25.4;
const SAFE_WIDTH = (105 - 2 * 5) * MM;

async function frontLinesOf(name) {
  const drawn = [];
  let frontEnds = null;
  let pages = 0;
  const original = PDFDocument.prototype.text;
  const originalAddPage = PDFDocument.prototype.addPage;
  PDFDocument.prototype.addPage = function recordedPage(...args) {
    pages += 1;
    // The first page is the document's own (its constructor adds it): the second marks the end of the front.
    if (pages === 2) frontEnds = drawn.length;
    return originalAddPage.apply(this, args);
  };
  PDFDocument.prototype.text = function recorded(...args) {
    drawn.push({ text: String(args[0]), width: this.widthOfString(String(args[0])), size: this._fontSize });
    return original.apply(this, args);
  };
  try {
    await pdf.renderVoucherPdf({
      voucher: {
        number: 'BC-1', code: code.generate(), amountCents: 9000, senderName: 'Claire', recipientName: 'Julien', message: '', expiresOn: '2028-05-27', // date-literal-ok: a fixed expiry the card prints
        contents: JSON.stringify({ kind: 'lodging' }),
      },
      front: null,
      company: { name, town: 'Satillieu', department: 'Ardèche', website: 'https://domainesolio.com', logo: null },
      origin: 'https://domainesolio.com',
      linkBase: 'bon-cadeau',
    });
  } finally {
    PDFDocument.prototype.text = original;
    PDFDocument.prototype.addPage = originalAddPage;
  }
  // The front is the first page: what is drawn before the second page is added.
  return drawn.slice(0, frontEnds);
}

test('a 60-character company name is set on at most three centred lines inside the safe area, whole', async () => {
  const name = 'Domaine des Hautes Terres de la Montagne Ardéchoise Sources';
  assert.equal(name.length, 59);
  const lines = await frontLinesOf(`${name}x`);
  assert.ok(lines.length >= 2 && lines.length <= 3, `${lines.length} lines`);
  lines.forEach((line) => assert.ok(line.width <= SAFE_WIDTH + 0.5, `« ${line.text} » is ${line.width} wide, the safe width ${SAFE_WIDTH}`));
  assert.equal(lines.map((l) => l.text).join(' '), `${name}x`, 'nothing is cut');
});

test('a short name keeps its full size on one line', async () => {
  const lines = await frontLinesOf('Domaine Solio');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].size, 22);
});

test('a blank company name draws nothing on the front and throws nothing (L5)', async () => {
  for (const name of ['', '   ', null, undefined]) {
    const lines = await frontLinesOf(name);
    assert.deepEqual(lines, [], JSON.stringify(name));
  }
});
