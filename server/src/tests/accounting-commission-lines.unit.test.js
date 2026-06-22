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

test('Case 4bis: NEW model — operator-entered commission, no clientGrossAmount (« Prix payé client » retired)', () => {
  // specs/platform-commission-line.md (2026-06-22): the CA is the total séjour (= finalPrice 300), the
  // commission is the operator-entered `platformCommissionAmount` (40), and the engine already stored the
  // NET in the solde (260). buildEntry grosses the net back up to the total séjour, books the commission,
  // and the net = the solde. Output: CA 300, commission 40, net perçu 260.
  const newQuote = {
    ...baseQuote,
    finalPrice: 300,
    accommodationNetPrice: 272.73, accommodationVatAmount: 27.27, // 300 TTC @ 10 %
  };
  const row = {
    id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Villa A',
    platform: 'Airbnb', finalPrice: 300, totalPrice: 300, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: null, platformCommissionAmount: 40,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 260, balancePaid: 1, balancePaidDate: '2026-06-04', // net = 300 − 40
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
  const entry = buildEntry(row, newQuote, 'balance', null, commissionContext);
  assert.equal(round2(entry.commission.ttc), 40, 'commission = the operator-entered field');
  assert.equal(round2(entry.encaissementTtc), 300, 'CA = total séjour');
  assert.equal(round2(entry.encaissementNetTtc), 260, 'net perçu = solde = total − commission');
  const rows = entryToRows(entry);
  const sumDebits = rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0);
  const sumCredits = rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0);
  assert.equal(round2(sumDebits), 300);
  assert.equal(round2(sumCredits), 300);
});

test('Case 4ter: real Booking reservation (Estelle Z.) — revenu brut 102.50, commission 16.48, versement 86.02', () => {
  // Regression for the prod report (2026-06-22): Booking #6622323293. The owner listed the stay at
  // 102,50 € (= what the guest pays the platform), Booking kept 16,48 € commission, and wired 86,02 €.
  // The accounting MUST surface: CA (revenu brut) = 102,50 ; commission = 16,48 ; net (versement) = 86,02.
  // Booking is unknown to the commissionContext map → default account 622600, no VAT on the commission.
  const bookingQuote = {
    ...baseQuote,
    finalPrice: 102.50,
    accommodationNetPrice: 93.18, accommodationVatAmount: 9.32, // 102,50 TTC @ 10 %
  };
  const row = {
    id: 1, firstName: 'Estelle', lastName: 'Zmyslowski', propertyName: 'Aventura lodge',
    platform: 'Booking', finalPrice: 102.50, totalPrice: 102.50, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: 102.51, platformCommissionAmount: 16.48, // stale gross present; the new field wins
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 86.02, balancePaid: 1, balancePaidDate: '2026-05-18', // solde = net = 102,50 − 16,48
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
  const entry = buildEntry(row, bookingQuote, 'balance', null, commissionContext);
  assert.equal(round2(entry.commission.ttc), 16.48, 'commission = the operator-entered field, NOT gross − net (0.01)');
  assert.equal(round2(entry.encaissementTtc), 102.50, 'revenu brut (CA) = total séjour');
  assert.equal(round2(entry.encaissementNetTtc), 86.02, 'versement (net banked) = solde');
  const rows = entryToRows(entry);
  const sumDebits = rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0);
  const sumCredits = rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0);
  assert.equal(round2(sumDebits), 102.50);
  assert.equal(round2(sumCredits), 102.50);
});

test('Case 4quater: real Gîtes de France reservation (Chloé Le Lann) — NEW model, VAT 20% on commission', () => {
  // Real prod résa #1415. Location 607 + options 80 = total séjour 687 ; commission 61 € TTC
  // (50,83 HT + 10,17 TVA 20 %, compte Gîtes de France 62260500) ; virement 626 €. This is the
  // accountant's verbatim example, but stored in the NEW shape: finalPrice = 687 (total séjour),
  // platformCommissionAmount = 61, solde = 626 (net). The accounting must reproduce CA 687 (split
  // location 70600000 + options 70600010), commission 61 (HT/VAT), versement 626 — and balance.
  const gdfQuote = {
    ...baseQuote,
    finalPrice: 687,
    accommodationNetPrice: 551.82, accommodationVatAmount: 55.18, // 607 TTC @ 10 %
    optionsNetPrice: 72.73, optionsVatAmount: 7.27,               //  80 TTC @ 10 %
  };
  const row = {
    id: 1, firstName: 'Chloé', lastName: 'Le Lann', propertyName: 'Gite',
    platform: 'Gîtes de France', finalPrice: 687, totalPrice: 687, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: null, platformCommissionAmount: 61,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 626, balancePaid: 1, balancePaidDate: '2026-05-07', // solde = net = 687 − 61
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
  const entry = buildEntry(row, gdfQuote, 'balance', null, commissionContext);
  // Commission 61 € TTC with 20 % VAT → 50,83 HT + 10,17 VAT, Gîtes-de-France account.
  assert.equal(round2(entry.commission.ttc), 61);
  assert.equal(round2(entry.commission.ht), 50.83);
  assert.equal(round2(entry.commission.vat), 10.17);
  assert.equal(entry.commission.account, '62260500');
  assert.equal(entry.commission.hasVat, true);
  // Revenu brut 687, versement 626.
  assert.equal(round2(entry.encaissementTtc), 687, 'revenu brut (CA) = total séjour');
  assert.equal(round2(entry.encaissementNetTtc), 626, 'versement = solde');
  // Both revenue accounts are credited: location (70600000) + prestations complémentaires (70600010).
  const rows = entryToRows(entry);
  const creditAccounts = rows.filter((r) => typeof r[8] === 'number' && r[8] > 0).map((r) => r[6]);
  assert.ok(creditAccounts.includes('70600000'), 'location gîte credited');
  assert.ok(creditAccounts.includes('70600010'), 'prestations complémentaires (options) credited');
  // Balanced at the total séjour.
  const sumDebits = rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0);
  const sumCredits = rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0);
  assert.equal(round2(sumDebits), 687);
  assert.equal(round2(sumCredits), 687);
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
