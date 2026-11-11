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

test('rule 12 — the own-channel test reads the platform\'s mode, not its name: a platform counted as a direct sale keeps no gross, any other carries it', () => {
  const { setDirectChannels } = require('../../../utils/platformNameFormat');
  const row = baseRow({ platform: 'Lodgify', balanceAmount: 259.13, finalPrice: 259.13, totalPrice: 259.13, platformCommissionAmount: null });
  const lines = { optionLines: [], customOptionLines: [], resourceLines: [], hasContribs: false, accommodationTtcCurrent: 259.13, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION };
  try {
    setDirectChannels([]);
    assert.equal(buildEntry(row, 'balance', lines, COMMISSION_CONTEXT, ctx).clientGrossAmount, 259.13);
    setDirectChannels(['Lodgify']);
    assert.equal(buildEntry(row, 'balance', lines, COMMISSION_CONTEXT, ctx).clientGrossAmount, null);
    assert.equal(buildEntry({ ...row, clientGrossAmount: 300 }, 'balance', lines, COMMISSION_CONTEXT, ctx).clientGrossAmount, 300);
  } finally {
    setDirectChannels([]);
  }
});

// Reading of 2026-11-11 (Adrien): « Brut » is the PLATFORM's gross as recorded on the fiche, never the price with the
// complements paid on site.
const lines = (overrides = {}) => ({ optionLines: [], customOptionLines: [], resourceLines: [], hasContribs: false, accommodationTtcCurrent: 700, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION, ...overrides });

test('rule 12 — entered commission: the balance row shows the recorded platform gross, not the price with on-site complements (22275 = 720,82)', () => {
  const row = baseRow({
    platform: 'Abracadaroom', finalPrice: 865.82, totalPrice: 496.47, balanceAmount: 720.82, complementAmount: 132,
    platformGrossAmount: 720.82, platformCommissionAmount: 147.05, clientGrossAmount: null, accommodationSoldeContribTtc: 0,
  });
  assert.equal(buildEntry(row, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, 720.82);
  assert.equal(buildEntry({ ...row, complementPaid: 1, complementPaidDate: '2026-08-24' }, 'complement', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, 720.82, 'every row of the stay shows the same gross');
});

test('rule 12 — the recorded platform gross wins on the stored-money fallback too (#11 = 1 983,92, 22209 = 315)', () => {
  for (const [gross, price] of [[1983.92, 2004.92], [315, 381]]) {
    const row = baseRow({ platform: 'GitesDeFrance', finalPrice: price, balanceAmount: gross, platformGrossAmount: gross, platformCommissionAmount: 100, clientGrossAmount: null, accommodationSoldeContribTtc: 1 });
    assert.equal(buildEntry(row, 'balance', lines({ hasContribs: true }), COMMISSION_CONTEXT, ctx).clientGrossAmount, gross);
  }
});

test('rule 12 — the older stored client gross comes back where 3.21.0 showed it (5 = 748, 6 = 793,65)', () => {
  for (const [gross, price] of [[748, 687], [793.65, 733]]) {
    const row = baseRow({ platform: 'GitesDeFrance', finalPrice: price, balanceAmount: price, clientGrossAmount: gross, platformGrossAmount: '', platformCommissionAmount: null, accommodationSoldeContribTtc: 0 });
    assert.equal(buildEntry(row, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, gross);
  }
});

test('rule 12 — nothing recorded: the stay price without the complements paid on site; an own channel shows none', () => {
  const row = baseRow({ platform: 'Booking', finalPrice: 400, balanceAmount: 270, complementAmount: 130, platformGrossAmount: '', clientGrossAmount: null, platformCommissionAmount: null, accommodationSoldeContribTtc: 0 });
  assert.equal(buildEntry(row, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, 270);
  assert.equal(buildEntry({ ...row, platform: 'direct' }, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, null);
});

test('rule 12 — the gross is read through the platform mode: a platform counted as a direct sale with nothing recorded shows none', () => {
  const { setDirectChannels } = require('../../../utils/platformNameFormat');
  const row = baseRow({ platform: 'Lodgify', finalPrice: 300, balanceAmount: 300, platformGrossAmount: '', clientGrossAmount: null, platformCommissionAmount: null, accommodationSoldeContribTtc: 0 });
  try {
    setDirectChannels(['Lodgify']);
    assert.equal(buildEntry(row, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, null);
    assert.equal(buildEntry({ ...row, platformGrossAmount: 310 }, 'balance', lines(), COMMISSION_CONTEXT, ctx).clientGrossAmount, 310);
  } finally {
    setDirectChannels([]);
  }
});

test('rule 12 — the gross is display only: the journal lines of an entry do not move with it', () => {
  const { entryToRows } = require('../accountingExport');
  const base = baseRow({ platform: 'Abracadaroom', finalPrice: 865.82, balanceAmount: 720.82, complementAmount: 132, platformCommissionAmount: 147.05, accommodationSoldeContribTtc: 0 });
  const accounts = (entry) => entryToRows(entry).map((r) => `${r[6]}|${r[7]}|${r[8]}`);
  const withRecorded = buildEntry({ ...base, platformGrossAmount: 720.82 }, 'balance', lines(), COMMISSION_CONTEXT, ctx);
  const without = buildEntry({ ...base, platformGrossAmount: '' }, 'balance', lines(), COMMISSION_CONTEXT, ctx);
  assert.deepEqual(accounts(withRecorded), accounts(without));
});
