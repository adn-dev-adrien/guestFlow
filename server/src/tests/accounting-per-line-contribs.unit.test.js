const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');

// Per-line per-bucket contribution attribution (spec force-item-to-complement.md §5).
// Drives `buildEntry` with synthetic `perLineData` to verify the contrib-driven path emits
// exactly the right per-bucket TTC for each kind, with zero cross-contamination.

function quoteOf({ accommodationTtc, optionsTtc, resourcesTtc, taxTtc = 0 }) {
  // Engine-shape quote — VAT extracted at 10 % accommodation / 20 % standard.
  const vatAcco = round2(accommodationTtc * (10 / 110));
  const vatOpt = round2(optionsTtc * (20 / 120));
  const vatRes = round2(resourcesTtc * (20 / 120));
  return {
    finalPrice: accommodationTtc + optionsTtc + resourcesTtc,
    accommodationNetPrice: round2(accommodationTtc - vatAcco),
    accommodationVatAmount: vatAcco,
    optionsNetPrice: round2(optionsTtc - vatOpt),
    optionsVatAmount: vatOpt,
    resourcesNetPrice: round2(resourcesTtc - vatRes),
    resourcesVatAmount: vatRes,
    vatPercentageAccommodation: 10,
    vatPercentageOptions: 20,
    vatPercentageResources: 20,
    touristTaxCollectedOnArrival: false,
  };
}

function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }

function rowOf(overrides = {}) {
  return {
    id: 1, firstName: 'Jean', lastName: 'Dupont', platform: 'direct',
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-07-01',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-07-05',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    finalPrice: 200, totalPrice: 200, touristTaxTotal: 0,
    touristTaxInComplement: 0,
    accommodationAcompteContribTtc: null,
    accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null,
    touristTaxSoldeContribTtc: null,
    clientGrossAmount: null,
    ...overrides,
  };
}

test('legacy fallback (no contribs) → identical pro-rata behaviour as before', () => {
  // Deposit at 30 %: fraction = 60/200 = 0.3, applied to the full reservation HT in the export.
  const entry = buildEntry(rowOf(), quoteOf({ accommodationTtc: 200, optionsTtc: 0, resourcesTtc: 0 }), 'deposit');
  assert.equal(entry.fraction, 0.3);
  assert.equal(entry.encaissementTtc, 60);
  // Buckets carry the FULL reservation HT/VAT (the export engine multiplies by fraction).
  const acco = entry.buckets.find((b) => b.name === 'accommodation');
  assert.ok(acco.ht > 100); // 200 / 1.10 ≈ 181.82
});

test('contrib path: deposit entry uses the per-line acompteContribTtc directly', () => {
  const perLineData = {
    optionLines: [{ optionId: 10, totalPrice: 100, offered: 0, inComplement: 0, acompteContribTtc: 30, soldeContribTtc: null }],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 300, depositAmount: 90, balanceAmount: 210, totalPrice: 200,
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
  });
  const entry = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'deposit', perLineData);
  assert.equal(entry.fraction, 1);
  // Bucket TTCs are pre-applied (no multiplication needed in the export engine).
  const acco = entry.buckets.find((b) => b.name === 'accommodation');
  const opt = entry.buckets.find((b) => b.name === 'options');
  // Accommodation: 60 TTC → 60/1.10 = 54.55 HT
  assert.equal(acco.ht, round2(60 / 1.10));
  assert.equal(acco.vat, round2(60 - acco.ht));
  // Options: 30 TTC → 30/1.20 = 25 HT
  assert.equal(opt.ht, round2(30 / 1.20));
  assert.equal(entry.encaissementTtc, 90);
});

test('contrib path: balance entry mirrors solde contribs (no contamination from deposit)', () => {
  const perLineData = {
    optionLines: [{ optionId: 10, totalPrice: 100, offered: 0, inComplement: 0, acompteContribTtc: 30, soldeContribTtc: 70 }],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 300, depositAmount: 90, balanceAmount: 210,
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
  });
  const entry = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'balance', perLineData);
  const acco = entry.buckets.find((b) => b.name === 'accommodation');
  const opt = entry.buckets.find((b) => b.name === 'options');
  assert.equal(acco.ht, round2(140 / 1.10));
  assert.equal(opt.ht, round2(70 / 1.20));
  assert.equal(entry.encaissementTtc, 210);
});

test('forced option lives 100 % in complement entry, NOT in deposit/balance', () => {
  const perLineData = {
    optionLines: [{ optionId: 10, totalPrice: 100, offered: 0, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null }],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 300, depositAmount: 60, balanceAmount: 140, complementAmount: 100, complementPaid: 1, complementPaidDate: '2026-07-10',
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
  });
  const deposit = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'deposit', perLineData);
  const balance = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'balance', perLineData);
  const complement = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'complement', perLineData);
  // Deposit + balance carry ONLY the accommodation contribs (the option is forced).
  assert.equal(deposit.encaissementTtc, 60);
  assert.equal(balance.encaissementTtc, 140);
  assert.equal(deposit.buckets.find((b) => b.name === 'options'), undefined);
  // Complement carries the forced option at 100 %.
  const compOpt = complement.buckets.find((b) => b.name === 'options');
  assert.equal(compOpt.ht, round2(100 / 1.20));
});

test('post-payment growth: complement entry carries the delta, deposit/balance stay clean', () => {
  // Option started at 100, captured 30/70 acompte/solde. Grew to 130 post-payment.
  // Delta = 130 - 30 - 70 = 30 → in complement.
  const perLineData = {
    optionLines: [{ optionId: 10, totalPrice: 130, offered: 0, inComplement: 0, acompteContribTtc: 30, soldeContribTtc: 70 }],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 330, depositAmount: 90, balanceAmount: 210, complementAmount: 30,
    complementPaid: 1, complementPaidDate: '2026-07-10',
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
  });
  const deposit = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 130, resourcesTtc: 0 }), 'deposit', perLineData);
  const complement = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 130, resourcesTtc: 0 }), 'complement', perLineData);
  // Deposit: option contrib is 30, NOT 39 (= 30 % of 130 from grown total).
  assert.equal(deposit.buckets.find((b) => b.name === 'options').ht, round2(30 / 1.20));
  // Complement: only the delta = 30.
  assert.equal(complement.buckets.find((b) => b.name === 'options').ht, round2(30 / 1.20));
});

test('complement entry sums forced + delta correctly', () => {
  const perLineData = {
    optionLines: [
      { optionId: 10, totalPrice: 100, offered: 0, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null },
      { optionId: 11, totalPrice: 130, offered: 0, inComplement: 0, acompteContribTtc: 30, soldeContribTtc: 70 },
    ],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 430, depositAmount: 60, balanceAmount: 140, complementAmount: 130,
    complementPaid: 1, complementPaidDate: '2026-07-10',
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
  });
  const complement = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 230, resourcesTtc: 0 }), 'complement', perLineData);
  // Forced (100) + delta (130 - 30 - 70 = 30) = 130 TTC in options bucket.
  const opt = complement.buckets.find((b) => b.name === 'options');
  assert.equal(opt.ht, round2(130 / 1.20));
});

test('tax routed to complement (touristTaxInComplement=1) → drops from all buckets', () => {
  const perLineData = {
    optionLines: [], customOptionLines: [], resourceLines: [],
    hasContribs: true, accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 200, totalPrice: 200, touristTaxTotal: 10, complementAmount: 10,
    complementPaid: 1, complementPaidDate: '2026-07-10', touristTaxInComplement: 1,
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
  });
  const complement = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 0, resourcesTtc: 0 }), 'complement', perLineData);
  // Pure-tax complement → null (excluded from accountant journal).
  assert.equal(complement, null);
});

test('resource contribs follow the same per-bucket attribution', () => {
  const perLineData = {
    optionLines: [],
    customOptionLines: [],
    resourceLines: [{ resourceId: 20, totalPrice: 30, offered: 0, inComplement: 0, acompteContribTtc: 9, soldeContribTtc: 21 }],
    hasContribs: true,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({
    finalPrice: 230, depositAmount: 69, balanceAmount: 161,
    accommodationAcompteContribTtc: 60, accommodationSoldeContribTtc: 140,
  });
  const deposit = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 0, resourcesTtc: 30 }), 'deposit', perLineData);
  const res = deposit.buckets.find((b) => b.name === 'resources');
  assert.equal(res.ht, round2(9 / 1.20));
});

test('legacy reservation (all contribs NULL) → fallback path keeps existing behaviour exactly', () => {
  const perLineData = {
    optionLines: [{ optionId: 10, totalPrice: 100, offered: 0, inComplement: 0, acompteContribTtc: null, soldeContribTtc: null }],
    customOptionLines: [],
    resourceLines: [],
    hasContribs: false,
    accommodationTtcCurrent: 200,
  };
  const row = rowOf({ finalPrice: 300, depositAmount: 90, balanceAmount: 210, totalPrice: 200 });
  const entry = buildEntry(row, quoteOf({ accommodationTtc: 200, optionsTtc: 100, resourcesTtc: 0 }), 'deposit', perLineData);
  assert.equal(entry.fraction, round2(90 / 300));
  // Buckets carry FULL reservation HT/VAT (pre-feature contract).
  const opt = entry.buckets.find((b) => b.name === 'options');
  assert.equal(opt.ht, round2(100 - 100 * (20/120))); // ≈ 83.33
});
