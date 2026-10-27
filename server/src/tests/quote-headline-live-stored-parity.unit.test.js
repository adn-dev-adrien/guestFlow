// specs/ui-review-2026-10-19-operations.md rules 31-32 (audit 2026-10-27) — the live quote and the
// stored row print the same headline, and the summary's cascade is served by the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { quoteHeadline, storedNetTotal } = require('../utils/quoteHeadline');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

const stored = (row) => quoteHeadline({
  finalPrice: row.finalPrice, touristTaxTotal: row.touristTaxTotal, platformTouristTaxWithheld: null,
  endOfStayComplementTotal: row.endOfStayComplementAmount || 0, midStayRemainingTotal: 0,
  sejourNetTotal: storedNetTotal(row),
}, { isPlatform: row.platform !== 'direct' });

test('Airbnb brut 500, tax handled by the platform: 500 live and stored (was 506 live)', () => {
  const db = pricingAuditDb({ touristTax: 1, platforms: [{ name: 'Airbnb', collects: 1, remits: 1 }] });
  const q = calculateReservationQuote({ ...STAY, db, platform: 'Airbnb', platformGrossAmount: 500 });
  const row = { platform: 'Airbnb', finalPrice: q.finalPrice, touristTaxTotal: q.touristTaxTotal, depositAmount: q.depositAmount, balanceAmount: q.balanceAmount, complementAmount: q.complementAmount };
  assert.deepEqual(q.headline, { label: 'Vous percevez', amount: 500, secondary: { label: 'Total du séjour', amount: 500 } });
  assert.deepEqual(stored(row), q.headline);
  assert.deepEqual(q.summaryCascade, { grossTotal: 500, offeredTaxDeduction: 0, onSiteTotal: 0, commissionBase: 500 });
});

test('a withheld tax stated by the operator is in the gross and is the cascade\'s deduction', () => {
  const db = pricingAuditDb({ touristTax: 1, platforms: [{ name: 'Airbnb', collects: 1, remits: 1 }] });
  const q = calculateReservationQuote({ ...STAY, db, platform: 'Airbnb', platformGrossAmount: 504, platformTouristTaxAmount: 4 });
  assert.equal(q.summaryCascade.grossTotal, 504);
  assert.equal(q.summaryCascade.offeredTaxDeduction, 4);
  assert.equal(q.summaryCascade.commissionBase, 500);
});

test('direct, 40 € complement collected in caisse interne: no « Total perçu » live nor stored (was 306 stored)', () => {
  const db = pricingAuditDb({ touristTax: 1 });
  const q = calculateReservationQuote({
    ...STAY, db, platform: 'direct', customOptions: [{ description: 'Bois', amount: 40, inComplement: 1 }],
    depositPaid: 1, balancePaid: 1, complementPaid: 1, depositAmount: 180, balanceAmount: 424, complementAmount: 40,
  });
  const row = {
    platform: 'direct', finalPrice: q.finalPrice, touristTaxTotal: q.touristTaxTotal, depositAmount: q.depositAmount,
    balanceAmount: q.balanceAmount, complementAmount: q.complementAmount, depositPaid: 1, balancePaid: 1,
    complementPaid: 1, complementPaidCash: 1,
  };
  assert.deepEqual(q.headline, { label: 'Total du séjour', amount: 644, secondary: null });
  assert.deepEqual(stored(row), q.headline);
});
