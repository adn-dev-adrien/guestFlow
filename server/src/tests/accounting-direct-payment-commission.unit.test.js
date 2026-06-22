const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows } = require('../utils/accountingExport');

// specs/direct-payment-method-commission.md §3.4 — a DIRECT reservation's échéances each carry their
// own payment-method commission. Mirrors the platform path (commission expense + net cash line) BUT
// grossRatio = 1: the stored échéances already sum to the gross finalPrice, so CA = finalPrice with no
// gross-up. Pure-function shape tests through buildEntry + entryToRows.

const quote = {
  finalPrice: 200,
  vatPercentageAccommodation: 10, vatPercentageOptions: 10, vatPercentageResources: 10,
  accommodationNetPrice: 181.82, accommodationVatAmount: 18.18, // 200 TTC @ 10 %
  optionsNetPrice: 0, optionsVatAmount: 0, resourcesNetPrice: 0, resourcesVatAmount: 0,
  touristTaxCollectedOnArrival: false,
};

// CB (id 2): 0 % VAT, default account. SumUp (id 3): own account + VAT on commission.
const commissionContext = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  platformByName: new Map(),
  paymentMethodById: new Map([
    [2, { id: 2, name: 'Carte bancaire', commissionAccountNumber: null, hasVatOnCommission: 0 }],
    [3, { id: 3, name: 'SumUp', commissionAccountNumber: '622610', hasVatOnCommission: 1 }],
  ]),
};

function directRow(overrides = {}) {
  return {
    id: 1, firstName: 'Alice', lastName: 'Martin', propertyName: 'Tente',
    platform: 'direct', finalPrice: 200, totalPrice: 200, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: 200,
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-06-04',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-06-04',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    depositPaymentMethodId: 2, balancePaymentMethodId: 2, complementPaymentMethodId: 2,
    depositCommissionAmount: 0.9, balanceCommissionAmount: 2.1, complementCommissionAmount: 0,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
    ...overrides,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function sumDebits(rows) { return round2(rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0)); }
function sumCredits(rows) { return round2(rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0)); }

test('balance échéance: CB 1,5 % → commission expense + net cash line, balanced; grossRatio 1', () => {
  const entry = buildEntry(directRow(), quote, 'balance', null, commissionContext);
  assert.equal(round2(entry.commission.ttc), 2.1);
  assert.equal(entry.commission.account, '622600'); // method has no override → global default
  assert.equal(entry.commission.hasVat, false);
  assert.equal(round2(entry.encaissementTtc), 140);      // CA on gross (grossRatio = 1)
  assert.equal(round2(entry.encaissementNetTtc), 137.9); // 140 − 2.1 (what the bank receives)
  const rows = entryToRows(entry);
  assert.equal(sumDebits(rows), 140);
  assert.equal(sumCredits(rows), 140);
});

test('deposit échéance carries its own commission (acompte paid by CB)', () => {
  const entry = buildEntry(directRow(), quote, 'deposit', null, commissionContext);
  assert.equal(round2(entry.commission.ttc), 0.9);
  assert.equal(round2(entry.encaissementTtc), 60);
  assert.equal(round2(entry.encaissementNetTtc), 59.1);
  const rows = entryToRows(entry);
  assert.equal(sumDebits(rows), 60);
  assert.equal(sumCredits(rows), 60);
});

test('VAT-on-commission method → HT/VAT split on the method account + deductible VAT account', () => {
  // SumUp (id 3): balance 140 paid by SumUp, commission snapshot 2.45 (140 × 1.75 %), 20 % VAT.
  const entry = buildEntry(
    directRow({ balancePaymentMethodId: 3, balanceCommissionAmount: 2.45 }),
    quote, 'balance', null, commissionContext,
  );
  assert.equal(entry.commission.account, '622610');
  assert.equal(entry.commission.hasVat, true);
  assert.equal(round2(entry.commission.ttc), 2.45);
  assert.equal(round2(entry.commission.ht), round2(2.45 / 1.2));
  assert.equal(round2(entry.commission.vat), round2(2.45 - 2.45 / 1.2));
  const rows = entryToRows(entry);
  assert.equal(sumDebits(rows), 140);
  assert.equal(sumCredits(rows), 140);
});

test('0 % method (no commission snapshot) → no commission line, net === gross', () => {
  const entry = buildEntry(
    directRow({ depositCommissionAmount: 0, balanceCommissionAmount: 0 }),
    quote, 'balance', null, commissionContext,
  );
  assert.equal(entry.commission, null);
  assert.equal(entry.encaissementNetTtc, entry.encaissementTtc);
});

test('CA recognised on the full finalPrice: Σ échéance gross = 200 (no gross-up)', () => {
  const row = directRow();
  const dep = buildEntry(row, quote, 'deposit', null, commissionContext);
  const bal = buildEntry(row, quote, 'balance', null, commissionContext);
  assert.equal(round2(dep.encaissementTtc + bal.encaissementTtc), 200);
});
