const test = require('node:test');
const assert = require('node:assert/strict');

const { generateDevisPdf, __test: { resolveLiveTaxTotals } } = require('../utils/devisPdf');
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

// ── Consistency invariant — the PDF's tourist tax + grand total MUST match the engine
// quote (= PricingSummary) when one is provided. Pins the regression behind PR #112:
// percentage-based tax with a department surcharge would persist 15.36€ on the row but
// the live engine returns 16.80€ — the PDF must show the live figure, not the row. ───
//
// Walkthrough of the user's report:
//   summary: (227.27EUR HT/nuit ÷ 12 occupants) × 5% × 1.10 dep = 1.05€/adulte/nuit
//            → 1.05 × 8 adultes × 2 nuits = 16.80€
//   PDF before fix: 8 × 2 × 0.96 = 15.36€ (no department surcharge in the row total)

test('invariant: PDF tax total mirrors quote.touristTaxTotal when row drifts (user-report scenario)', () => {
  const full = { touristTaxTotal: 15.36, finalPrice: 1000, touristTaxRate: 0.05 };
  const quote = { touristTaxTotal: 16.80, touristTaxUnitAmount: 1.05, touristTaxAdultsCount: 8, touristTaxNights: 2, finalPrice: 1000 };
  const out = resolveLiveTaxTotals(full, quote);
  assert.equal(out.liveTaxTotal, 16.80);
  assert.equal(out.liveFinalPrice, 1000);
  // Grand total must include the LIVE tax, not the stale 15.36 — otherwise the PDF totals
  // would diverge from PricingSummary by exactly the department surcharge (1.44€ here).
  assert.equal(out.grandTotalTtc, 1016.80);
});

test('invariant: quote.finalPrice overrides full.finalPrice (engine is the source of truth)', () => {
  const full = { touristTaxTotal: 6, finalPrice: 900 }; // stale
  const quote = { touristTaxTotal: 6, finalPrice: 1000 };
  const out = resolveLiveTaxTotals(full, quote);
  assert.equal(out.liveFinalPrice, 1000);
  assert.equal(out.grandTotalTtc, 1006);
});

test('fallback: no quote → persisted row values drive the totals (legacy callsite)', () => {
  const full = { touristTaxTotal: 6, finalPrice: 900 };
  const out = resolveLiveTaxTotals(full, null);
  assert.equal(out.liveTaxTotal, 6);
  assert.equal(out.liveFinalPrice, 900);
  assert.equal(out.grandTotalTtc, 906);
});

test('fallback: quote with zero tax → row value wins (engine reported no tax this time)', () => {
  // touristTaxTotal=0 in the quote currently means "engine didn't compute it"; keep the
  // row as the safer fallback to avoid silently zeroing a known-correct persisted tax.
  const full = { touristTaxTotal: 6, finalPrice: 900 };
  const quote = { touristTaxTotal: 0, finalPrice: 900 };
  const out = resolveLiveTaxTotals(full, quote);
  assert.equal(out.liveTaxTotal, 6);
});

test('quote.finalPrice = 0 is honoured (not treated as missing)', () => {
  // An offered stay has finalPrice = 0 — must not silently fall back to the row.
  const full = { touristTaxTotal: 0, finalPrice: 900 };
  const quote = { touristTaxTotal: 0, finalPrice: 0 };
  const out = resolveLiveTaxTotals(full, quote);
  assert.equal(out.liveFinalPrice, 0);
  assert.equal(out.grandTotalTtc, 0);
});
