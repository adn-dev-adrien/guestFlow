// specs/ui-review-2026-10-19-operations.md rules 27-30 — every word of the quote PDF is drawn by an
// embedded face that covers the guest's alphabet (owner decision 2026-10-20). PDFKit encodes text as
// glyph indexes, so coverage is proven on the font files themselves (fontkit) and the embedding on
// the uncompressed document's font dictionary.
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { generateDevisPdf, __test } = require('../utils/devisPdf');
const { faceHasGlyph, serifRuns, FACES, fitFontSize, nextLineY } = __test;

const SETTINGS = { companyName: 'Domaine Łąka Nguyễn', companyAddress: 'Lieu-dit Ogliastru', vatRate: 10 };

const NAMES = {
  polish: 'Łukasz Wójcik, Żółć Gęślą Jaźń',
  turkish: 'Çağrı Yılmaz, İstanbul Şişli Öğüt',
  czech: 'Antonín Dvořák, Řeřicha Ůžasná Ťěšín',
  vietnamese: 'Nguyễn Thị Ánh, Trương Hoàng Phượng, Đường Lê Thánh Tôn',
  greek: 'Γιώργος Παπαδόπουλος, Αθήνα Ϊΰ',
  cyrillic: 'Анастасия Кузнецова, Москва Ёлкина Ґудзь Їжак Ўладзімір',
};
const UNCOVERED = '山田太郎 東京 · שלום · مرحبا · สวัสดี · 😀';

function devis(overrides = {}) {
  return {
    kind: 'devis', devisStatus: 'sent', devisNumber: '2026-10-042', createdAt: '2026-10-20', validUntil: '2026-11-19',
    startDate: '2027-07-10', endDate: '2027-07-17', checkInTime: '16:00', checkOutTime: '10:00',
    adults: 2, children: 0, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 300, customPrice: null, discountPercent: 0, finalPrice: 300,
    touristTaxTotal: 9, depositAmount: 92.7, depositDueDate: '2026-10-27', balanceAmount: 216.3, balanceDueDate: '2027-06-10',
    cautionAmount: 0, property: { id: 1, name: 'Aventura lodge' }, client: { firstName: 'Jo', lastName: 'Ng' },
    options: [], resources: [], nights: [],
    ...overrides,
  };
}

const letters = (text) => [...text].filter((ch) => /\p{L}|\p{M}/u.test(ch));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const baseFonts = (buf) => [...new Set(buf.toString('latin1').match(/\/BaseFont \/[^\s/]+/g) || [])]
  .map((f) => f.replace(/^\/BaseFont \/([A-Z]{6}\+)?/, ''));

test('rule 27 — a quote naming guests in six alphabets renders with the embedded faces only', async () => {
  const names = Object.values(NAMES);
  const buf = await generateDevisPdf(devis({
    __testCompress: false,
    client: { firstName: names[0], lastName: names[1], street: names[2], city: names[3], email: 'x@example.pl' },
    property: { id: 1, name: names[4] },
    options: [{ optionId: 1, title: names[5], quantity: 1, totalPrice: 10, offered: 0 }],
  }), SETTINGS, null);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(baseFonts(buf).sort(), ['SourceSans3-It', 'SourceSans3-Regular', 'SourceSans3-Semibold', 'SourceSerif4-Semibold']);
  assert.ok(!/\/BaseFont \/(Helvetica|Times)/.test(buf.toString('latin1')), 'no PDF standard font left in the document');
});

test('rule 27 — every face covers Latin Extended-A, Vietnamese, modern Greek and Cyrillic in full', () => {
  const ranges = {
    'Latin Extended-A': range(0x100, 0x17F),
    'Romanian comma below': range(0x218, 0x21B),
    Vietnamese: [...range(0x1EA0, 0x1EF9), 0x1A0, 0x1A1, 0x1AF, 0x1B0, 0x110, 0x111],
    'modern Greek': range(0x386, 0x3CE).filter((cp) => /\p{L}/u.test(String.fromCodePoint(cp))),
    Cyrillic: range(0x400, 0x45F),
    'euro and typography': [0x20AC, 0x2019, 0x201C, 0x201D, 0x2013, 0x2014, 0x2026, 0xA0, 0x202F],
  };
  for (const role of ['regular', 'bold', 'italic']) {
    for (const [name, cps] of Object.entries(ranges)) {
      const missing = cps.filter((cp) => !faceHasGlyph(role, cp)).map((cp) => String.fromCodePoint(cp));
      assert.deepEqual(missing, [], `${FACES[role].name} misses ${name}`);
    }
  }
});

test('rules 27, 28 — every letter of the six sample names is drawable by the body faces and by the titles', () => {
  for (const [language, text] of Object.entries(NAMES)) {
    for (const ch of letters(text)) {
      const cp = ch.codePointAt(0);
      for (const role of ['regular', 'bold', 'italic']) assert.ok(faceHasGlyph(role, cp), `${language} « ${ch} » in ${role}`);
      assert.ok(faceHasGlyph('serif', cp) || faceHasGlyph('bold', cp), `${language} « ${ch} » in a title`);
    }
  }
});

test('rule 29 — CJK, Hebrew, Arabic, Thai and emoji never throw nor drop the line', async () => {
  for (const ch of letters('山שم ส')) assert.equal(faceHasGlyph('regular', ch.codePointAt(0)), false, 'no embedded CJK / RTL / Thai font');
  const events = [];
  const buf = await generateDevisPdf(devis({
    __testCompress: false,
    __trace: (e) => events.push(e),
    client: { firstName: UNCOVERED, lastName: 'Cohen', city: UNCOVERED },
    property: { id: 1, name: `Lodge ${UNCOVERED}` },
    options: [{ optionId: 1, title: `Option ${UNCOVERED}`, quantity: 1, totalPrice: 10, offered: 0 }],
  }), { ...SETTINGS, companyName: `Domaine ${UNCOVERED}` }, null);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.equal(events.length, 1, 'the document is drawn to its page-1 summary');
  assert.equal(events[0].total, 309);
  assert.ok(!/\/BaseFont \/(Helvetica|Times)/.test(buf.toString('latin1')), 'no standard font comes back for them');
  // The serif keeps the whole text, uncovered characters included, in one run.
  assert.equal(serifRuns(`Domaine ${UNCOVERED}`).map((r) => r.text).join(''), `Domaine ${UNCOVERED}`);
});

test('rule 30 — a long text shrinks to its box, down to a floor, and a wrapped line pushes the next one', () => {
  const doc = new PDFDocument();
  const registered = FACES.serif.name;
  doc.registerFont(registered, FACES.serif.file);
  assert.equal(fitFontSize(doc, registered, 'Domaine', 300, 20, 13), 20);
  const long = 'Société Civile Immobilière du Domaine de Łąka-Çiftlik et Nguyễn';
  const fitted = fitFontSize(doc, registered, long, 300, 20, 13);
  assert.ok(fitted < 20 && fitted >= 13);
  assert.ok(fitted === 13 || doc.font(registered).fontSize(fitted).widthOfString(long) <= 300);
  assert.equal(fitFontSize(doc, registered, long.repeat(3), 300, 20, 13), 13, 'never below the floor');

  doc.registerFont(FACES.regular.name, FACES.regular.file);
  doc.font(FACES.regular.name).fontSize(9);
  assert.equal(nextLineY(doc, 'Jo Ng', 100, 170, 13), 113);
  const wrapped = nextLineY(doc, 'Grzegorz Łukasz Çağrı Wójcik-Yılmaz Dvořák Nguyễn', 100, 120, 13);
  assert.ok(wrapped > 113, 'the wrapped name pushes the address down');
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;

test('rule 27 — an empty, truncated or non-font file falls back to the standard face; the quote still renders', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-fonts-'));
  const empty = path.join(dir, 'empty.otf.woff2');
  const truncated = path.join(dir, 'truncated.otf.woff2');
  const random = path.join(dir, 'random.otf');
  fs.writeFileSync(empty, Buffer.alloc(0));
  fs.writeFileSync(truncated, fs.readFileSync(FACES.regular.file).subarray(0, 2048));
  fs.writeFileSync(random, Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)));
  try {
    const faces = {
      serif: { ...FACES.serif, file: random },
      regular: { ...FACES.regular, file: empty },
      bold: { ...FACES.bold, file: truncated },
      italic: FACES.italic,
    };
    const names = __test.registerFaces(new PDFDocument(), faces);
    assert.deepEqual(names, { serif: 'Times-Bold', regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'MaisonSansItalic' });
    const buf = await generateDevisPdf(devis({ __testCompress: false, __testFaces: faces }), SETTINGS, null);
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
    const fonts = baseFonts(buf);
    for (const standard of ['Times-Bold', 'Helvetica', 'Helvetica-Bold']) assert.ok(fonts.includes(standard), `${standard} replaces the unreadable file`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 28 — the runs use the serif the document registered, never a hard-coded standard face', () => {
  assert.deepEqual(serifRuns('世 Solio', { serif: 'Times-Bold', bold: 'Helvetica-Bold' }), [{ font: 'Times-Bold', text: '世 Solio' }]);
  // A standard bold is never borrowed for a glyph the serif lacks: only the embedded sans is.
  assert.deepEqual(serifRuns('Ŧarik', { serif: 'MaisonSerif', bold: 'Helvetica-Bold' }), [{ font: 'MaisonSerif', text: 'Ŧarik' }]);
});

test('rule 30 — a very long company name: two header lines at most, one footer line, no spurious page', async () => {
  const doc = new PDFDocument();
  doc.registerFont(FACES.serif.name, FACES.serif.file);
  doc.font(FACES.serif.name).fontSize(13);
  const name = 'Société Civile Immobilière du Domaine de Łąka-Çiftlik et Nguyễn Phượng, Gîtes, Tentes Safari et Bains Nordiques de Haute-Corse';
  const clamped = __test.clampToLines(doc, name, 280, 2);
  assert.ok(clamped.endsWith('…') && clamped.length < name.length);
  const line = doc.heightOfString('0', { width: 280 });
  assert.ok(doc.heightOfString(clamped, { width: 280 }) <= line * 2 + 0.5, 'two lines at most');
  assert.equal(__test.clampToLines(doc, 'Domaine', 280, 2), 'Domaine', 'a short name is untouched');

  const short = await generateDevisPdf(devis({ __testCompress: false }), SETTINGS, null);
  const long = await generateDevisPdf(devis({ __testCompress: false }), { ...SETTINGS, companyName: name }, null);
  assert.equal(pageCount(long), pageCount(short), 'the footer name never pushes PDFKit onto a new page');
});
