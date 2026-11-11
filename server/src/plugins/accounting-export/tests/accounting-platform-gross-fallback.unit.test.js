// specs/accounting-books-the-money-collected.md rule 12 — every entry of a platform stay carries the gross the guest
// paid (`clientGrossAmount`, the « Brut » of Comptabilité › Plateformes), whichever path books it. The stored-money
// fallback used to return the stored column, NULL on a fiche that never held one: the « Brut » cell went blank
// (shadow trial of 4.0.0: stays #13 of Oct-2026 = 907,20 and #22298 of Sep-2026 = 259,13 under 3.21.0).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry } } = require('../accountingModel');

const COMMISSION_CONTEXT = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  vatRate: 10,
  platformByName: new Map([['gitesdefrance', { commissionAccountNumber: '', hasVatOnCommission: 0 }], ['booking', { commissionAccountNumber: '', hasVatOnCommission: 0 }]]),
};
const NO_DESTINATION = { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 };
const ctx = { collectedOnArrival: false };

const baseRow = (overrides = {}) => ({
  id: 1, firstName: 'Test', lastName: 'Gross', propertyName: 'Gîte', platform: 'GitesDeFrance',
  depositAmount: 0, depositPaid: 0, depositPaidDate: null,
  // date-literal-ok: a stored paid date nothing compares with today
  balanceAmount: 907.2, balancePaid: 1, balancePaidDate: '2026-10-01',
  complementAmount: 0, complementPaid: 0, complementPaidDate: null, endOfStayComplementAmount: 0,
  finalPrice: 907.2, totalPrice: 907.2, touristTaxTotal: 0, touristTaxInComplement: 0,
  clientGrossAmount: null, platformCommissionAmount: 121.2, acompteCommissionAmount: null,
  accommodationAcompteContribTtc: 0, accommodationSoldeContribTtc: 706,
  touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
  ...overrides,
});
const perLine = (overrides = {}) => ({
  optionLines: [], customOptionLines: [], resourceLines: [], hasContribs: true,
  accommodationTtcCurrent: 907.2, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION,
  ...overrides,
});

test('rule 12 — contribs that overflow the entry fall back to stored money and still carry the gross (#13 = 907,20)', () => {
  const entry = buildEntry(baseRow(), 'balance', perLine(), COMMISSION_CONTEXT, ctx);
  assert.equal(entry.clientGrossAmount, 907.2);
});

test('rule 12 — a fiche without captured contribs carries the gross too (#22298 = 259,13)', () => {
  const row = baseRow({
    platform: 'Booking', balanceAmount: 259.13, finalPrice: 259.13, totalPrice: 259.13, platformCommissionAmount: null,
  });
  const entry = buildEntry(row, 'balance', { optionLines: [], customOptionLines: [], resourceLines: [], hasContribs: false, accommodationTtcCurrent: 259.13, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION }, COMMISSION_CONTEXT, ctx);
  assert.equal(entry.clientGrossAmount, 259.13);
});

test('rule 12 — a stored gross above the price still wins (legacy gross-up era)', () => {
  const row = baseRow({ clientGrossAmount: 1000, platformCommissionAmount: null, accommodationSoldeContribTtc: 0 });
  const entry = buildEntry(row, 'balance', perLine({ hasContribs: false }), COMMISSION_CONTEXT, ctx);
  assert.equal(entry.clientGrossAmount, 1000);
});
