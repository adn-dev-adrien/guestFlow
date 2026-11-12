// specs/pricing-components.md §3 rules 63 and 65 — the legacy read model of the accounting output keeps today's derivation
// of an entry's buckets in ONE core module (`utils/accounting/legacyBucketSplit.js`), so a stay without per-line truth
// exports the cents it always exported. Pure: runs without the accounting-export plugin installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeBucketTtcsFromContribs, computeTaxTtcForKind, legacyGrossUp, bookedBucketSplit, netOfTtc, bucketFromTtc,
  parseComplementPaidSplit, TTC_SPLIT_FALLBACK,
} = require('../utils/accounting/legacyBucketSplit');

test('rule 63: the tourist tax rides the solde, or the complement when it is collected on arrival', () => {
  const row = { touristTaxTotal: 10, touristTaxAddedGuestsAmount: 2, touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0, balancePaid: 0 };
  assert.equal(computeTaxTtcForKind(row, 'deposit', false, 100), 0);
  assert.equal(computeTaxTtcForKind(row, 'balance', false, 100), 8);
  assert.equal(computeTaxTtcForKind(row, 'complement', false, 100), 2);
  assert.equal(computeTaxTtcForKind(row, 'balance', true, 100), 0);
  assert.equal(computeTaxTtcForKind(row, 'complement', true, 100), 10);
});

test('rule 63: the buckets of an entry are the stored per-line contributions of its kind', () => {
  const data = { accommodationTtcCurrent: 200, optionLines: [{ acompteContribTtc: 10, soldeContribTtc: 20, totalPrice: 40 }], customOptionLines: [], resourceLines: [] };
  const row = { accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140, touristTaxAcompteContribTtc: 0 };
  assert.deepEqual(computeBucketTtcsFromContribs(row, data, 'deposit', false), { accommodation: 60, options: 10, resources: 0 });
  assert.deepEqual(computeBucketTtcsFromContribs(row, data, 'balance', false), { accommodation: 140, options: 20, resources: 0 });
  assert.deepEqual(computeBucketTtcsFromContribs(row, data, 'complement', false), { accommodation: 0, options: 10, resources: 0 });
});

test('rule 63: the gross-up grosses a stay up only in the two historical shapes', () => {
  const schedule = { depositAmount: 50, balanceAmount: 50, complementAmount: 0, endOfStayComplementAmount: 0 };
  assert.equal(legacyGrossUp(schedule, { finalPriceTtc: 100, touristTaxTotal: 0, enteredCommissionTtc: 0, adjustedComplementAuto: null }).grossRatio, 1);
  const grossEra = legacyGrossUp({ ...schedule, depositAmount: 30, balanceAmount: 57, clientGrossAmount: 100 }, { finalPriceTtc: 87, touristTaxTotal: 0, enteredCommissionTtc: 0, adjustedComplementAuto: null });
  assert.equal(grossEra.commissionTtcTotal, 13);
  assert.ok(Math.abs(grossEra.grossRatio - 100 / 87) < 1e-12);
  const netEra = legacyGrossUp({ ...schedule, depositAmount: 0, balanceAmount: 85 }, { finalPriceTtc: 100, touristTaxTotal: 0, enteredCommissionTtc: 15, adjustedComplementAuto: null });
  assert.ok(Math.abs(netEra.grossRatio - 100 / 85) < 1e-12);
  const current = legacyGrossUp({ ...schedule, depositAmount: 0, balanceAmount: 100 }, { finalPriceTtc: 100, touristTaxTotal: 0, enteredCommissionTtc: 15, adjustedComplementAuto: null });
  assert.equal(current.grossRatio, 1);
});

test('rules 63 and 65: a part of a bucket is prorated in TTC first from the split day, in HT and VAT apart before', () => {
  const bucket = { ht: 90.91, vat: 9.09, ratePercent: 10 };
  assert.deepEqual(bookedBucketSplit({ fraction: 0.5, paidDate: '2027-01-10' }, bucket), { ht: 45.45, vat: 4.55 });
  assert.deepEqual(bookedBucketSplit({ fraction: 0.5, paidDate: '2026-10-10' }, bucket), { ht: 45.46, vat: 4.55 });
  assert.deepEqual(bookedBucketSplit({ fraction: 1, paidDate: '2027-01-10' }, bucket), { ht: 90.91, vat: 9.09 });
  assert.deepEqual(bookedBucketSplit({ fraction: 0.5, paidDate: '2026-10-10' }, bucket, '2026-10-01'), { ht: 45.45, vat: 4.55 });
  assert.equal(TTC_SPLIT_FALLBACK, '2026-11-01');
});

test('rule 65: the net of a TTC amount goes through the VAT component, 0 % leaving it whole', () => {
  assert.equal(netOfTtc(120, 20), 100);
  assert.equal(netOfTtc(120, 0), 120);
  assert.deepEqual(bucketFromTtc('options', 110, 10), { name: 'options', ht: 100, vat: 10, ratePercent: 10 });
  assert.deepEqual(bucketFromTtc('options', 0, 10), { name: 'options', ht: 0, vat: 0, ratePercent: 10 });
});

test('rule 63: a stored complement split is read only while it adds up to the entry', () => {
  const row = { complementPaidSplit: JSON.stringify({ taxCents: 100, accommodationCents: 200, optionsCents: 300, resourcesCents: 400 }) };
  assert.deepEqual(parseComplementPaidSplit(row, 10), { tax: 1, accommodation: 2, options: 3, resources: 4 });
  assert.equal(parseComplementPaidSplit(row, 11), null);
  assert.equal(parseComplementPaidSplit({ complementPaidSplit: 'not json' }, 10), null);
  assert.equal(parseComplementPaidSplit({}, 10), null);
});
