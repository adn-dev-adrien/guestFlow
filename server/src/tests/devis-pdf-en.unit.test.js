// Bilingual devis PDF — render smoke + fallback resolution.
//
// PDFKit encodes glyph indexes, so a rendered PDF can't be grep'd for English / French text.
// Instead, we:
//   1. Smoke-test that EN renders produce a valid PDF buffer (no exception, correct magic).
//   2. Smoke-test that FR + EN render to DIFFERENT buffers (proves the language plumbs through).
//   3. Unit-test the pure resolvers (`resolveOptionTitle`, `resolveResourceName`,
//      `resolveFooterText`) which the renderer is shown to call — see specs §3 rules 6, 7, 11.

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateDevisPdf, __test } = require('../utils/devisPdf');
const { resolveOptionTitle, resolveResourceName, resolveFooterText } = __test;
const { labels } = require('../utils/devisPdfLabels');

const EN_DEFAULT_FOOTER = labels('en').defaultFooter;
const FR_DEFAULT_FOOTER = labels('fr').defaultFooter;

function baseDevis(overrides = {}) {
  return {
    devisNumber: '2026-06-EN-001',
    startDate: '2026-06-10', endDate: '2026-06-13', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 1, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 300, customPrice: null, discountPercent: 0, finalPrice: 380,
    touristTaxRate: 1.5, touristTaxTotal: 9,
    depositAmount: 100, depositDueDate: '2026-05-15',
    balanceAmount: 280, balanceDueDate: '2026-06-03',
    cautionAmount: 500, notes: '',
    pdfLanguage: 'fr',
    property: {
      id: 1, name: 'Villa A', checkInTime: '15:00', checkOutTime: '10:00',
      depositPercent: 30, depositDaysBefore: 30, balanceDaysBefore: 7,
    },
    client: { id: 1, firstName: 'Jane', lastName: 'Smith', phone: '+44 7700 900000', email: 'jane@example.co.uk', city: 'London', postalCode: 'SW1A 1AA', streetNumber: '10', street: 'Downing Street' },
    options: [],
    resources: [],
    nights: [
      { date: '2026-06-10', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
      { date: '2026-06-11', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
      { date: '2026-06-12', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
    ],
    ...overrides,
  };
}

const SETTINGS = {
  companyName: 'GuestFlow Demo', companyEmail: 'demo@guestflow.test', companyPhone: '+33102030405',
  companyAddress: '1 Rue Demo', companySiret: '12345678900012', companyTva: 'FR40123456789',
  companyIban: 'FR7612345678901234567890123', companyBic: 'ABCDEFGH', companyBankName: 'Demo Bank',
  vatRate: 10, quoteValidityDays: 30,
  quoteFooterText: 'Merci de votre confiance.',
  quoteFooterTextEn: 'Thank you for choosing us.',
};

// ---- pure resolvers ----

test('resolveOptionTitle: EN uses titleEn when set, falls back to FR title when empty', () => {
  const opt = { optionId: 1, title: 'Ménage', titleEn: 'Cleaning' };
  assert.equal(resolveOptionTitle(opt, 'en'), 'Cleaning');
  assert.equal(resolveOptionTitle(opt, 'fr'), 'Ménage');

  const noEn = { optionId: 2, title: 'Petit-déjeuner', titleEn: '' };
  assert.equal(resolveOptionTitle(noEn, 'en'), 'Petit-déjeuner', 'falls back to FR title');
  assert.equal(resolveOptionTitle(noEn, 'fr'), 'Petit-déjeuner');

  const whitespaceEn = { optionId: 3, title: 'Sauna', titleEn: '   ' };
  assert.equal(resolveOptionTitle(whitespaceEn, 'en'), 'Sauna', 'whitespace-only titleEn treated as empty');

  const noTitle = { optionId: 4, title: '', titleEn: '' };
  assert.equal(resolveOptionTitle(noTitle, 'en'), 'Option #4', 'fallback for missing FR title');
});

test('resolveResourceName: EN uses nameEn when set, falls back to FR name when empty', () => {
  const rsc = { resourceId: 1, name: 'Lit bébé', nameEn: 'Baby bed' };
  assert.equal(resolveResourceName(rsc, 'en'), 'Baby bed');
  assert.equal(resolveResourceName(rsc, 'fr'), 'Lit bébé');

  const noEn = { resourceId: 2, name: 'Spa', nameEn: '' };
  assert.equal(resolveResourceName(noEn, 'en'), 'Spa', 'falls back to FR name');

  const noName = { resourceId: 3, name: '', nameEn: '' };
  assert.equal(resolveResourceName(noName, 'en'), 'Resource #3', 'fallback for missing FR name');
});

test('resolveFooterText: each language uses its own custom footer, else its own default — no cross-bleed', () => {
  // EN custom footer wins.
  assert.equal(
    resolveFooterText({ quoteFooterText: 'FR custom', quoteFooterTextEn: 'EN custom' }, 'en', EN_DEFAULT_FOOTER, FR_DEFAULT_FOOTER),
    'EN custom',
  );
  // FR custom footer wins.
  assert.equal(
    resolveFooterText({ quoteFooterText: 'FR custom', quoteFooterTextEn: 'EN custom' }, 'fr', EN_DEFAULT_FOOTER, FR_DEFAULT_FOOTER),
    'FR custom',
  );
  // No EN custom → static EN default, FR custom does NOT leak in.
  assert.equal(
    resolveFooterText({ quoteFooterText: 'FR custom', quoteFooterTextEn: '' }, 'en', EN_DEFAULT_FOOTER, FR_DEFAULT_FOOTER),
    EN_DEFAULT_FOOTER,
  );
  // No FR custom → static FR default, EN custom does NOT leak in.
  assert.equal(
    resolveFooterText({ quoteFooterText: '', quoteFooterTextEn: 'EN custom' }, 'fr', EN_DEFAULT_FOOTER, FR_DEFAULT_FOOTER),
    FR_DEFAULT_FOOTER,
  );
  // Whitespace-only treated as empty.
  assert.equal(
    resolveFooterText({ quoteFooterTextEn: '   \n  ' }, 'en', EN_DEFAULT_FOOTER, FR_DEFAULT_FOOTER),
    EN_DEFAULT_FOOTER,
  );
});

// ---- render smoke ----

test('FR render: emits a valid PDF buffer for a baseline devis', async () => {
  const buf = await generateDevisPdf(baseDevis(), SETTINGS);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000, `expected a meaningful PDF (got ${buf.length} bytes)`);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('EN render: emits a valid PDF buffer (no exception on the bilingual code path)', async () => {
  const buf = await generateDevisPdf(baseDevis({ pdfLanguage: 'en' }), SETTINGS);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('FR and EN renders produce DIFFERENT buffers — language plumbed end-to-end', async () => {
  const frBuf = await generateDevisPdf(baseDevis({ pdfLanguage: 'fr' }), SETTINGS);
  const enBuf = await generateDevisPdf(baseDevis({ pdfLanguage: 'en' }), SETTINGS);
  assert.notEqual(Buffer.compare(frBuf, enBuf), 0,
    'FR and EN PDFs must differ — same buffer means the language toggle is a no-op');
});

test('language defaults to FR when pdfLanguage is missing / null / empty', async () => {
  const noLang  = await generateDevisPdf(baseDevis({ pdfLanguage: undefined }), SETTINGS);
  const explicitFr = await generateDevisPdf(baseDevis({ pdfLanguage: 'fr' }), SETTINGS);
  // The two PDFs are functionally identical (default→fr). They differ at most in PDF object
  // ids if pdfkit is non-deterministic; assert on buffer length being equal as a signal.
  assert.equal(noLang.length, explicitFr.length, 'undefined language renders identically to fr');

  const emptyLang = await generateDevisPdf(baseDevis({ pdfLanguage: '' }),   SETTINGS);
  assert.equal(emptyLang.length, explicitFr.length);
  const nullLang  = await generateDevisPdf(baseDevis({ pdfLanguage: null }), SETTINGS);
  assert.equal(nullLang.length, explicitFr.length);
});

test('unknown language fails loud (renderer rejects via labels())', async () => {
  await assert.rejects(
    generateDevisPdf(baseDevis({ pdfLanguage: 'de' }), SETTINGS),
    /unknown language/i,
  );
});

test('EN render with a translated option produces a different buffer than EN with empty titleEn', async () => {
  // Same data, only difference is the operator's EN translation on the option line.
  // The buffer must change because the rendered string changes — proof the renderer is reading titleEn.
  const withEn = await generateDevisPdf(baseDevis({
    pdfLanguage: 'en',
    options: [
      { optionId: 1, title: 'Ménage', titleEn: 'Cleaning', priceType: 'per_stay',
        quantity: 1, billedUnits: 1, unitPrice: 80, totalPrice: 80, originalTotalPrice: 80, offered: 0, isCustom: 0 },
    ],
  }), SETTINGS);
  const withoutEn = await generateDevisPdf(baseDevis({
    pdfLanguage: 'en',
    options: [
      { optionId: 1, title: 'Ménage', titleEn: '', priceType: 'per_stay',
        quantity: 1, billedUnits: 1, unitPrice: 80, totalPrice: 80, originalTotalPrice: 80, offered: 0, isCustom: 0 },
    ],
  }), SETTINGS);
  assert.notEqual(Buffer.compare(withEn, withoutEn), 0,
    'titleEn must affect the rendered output (proves the EN→FR fallback is real)');
});
