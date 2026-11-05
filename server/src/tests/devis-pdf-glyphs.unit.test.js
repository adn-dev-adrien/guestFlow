// What the devis PDF actually writes, read at the source: every `doc.text` call is recorded with the
// face that draws it, so a glyph the face lacks, a wrapped line printed over the next one or a row that
// does not add up is caught without rasterising the page.
//   specs/tariff-events-and-extra-guest-tiers/spec.md §6 — the extra-guest row names the count only
//     (reading of 2026-11-05: prod printed « 1ʳᵉ » as « 1+1Ô’ àuit »).
//   specs/ui-review-2026-10-19-operations.md rules 46, 47, 48.
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

const { generateDevisPdf, __test } = require('../utils/devisPdf');
const { printableText, formatQuantity } = __test;

// Dates far out on purpose: the renderer only prints them, nothing compares them with today.
function devis(overrides = {}) {
  return {
    kind: 'devis', devisStatus: 'sent', devisNumber: '2099-01-001', createdAt: '2099-01-05 10:00:00', validUntil: '2099-02-04',
    startDate: '2099-07-10', endDate: '2099-07-13', checkInTime: '16:00', checkOutTime: '10:00',
    adults: 4, children: 0, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 300, customPrice: null, discountPercent: 0, finalPrice: 362,
    touristTaxTotal: 7.92, depositAmount: 0, balanceAmount: 369.92, balanceDueDate: '2099-06-10', cautionAmount: 0,
    property: { id: 2, name: "L'Estiva" }, client: { firstName: 'Jo', lastName: 'Ng' },
    options: [], resources: [],
    nights: ['2099-07-10', '2099-07-11', '2099-07-12'].map((date) => ({ date, price: 100, seasonLabel: 'Haute', pricingMode: 'night' })),
    ...overrides,
  };
}
const SETTINGS = { companyName: 'Domaine Test', companyIban: 'FR76 0000', companyBic: 'QNTOFRP1XXX', companyBankName: 'TEST' };
const TIERED_QUOTE = {
  finalPrice: 362, touristTaxTotal: 7.92, touristTaxAdultsCount: 4, touristTaxNights: 3, touristTaxUnitAmount: 0.66,
  extraGuestSurchargeOriginal: 62, extraGuestSurcharge: 62, extraGuestSurchargeOffered: false, extraGuestCount: 2,
  extraGuestTiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
};

// Renders and answers every text call: its text, the face's glyph coverage of it, its box.
async function render(full, settings = SETTINGS, quote = null) {
  const calls = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recordText(text, x, y, options) {
    const opts = (typeof x === 'object' && x !== null ? x : options) || {};
    const str = String(text == null ? '' : text);
    const left = typeof x === 'number' ? x : this.x;
    const top = typeof y === 'number' ? y : this.y;
    const width = opts.width != null ? opts.width : this.page.width - this.page.margins.right - left;
    const face = this._font;
    const missing = [...str].filter((ch) => ch !== '\n').filter((ch) => {
      const cp = ch.codePointAt(0);
      return face.font ? !face.font.hasGlyphForCodePoint(cp) : face.characterToGlyph(cp) === '.notdef';
    });
    calls.push({
      text: str, x: left, y: top, width, face: face.name, size: this._fontSize, missing,
      height: this.heightOfString(str, { ...opts, width, continued: false }),
    });
    return original.apply(this, arguments);
  };
  try {
    await generateDevisPdf(full, settings, quote);
  } finally {
    PDFDocument.prototype.text = original;
  }
  return calls;
}

const money = (text) => Number(String(text).replace(' €', '').replace(',', '.'));

test('§6 (2026-11-05) — the extra-guest row reads the count only, in French and in English', async () => {
  const fr = await render(devis({ pdfLanguage: 'fr' }), SETTINGS, TIERED_QUOTE);
  assert.ok(fr.some((c) => c.text === 'Surcoût voyageurs (2 pers. au-delà du tarif de base)'));
  const en = await render(devis({ pdfLanguage: 'en' }), SETTINGS, TIERED_QUOTE);
  assert.ok(en.some((c) => c.text === 'Extra-guest supplement (2 guests above the base rate)'));
  for (const c of [...fr, ...en]) {
    assert.ok(!/[ʳᵉ]|la 1|puis 8/.test(c.text), `no tier phrase on the page: « ${c.text} »`);
  }
});

test('§6 — the Estiva quote adds up: rows = sub-total = finalPrice, total = sub-total + tax, page-1 total = total', async () => {
  const calls = await render(devis({ pdfLanguage: 'fr' }), SETTINGS, TIERED_QUOTE);
  const header = calls.findIndex((c) => c.text === 'Total TTC');
  const subtotalAt = calls.findIndex((c) => c.text === 'Sous-total TTC');
  const totalColumn = calls[header].x;
  const rows = calls.slice(header + 1, subtotalAt)
    .filter((c) => c.x === totalColumn && c.size === 9 && /Semibold/.test(c.face)).map((c) => money(c.text));
  assert.deepEqual(rows, [300, 62]);
  const subtotal = money(calls[subtotalAt + 1].text);
  const tax = money(calls[calls.findIndex((c) => c.text === 'Taxe de séjour') + 1].text);
  const total = money(calls[calls.findIndex((c) => c.text === 'TOTAL TTC') + 1].text);
  assert.equal(subtotal, 362);
  assert.equal(Math.round((subtotal + tax) * 100) / 100, total);
  assert.equal(money(calls.find((c) => c.size === 18).text), total);
});

test('rule 46 — pasted direction marks, joiners, odd spaces, tabs and carriage returns never print as boxes', async () => {
  const calls = await render(devis({
    pdfLanguage: 'fr',
    client: {
      firstName: '‪Jo‬', lastName: 'Ng‎', phone: '‪+33 6 12 34 56 78‬', email: 'jo‍@example.org',
      street: 'rue des Lilas bât. B', postalCode: '69000', city: 'Lyon⁠',
    },
    options: [{ optionId: 1, title: 'Ménage\tfin de séjour‏', quantity: 1, billedUnits: 1, totalPrice: 10, offered: 0 }],
    finalPrice: 372,
  }), { ...SETTINGS, companyAddress: '1 chemin des Écureuils\r\n07290 Satillieu', quoteFooterText: 'Merci !\r\nÀ bientôt.' }, null);
  const boxes = calls.filter((c) => c.missing.length)
    .map((c) => `${c.face}: ${c.missing.map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase()}`).join(' ')}`);
  assert.deepEqual(boxes, []);
  assert.ok(calls.some((c) => c.text === 'Tél : +33 6 12 34 56 78'));
  assert.ok(calls.some((c) => c.text === 'Ménage fin de séjour'));
});

test('rule 46 — the text keeps what the face draws, and rule 29 still prints an uncovered script in place', () => {
  assert.equal(printableText('a\r\nb\rc d e'), 'a\nb\nc\nd\ne');
  assert.equal(printableText('x\ty z w　v'), 'x y z w v');
  assert.equal(printableText('‪‫‬‭‮⁦⁧⁨⁩‎‏‌‍⁠\u0007ok'), 'ok');
  // Kept: no-break and narrow no-break spaces, soft hyphen, ordinals, guillemets, euro.
  assert.equal(printableText('10 h « 1ʳᵉ » 2ᵉ 15,00 € co­op'), '10 h « 1ʳᵉ » 2ᵉ 15,00 € co­op');
  assert.equal(printableText('山田 😀 שלום'), '山田 😀 שלום');
});

test('rule 47 — a quantity prints rounded to the cent, with the decimal mark of the language', async () => {
  assert.equal(formatQuantity(1 / 3, 'fr'), '0,33');
  assert.equal(formatQuantity(2.5, 'en'), '2.5');
  assert.equal(formatQuantity(3, 'fr'), '3');
  assert.equal(formatQuantity('', 'fr'), '');
  const calls = await render(devis({
    pdfLanguage: 'fr', adults: 2, finalPrice: 320,
    options: [
      { optionId: 1, title: 'Électricité (kWh)', quantity: 1 / 3, billedUnits: 1 / 3, unitPrice: 30, totalPrice: 10, offered: 0 },
      { optionId: 2, title: 'Bois (stères)', quantity: 2.5, billedUnits: 2.5, unitPrice: 4, totalPrice: 10, offered: 0 },
    ],
  }));
  const qtyColumn = calls.find((c) => c.text === 'Qté').x;
  const quantities = calls.filter((c) => c.x === qtyColumn && c.size === 9).map((c) => c.text);
  assert.deepEqual(quantities, ['3', '0,33', '2,5']);
});

test('rule 48 — a long bank account name wraps inside the frame and pushes the BIC down', async () => {
  const calls = await render(devis({ pdfLanguage: 'fr', adults: 2, finalPrice: 300 }), {
    ...SETTINGS, companyBankName: `Banque ${'Anticonstitutionnellement'.repeat(3)} et associés`,
  });
  const account = calls.find((c) => c.text.startsWith('Dénomination du compte'));
  const bic = calls.find((c) => c.text.startsWith('BIC'));
  const iban = calls.find((c) => c.text.startsWith('IBAN'));
  assert.ok(account.height > 13, 'the account name wraps');
  assert.ok(bic.y >= account.y + account.height, 'the BIC starts below the last line of the account name');
  assert.ok(iban.y >= bic.y + bic.height);
  // The frame runs from LEFT − 4 over (PAGE_W − 220) − 14 points: 4 points of padding inside it.
  const frameInnerRight = 45 + (595.28 - 90 - 220) - 18;
  for (const line of [account, bic, iban]) assert.ok(line.x + line.width <= frameInnerRight + 0.01);
});
