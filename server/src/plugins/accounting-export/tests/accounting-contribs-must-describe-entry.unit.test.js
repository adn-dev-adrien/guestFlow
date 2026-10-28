// specs/accounting-books-the-money-collected.md rule 15 — per-line contribs drive an entry only when
// they ADD UP to it. Audit 2026-10-28 (finding 1): contribs below the encaissement passed rule 11's
// one-directional guard and the gap fell on the last credit, the VAT line — #13 (October 2026) booked
// 44571100 C265,38 on 641,82 of revenue, #22298 (September 2026) C37,13 on 177,00.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../accountingModel');
const { entryToRows } = require('../accountingExport');

const COMMISSION_CONTEXT = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  vatRate: 10,
  platformByName: new Map([['gitesdefrance', { commissionAccountNumber: '', hasVatOnCommission: 0 }]]),
};
const NO_DESTINATION = { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 };

const linesOf = (entry) => entryToRows(entry).map((r) => `${r[6]} ${r[7] ? `D${r[7]}` : `C${r[8]}`}`);
const amountOf = (entry, account) => {
  const row = entryToRows(entry).find((r) => r[6] === account);
  return row ? Number(String(row[8] || row[7]).replace(',', '.')) : 0;
};

function baseRow(overrides = {}) {
  return {
    id: 1, firstName: 'Test', lastName: 'Contribs', propertyName: 'Gîte', platform: 'GitesDeFrance',
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 907.2, balancePaid: 1, balancePaidDate: '2026-10-01',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null, endOfStayComplementAmount: 0,
    finalPrice: 907.2, totalPrice: 907.2, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: null, platformCommissionAmount: 121.2, acompteCommissionAmount: null,
    accommodationAcompteContribTtc: 0, accommodationSoldeContribTtc: 706,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
    ...overrides,
  };
}
const perLine = (overrides = {}) => ({
  optionLines: [], customOptionLines: [], resourceLines: [], hasContribs: true,
  accommodationTtcCurrent: 907.2, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION,
  ...overrides,
});
const ctx = { collectedOnArrival: false };

test('rule 15 — #13 as it is today (solde 907,20 saved after a 706 contrib was captured) books 10 % VAT', () => {
  const entry = buildEntry(baseRow(), 'balance', perLine(), COMMISSION_CONTEXT, ctx);
  assert.deepEqual(linesOf(entry), ['CCONTRI D786', '622600 D121.2', '70600000 C824.73', '44571100 C82.47']);
});

test('rule 15 — #22298: a custom option without a captured contrib no longer lands on the VAT line', () => {
  const row = baseRow({
    platform: 'Booking', balanceAmount: 214.13, finalPrice: 214.13, totalPrice: 214.13,
    platformCommissionAmount: null, accommodationSoldeContribTtc: 194.7,
  });
  const entry = buildEntry(row, 'balance', perLine({
    customOptionLines: [{ label: 'Personne supplementaire', totalPrice: 15, soldeContribTtc: null, acompteContribTtc: null }],
    accommodationTtcCurrent: 199.13, optionsTtc: 15,
    destinations: { ...NO_DESTINATION, preArrivalOptions: 15 },
  }), COMMISSION_CONTEXT, ctx);
  const revenue = amountOf(entry, '70600000') + amountOf(entry, '70600010');
  const vat = amountOf(entry, '44571100');
  assert.ok(Math.abs(vat - (revenue + vat) / 11) <= 0.03, `VAT ${vat} on ${revenue} of revenue: ${linesOf(entry).join(' | ')}`);
  assert.equal(Math.round((revenue + vat) * 100) / 100, 214.13);
});

test('rule 15 — contribs that add up to the entry keep driving it', () => {
  const row = baseRow({ balanceAmount: 706, finalPrice: 706, totalPrice: 706, platformCommissionAmount: 201.2 });
  const entry = buildEntry(row, 'balance', perLine({ accommodationTtcCurrent: 706 }), COMMISSION_CONTEXT, ctx);
  assert.equal(entry.fraction, 1);
  assert.deepEqual(linesOf(entry), ['CCONTRI D504.8', '622600 D201.2', '70600000 C641.82', '44571100 C64.18']);
});

test('rule 15 — a rounding gap of one cent still counts as describing the entry', () => {
  const row = baseRow({ balanceAmount: 706.01, finalPrice: 706.01, totalPrice: 706.01, platformCommissionAmount: null });
  const entry = buildEntry(row, 'balance', perLine({ accommodationTtcCurrent: 706.01 }), COMMISSION_CONTEXT, ctx);
  assert.equal(entry.fraction, 1);
  assert.ok(Math.abs(amountOf(entry, '44571100') - 64.18) <= 0.01);
});
