const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows, __test: { classifyLine } } = require('../utils/accountingExport');

// accounting-platform-commission-and-no-deposit.md §3.5 + §7.1.
// Drives the per-platform commission-as-journal-line behaviour through `buildEntry` +
// `entryToRows`. No DB at all — pure-function shape tests.
//
// The accountant's example (verbatim from the 2026-06-04 email):
//   Customer paid platform Gîtes de France: 687 € (gross, TVA 10 % on accommodation)
//   Bank received from platform:            626 € (net = finalPrice)
//   Commission:                              61 € TTC (≈ 50,83 € HT + 10,17 € TVA 20 %)
//   ↓
//   DÉBIT C<NAME>  626          (net = bank movement)
//   DÉBIT 62260500  50,83       (commission HT — Gîtes de France compte)
//   DÉBIT 445660    10,17       (TVA déductible 20 %)
//   CRÉDIT 706000   624,55      (CA HT recognised on gross)
//   CRÉDIT 445711    62,45      (TVA collectée 10 % on gross)
//   Σ debits = Σ credits = 687

const baseQuote = {
  finalPrice: 626,
  vatPercentageAccommodation: 10,
  vatPercentageOptions: 10,
  vatPercentageResources: 10,
  // Pre-extracted HT + VAT on the NET (the engine recognises CA-on-net at quote time;
  // `buildEntry` scales these up by grossRatio to recognise CA-on-gross post-spec).
  accommodationNetPrice: 569.09,
  accommodationVatAmount: 56.91,
  optionsNetPrice: 0,
  optionsVatAmount: 0,
  resourcesNetPrice: 0,
  resourcesVatAmount: 0,
  touristTaxCollectedOnArrival: false,
};

function rowForPlatform({ platform = 'Gîtes de France', gross = 687, deposit = 0, balance = 626, complement = 0 } = {}) {
  return {
    id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Villa A',
    platform, finalPrice: 626, totalPrice: 626, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: gross,
    depositAmount: deposit,  depositPaid: deposit > 0 ? 1 : 0,  depositPaidDate: '2026-06-04',
    balanceAmount: balance,  balancePaid: balance > 0 ? 1 : 0,  balancePaidDate: '2026-06-04',
    complementAmount: complement, complementPaid: complement > 0 ? 1 : 0, complementPaidDate: '2026-06-04',
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null,    touristTaxSoldeContribTtc: null,
  };
}

const commissionContext = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  platformByName: new Map([
    ['gîtes de france', { name: 'Gîtes de France', commissionAccountNumber: '62260500', hasVatOnCommission: 1 }],
    ['airbnb',          { name: 'Airbnb',          commissionAccountNumber: '62260300', hasVatOnCommission: 0 }],
  ]),
};

function round2(n) { return Math.round(n * 100) / 100; }

test('Case 1: Direct booking → no commission line, balanced as before', () => {
  const row = { ...rowForPlatform({ platform: 'direct', gross: 626, balance: 626 }), platform: 'direct' };
  const entry = buildEntry(row, baseQuote, 'balance', null, commissionContext);
  assert.equal(entry.commission, null);
  assert.equal(entry.encaissementNetTtc, entry.encaissementTtc); // net === gross for direct
});

test('Case 2: Platform without VAT (Airbnb) → 1 commission HT debit only, no VAT debit', () => {
  // Airbnb: hasVatOnCommission = 0. The full commission TTC rides on the 6226xx line as HT.
  const row = rowForPlatform({ platform: 'Airbnb', gross: 687, balance: 626 });
  const entry = buildEntry(row, baseQuote, 'balance', null, commissionContext);
  assert.equal(entry.commission.account, '62260300');
  assert.equal(entry.commission.hasVat, false);
  assert.equal(round2(entry.commission.ttc), 61);
  assert.equal(round2(entry.commission.ht), 61);
  assert.equal(entry.commission.vat, 0);

  const rows = entryToRows(entry);
  const types = rows.map((r) => classifyLine(r[6]));
  assert.deepEqual(types.filter((t) => t.startsWith('commission')), ['commission_charge']);
});

test('Case 3: Platform with VAT (Gîtes de France) → matches the accountant example to the cent', () => {
  const row = rowForPlatform({ platform: 'Gîtes de France', gross: 687, balance: 626 });
  const entry = buildEntry(row, baseQuote, 'balance', null, commissionContext);

  // Commission HT/VAT match the accountant's email (50,83 + 10,17 = 61).
  assert.equal(round2(entry.commission.ttc), 61);
  assert.equal(round2(entry.commission.ht), 50.83);
  assert.equal(round2(entry.commission.vat), 10.17);
  assert.equal(entry.commission.account, '62260500');
  assert.equal(entry.commission.vatAccount, '44566000');
  assert.equal(entry.commission.hasVat, true);
  // Encaissement net = 626 (bank movement). Gross = 687.
  assert.equal(round2(entry.encaissementNetTtc), 626);
  assert.equal(round2(entry.encaissementTtc), 687);
  // Σ debits == Σ credits in the rendered rows.
  const rows = entryToRows(entry);
  const sumDebits = rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0);
  const sumCredits = rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0);
  assert.equal(round2(sumDebits), 687);
  assert.equal(round2(sumCredits), 687);
});

test('Case 4: Platform-row override beats the global default account', () => {
  // The Gîtes-de-France row has 62260500 set → wins over default 622600.
  const row = rowForPlatform({ platform: 'Gîtes de France', gross: 687, balance: 626 });
  const entry = buildEntry(row, baseQuote, 'balance', null, commissionContext);
  assert.equal(entry.commission.account, '62260500');
});

test('Case 5: Unknown platform → falls back to default account; hasVat defaults to false', () => {
  const row = rowForPlatform({ platform: 'Booking.com', gross: 687, balance: 626 });
  const entry = buildEntry(row, baseQuote, 'balance', null, commissionContext);
  assert.equal(entry.commission.account, '622600');
  assert.equal(entry.commission.hasVat, false);
});

test('Case 6: Complement entry → 0 commission regardless of platform', () => {
  // On-site extras (complement) are host-billed: no platform commission.
  const row = rowForPlatform({ platform: 'Gîtes de France', gross: 687, balance: 626, complement: 50 });
  const balanceEntry = buildEntry(row, baseQuote, 'balance', null, commissionContext);
  const complementEntry = buildEntry(row, baseQuote, 'complement', null, commissionContext);
  assert.ok(balanceEntry.commission && balanceEntry.commission.ttc > 0);
  assert.equal(complementEntry.commission, null);
});

test('Case 7: Deposit entry on a platform → 0 commission (deposit is 0 post-migration)', () => {
  // The migration collapses platform deposits into balance; here we model that state by
  // passing deposit = 0 + balance = full. The buildEntry never emits a deposit entry for
  // that case (encaissementTtc = 0 → null), but if a legacy row still had deposit > 0,
  // the commission would only fire on the balance entry.
  const row = rowForPlatform({ platform: 'Gîtes de France', gross: 687, balance: 626, deposit: 0 });
  const depositEntry = buildEntry(row, baseQuote, 'deposit', null, commissionContext);
  assert.equal(depositEntry, null);
});
