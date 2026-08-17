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

// ── Consistency invariant — specs/devis-pdf-total-parity.md §3.2 rules 6-10.
//
// Two things must hold at once, and the second one used to break the first:
//   (a) the grand total is the stay the table PRINTED plus the tax printed above it — always;
//   (b) the tax mirrors the engine quote (= PricingSummary) whenever that quote speaks for the
//       document it is printed on, i.e. its finalPrice reproduces the printed stay.
//
// (b) pins PR #112: percentage-based tax with a department surcharge persisted 15.36€ on the row
// while the live engine returned 16.80€ — the PDF must show the live figure.
//   summary: (227.27EUR HT/nuit ÷ 12 occupants) × 5% × 1.10 dep = 1.05€/adulte/nuit
//            → 1.05 × 8 adultes × 2 nuits = 16.80€
//   PDF before that fix: 8 × 2 × 0.96 = 15.36€ (no department surcharge in the row total)
//
// (a) pins the 2026-08-17 report: a re-quote of a DIFFERENT pricing state (offered option re-billed,
// price lock ignored) printed « TOTAL TTC 595,00 € » under a « Sous-total TTC 523,92 € ».

test('invariant: PDF tax total mirrors quote.touristTaxTotal when the row drifts (PR #112 scenario)', () => {
  const full = { touristTaxTotal: 15.36, finalPrice: 1000, touristTaxRate: 0.05 };
  const quote = { touristTaxTotal: 16.80, touristTaxUnitAmount: 1.05, touristTaxAdultsCount: 8, touristTaxNights: 2, finalPrice: 1000 };
  // The quote reproduces the 1000 € of stay the table printed → it speaks for this document.
  const out = resolveLiveTaxTotals(full, quote, 1000);
  assert.equal(out.quoteReconciles, true);
  assert.equal(out.liveTaxTotal, 16.80);
  assert.equal(out.liveFinalPrice, 1000);
  // Grand total must include the LIVE tax, not the stale 15.36 — otherwise the PDF totals
  // would diverge from PricingSummary by exactly the department surcharge (1.44€ here).
  assert.equal(out.grandTotalTtc, 1016.80);
});

test('invariant: a quote that does NOT reproduce the printed rows never reaches the totals', () => {
  // The user-reported devis: rows print 523.92 (persisted lines), the re-quote says 583.92 because it
  // re-billed a 60 € offered option and lost its tourist-tax deduction. The document must ignore it.
  const full = { touristTaxTotal: 9.60, finalPrice: 523.92 };
  const quote = { touristTaxTotal: 11.08, finalPrice: 583.92 };
  const out = resolveLiveTaxTotals(full, quote, 523.92);
  assert.equal(out.quoteReconciles, false);
  assert.equal(out.liveTaxTotal, 9.60);
  assert.equal(out.liveFinalPrice, 523.92);
  assert.equal(out.grandTotalTtc, 533.52); // never 595.00
});

test('invariant: the grand total is always the printed rows + the printed tax', () => {
  // Even a reconciling quote can't move the total away from the lines: liveFinalPrice IS the rows.
  const full = { touristTaxTotal: 6, finalPrice: 900 };
  const quote = { touristTaxTotal: 6, finalPrice: 900.004 }; // sub-cent noise still reconciles
  const out = resolveLiveTaxTotals(full, quote, 900);
  assert.equal(out.quoteReconciles, true);
  assert.equal(out.liveFinalPrice, 900);
  assert.equal(out.grandTotalTtc, 906);
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
  const out = resolveLiveTaxTotals(full, quote, 900);
  assert.equal(out.liveTaxTotal, 6);
});

test('offered stay: rows sum to 0 → the total is the tax alone', () => {
  const full = { touristTaxTotal: 6, finalPrice: 900 }; // row kept a price, the lines are offered
  const quote = { touristTaxTotal: 6, finalPrice: 0 };
  const out = resolveLiveTaxTotals(full, quote, 0);
  assert.equal(out.liveFinalPrice, 0);
  assert.equal(out.grandTotalTtc, 6);
});
