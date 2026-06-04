const test = require('node:test');
const assert = require('node:assert/strict');

const { generateDevisPdf } = require('../utils/devisPdf');
const { __test: { computeValidUntil } } = require('../models/devisModel');

// Non-regression coverage for specs/devis-pdf-and-tourist-tax-fixes.md.
// PDF content streams are FlateDecode-compressed by PDFKit so asserting on text inside
// the binary is unreliable; instead we (a) unit-test the pure date helper that drives
// "Valable jusqu'au" and (b) smoke-generate the PDF for every scenario the spec calls
// out — a render-time exception is the regression we'd care most about.

function sampleDevis(over = {}) {
  return {
    devisNumber: '2026-06-001', status: 'draft',
    createdAt: '2026-06-04 10:30:00', validUntil: '2026-07-04',
    startDate: '2099-09-15', endDate: '2099-09-17', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 1, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 200, customPrice: null, discountPercent: 0, finalPrice: 200,
    touristTaxRate: 1, touristTaxTotal: 6,
    depositAmount: 60, depositDueDate: '2099-08-16', balanceAmount: 140, balanceDueDate: '2099-09-08',
    cautionAmount: 500, notes: 'Merci',
    property: { id: 1, name: 'Villa A', checkInTime: '15:00', checkOutTime: '10:00' },
    client: { id: 1, firstName: 'Jean', lastName: 'Dupont', phone: '', address: '', email: '', city: '', postalCode: '' },
    options: [], resources: [], nights: [],
    ...over,
  };
}

// ── computeValidUntil (the same function the model uses to persist + the PDF uses as
// the legacy-row fallback) — rules 6 + 9 + cap. ────────────────────────────────────

test('computeValidUntil: createdAt + days, well below the startDate cap', () => {
  const v = computeValidUntil({ createdAtIsoDate: '2026-06-04', startDateIso: '2099-09-15', quoteValidityDays: 30 });
  assert.equal(v, '2026-07-04');
});

test('computeValidUntil: caps at startDate - 2 when the natural date overshoots', () => {
  const v = computeValidUntil({ createdAtIsoDate: '2026-06-04', startDateIso: '2026-06-10', quoteValidityDays: 90 });
  assert.equal(v, '2026-06-08');
});

test('computeValidUntil: invalid startDate is silently ignored (no cap)', () => {
  const v = computeValidUntil({ createdAtIsoDate: '2026-06-04', startDateIso: 'not-a-date', quoteValidityDays: 30 });
  assert.equal(v, '2026-07-04');
});

test('computeValidUntil: zero quoteValidityDays → same day as createdAt', () => {
  const v = computeValidUntil({ createdAtIsoDate: '2026-06-04', startDateIso: '2099-09-15', quoteValidityDays: 0 });
  assert.equal(v, '2026-06-04');
});

// ── PDF render smoke — every branch the spec mentions must not throw and must produce
// a valid PDF buffer. ─────────────────────────────────────────────────────────────────

async function assertValidPdf(buf) {
  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 500, `expected non-trivial PDF size, got ${buf.length}`);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-', 'expected the PDF magic header');
}

test('rule 4: empty createdAt does not throw (legacy fallback to today)', async () => {
  const buf = await generateDevisPdf(sampleDevis({ createdAt: '', validUntil: '2099-09-13' }), { quoteValidityDays: 30 });
  await assertValidPdf(buf);
});

test('rule 9: empty validUntil does not throw (legacy recompute from createdAt)', async () => {
  const buf = await generateDevisPdf(sampleDevis({ validUntil: '' }), { quoteValidityDays: 30 });
  await assertValidPdf(buf);
});

test('rule 9 cap: empty validUntil + tight startDate → cap path does not throw', async () => {
  const buf = await generateDevisPdf(
    sampleDevis({ validUntil: '', startDate: '2026-06-10', endDate: '2026-06-12' }),
    { quoteValidityDays: 90 },
  );
  await assertValidPdf(buf);
});

test('rule 16+17: tourist tax detail uses quote breakdown without throwing', async () => {
  const quote = { touristTaxTotal: 6, touristTaxUnitAmount: 1.5, touristTaxAdultsCount: 2, touristTaxNights: 2 };
  const buf = await generateDevisPdf(sampleDevis(), { quoteValidityDays: 30 }, quote);
  await assertValidPdf(buf);
});

test('rule 16 fallback: quote omitted → falls back to row-derived without throwing', async () => {
  const buf = await generateDevisPdf(sampleDevis({ adults: 2, children: 1, teens: 0 }), { quoteValidityDays: 30 });
  await assertValidPdf(buf);
});

test('rule 18: touristTaxTotal = 0 → skip block without throwing', async () => {
  const buf = await generateDevisPdf(sampleDevis({ touristTaxTotal: 0 }), { quoteValidityDays: 30 });
  await assertValidPdf(buf);
});
