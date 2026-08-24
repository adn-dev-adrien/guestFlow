const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows } = require('../utils/accountingExport');

// specs/platform-brut-excludes-offered-tourist-tax.md §1 + rules 8-9 — the accountant's 2026-08-24
// report, end to end. Réservation #22225 (Stéphane Grimaud, Gîtes de France, 26-28 June 2026) as the
// engine stores it AFTER the fix: the brut GdF bills (653 location + 80 ménage = 733) is entirely
// revenue, the tourist tax the centrale collects and remits is nowhere in our books, and the 65 € of
// commission splits at 20 % because the GdF platform row carries hasVatOnCommission = 1.
//
// Expected entry (verbatim from the accountant):
//   DÉBIT  CGRIMAU    668,00   (montant net propriétaire = the bank movement)
//   DÉBIT  622600      54,17   (commission HT)
//   DÉBIT  44566000    10,83   (TVA déductible 20 % sur commission)
//   CRÉDIT 70600000   593,64   (location gîte HT)
//   CRÉDIT 70600010    72,73   (prestation complémentaire HT — le forfait ménage)
//   CRÉDIT 44571100    66,63   (TVA collectée 10 %)
//   Σ débits = Σ crédits = 733,00

const GRIMAUD_ROW = {
  id: 22225, firstName: 'Stéphane', lastName: 'Grimaud', propertyName: 'Domaine Solio',
  platform: 'GitesDeFrance',
  finalPrice: 733, totalPrice: 733,
  // Offered tax: collected AND remitted by the centrale → zero in our books, and no 46710000 line.
  touristTaxTotal: 0, touristTaxInComplement: 0,
  clientGrossAmount: null,
  platformCommissionAmount: 65, acompteCommissionAmount: null,
  depositAmount: 0, depositPaid: 0, depositPaidDate: null,
  balanceAmount: 733, balancePaid: 1, balancePaidDate: '2026-07-02',
  complementAmount: 0, complementPaid: 0, complementPaidDate: null,
  accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
  touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
};

// The 80 € forfait ménage — the only billed option, so the accommodation bucket is 733 − 80 = 653.
const PER_LINE_DATA = { hasContribs: false, optionsTtc: 80, resourcesTtc: 0 };

const COMMISSION_CONTEXT = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  vatRate: 10,
  platformByName: new Map([
    // No dedicated compte on the row → the generic 622600 of the accountant's screenshot.
    ['gitesdefrance', { name: 'GitesDeFrance', commissionAccountNumber: '', hasVatOnCommission: 1 }],
  ]),
};

function round2(n) { return Math.round(n * 100) / 100; }
function entryRows() {
  return entryToRows(buildEntry(GRIMAUD_ROW, 'balance', PER_LINE_DATA, COMMISSION_CONTEXT, { collectedOnArrival: false }));
}

test('Grimaud #22225: the journal entry matches the accountant’s expected lines to the cent', () => {
  const rows = entryRows();
  // [day, month, year, journal, piece, libellé, compte, débit, crédit, …platform info]
  const byAccount = new Map(rows.map((r) => [r[6], { debit: r[7], credit: r[8] }]));

  assert.equal(round2(byAccount.get('CGRIMAU').debit), 668, 'net propriétaire = 733 − 65');
  assert.equal(round2(byAccount.get('622600').debit), 54.17, 'commission HT');
  assert.equal(round2(byAccount.get('44566000').debit), 10.83, 'TVA déductible 20 % sur commission');
  assert.equal(round2(byAccount.get('70600000').credit), 593.64, 'location gîte HT (653 TTC)');
  assert.equal(round2(byAccount.get('70600010').credit), 72.73, 'prestation complémentaire HT (80 TTC)');
  assert.equal(round2(byAccount.get('44571100').credit), 66.63, 'TVA collectée 10 %');
});

test('Grimaud #22225: the entry balances at 733, the full amount Gîtes de France billed', () => {
  const rows = entryRows();
  const sum = (i) => round2(rows.reduce((s, r) => s + (typeof r[i] === 'number' ? r[i] : 0), 0));
  assert.equal(sum(7), 733, 'Σ débits');
  assert.equal(sum(8), 733, 'Σ crédits');
});

test('Grimaud #22225: no 46710000 line — the centrale remits the tourist tax itself', () => {
  const accounts = entryRows().map((r) => r[6]);
  assert.ok(!accounts.includes('46710000'), 'the offered tax never transits through our accounts');
});

test('the same booking with hasVatOnCommission = 0 books the commission flat (Booking / Airbnb shape)', () => {
  // Guard for rule 8: only Gîtes de France flips to 1. A reverse-charge platform keeps the whole
  // commission on 622600 with no deductible-VAT line — the accountant self-assesses the VAT.
  const context = {
    ...COMMISSION_CONTEXT,
    platformByName: new Map([['gitesdefrance', { commissionAccountNumber: '', hasVatOnCommission: 0 }]]),
  };
  const rows = entryToRows(buildEntry(GRIMAUD_ROW, 'balance', PER_LINE_DATA, context, { collectedOnArrival: false }));
  const byAccount = new Map(rows.map((r) => [r[6], { debit: r[7], credit: r[8] }]));
  assert.equal(round2(byAccount.get('622600').debit), 65, 'whole commission as HT');
  assert.ok(!byAccount.has('44566000'), 'no deductible-VAT line');
  const sumDebits = round2(rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0));
  assert.equal(sumDebits, 733, 'still balanced');
});
