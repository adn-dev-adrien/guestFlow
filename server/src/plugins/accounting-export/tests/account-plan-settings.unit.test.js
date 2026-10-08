// specs/plugins-phase-p-productisation.md §3.F rules 27–29 — the account plan as settings of the
// export: today's numbers by default, validated, the CSV byte-identical with the defaults, and every
// line on the plan's numbers once changed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { CSV_HEADERS, buildRows, buildStructuredEntries } = require('../accountingExport');
const { serializeCsv } = require('../../../utils/csv');
const {
  PLAN_DEFAULTS, REVENUE_ACCOUNTS, VAT_ACCOUNTS, PASS_THROUGH_ACCOUNTS, VAT_DEDUCTIBLE_COMMISSION_ACCOUNT,
  DISCOUNT_ACCOUNT, TIP_ACCOUNT, SALES_JOURNAL_CODE,
} = require('../accountPlan');
const { DECLARED, validateAccount, validateJournalCode } = require('../settings');

const sale = {
  reservationId: 11, kind: 'balance', paidDate: '2025-10-17', client: { firstName: 'Claire', lastName: 'Notin' },
  platform: 'direct', clientGrossAmount: null, finalPrice: 775, encaissementTtc: 775, taxTtc: 16, fraction: 1,
  buckets: [
    { name: 'accommodation', ht: 600, vat: 60, ratePercent: 10 },
    { name: 'options', ht: 50, vat: 5, ratePercent: 10 },
    { name: 'resources', ht: 36.67, vat: 7.33, ratePercent: 20 },
  ],
};
const discount = {
  reservationId: 11, kind: 'discount', direction: 'discount', paidDate: '2025-10-18', client: { lastName: 'Notin' },
  encaissementTtc: 11, discount: { account: DISCOUNT_ACCOUNT, ttc: 11, ht: 10, vat: 1, ratePercent: 10 },
};
const csv = (plan) => serializeCsv(CSV_HEADERS, buildRows([sale, discount], plan), { bom: false });

const PLAN = {
  ...PLAN_DEFAULTS,
  accommodationAccount: '706100', complementaryAccount: '706200', activitiesAccount: '706300',
  vat20Account: '445712', vat10Account: '445711', touristTaxAccount: '467100', discountAccount: '709000',
  journalCode: 'VE',
};

test('rule 27: the defaults are today\'s constants', () => {
  assert.deepEqual(PLAN_DEFAULTS, {
    accommodationAccount: REVENUE_ACCOUNTS.ACCOMMODATION,
    complementaryAccount: REVENUE_ACCOUNTS.COMPLEMENTARY,
    activitiesAccount: REVENUE_ACCOUNTS.ACTIVITIES,
    vat20Account: VAT_ACCOUNTS.STANDARD_20,
    vat10Account: VAT_ACCOUNTS.REDUCED_10,
    touristTaxAccount: PASS_THROUGH_ACCOUNTS.TOURIST_TAX,
    commissionVatAccount: VAT_DEDUCTIBLE_COMMISSION_ACCOUNT,
    discountAccount: DISCOUNT_ACCOUNT,
    tipAccount: TIP_ACCOUNT,
    journalCode: SALES_JOURNAL_CODE,
  });
  for (const key of Object.keys(PLAN_DEFAULTS)) assert.ok(DECLARED.some((d) => d.key === key && d.default === PLAN_DEFAULTS[key]), key);
});

test('rule 28: 3 to 12 digits for an account, 1 to 4 capitals or digits for the journal', () => {
  assert.equal(validateAccount('706'), null);
  assert.equal(validateAccount('706000000001'), null);
  assert.equal(validateAccount('70'), 'De 3 à 12 chiffres.');
  assert.equal(validateAccount('7060000000001'), 'De 3 à 12 chiffres.');
  assert.equal(validateAccount('70A'), 'De 3 à 12 chiffres.');
  assert.equal(validateJournalCode('VT'), null);
  assert.equal(validateJournalCode('V2'), null);
  assert.equal(validateJournalCode('vt'), 'De 1 à 4 majuscules ou chiffres.');
  assert.equal(validateJournalCode('VENTE'), 'De 1 à 4 majuscules ou chiffres.');
});

test('rule 29: with the defaults the CSV is byte-identical to the engine\'s', () => {
  assert.equal(csv(PLAN_DEFAULTS), csv(undefined));
});

test('rule 27: a changed plan puts every line and the journal on its numbers, the client account untouched', () => {
  const rows = buildRows([sale, discount], PLAN);
  assert.ok(rows.every((r) => r[3] === 'VE'));
  const accounts = rows.map((r) => r[6]);
  for (const own of ['706100', '706200', '706300', '445712', '445711', '467100', '709000', 'CNOTIN']) assert.ok(accounts.includes(own), own);
  for (const old of ['70600000', '70600010', '70601000', '44571200', '44571100', '46710000', '70900000']) assert.ok(!accounts.includes(old), old);
});

test('rule 27: the journal preview reads a renamed account as its role', () => {
  const [entry] = buildStructuredEntries([sale], PLAN);
  const line = (compte) => entry.lines.find((l) => l.compte === compte);
  assert.equal(line('706100').type, 'revenue');
  assert.equal(line('706100').accountLabel, 'Location gîte');
  assert.equal(line('467100').type, 'tax_pass_through');
  assert.equal(line('445711').type, 'vat');
});
