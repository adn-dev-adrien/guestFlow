// specs/platform-added-guests-tourist-tax.md rules 13, 17 — the balance and complement entries share the
// added guests' tourist tax without a cent lost, on a solde whose contribs are frozen or not.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, createStay, inDays, rowOf, save, mark, seed } = require('../../../tests/ledgerFixture');
const { __test: { buildEntry }, create: createAccountingModel } = require('../accountingModel');
const { create: createAccountingController } = require('../controller');
const { todayIso } = require('../../../utils/localDate');

const TODAY = todayIso();
const TAX_ACCOUNT = '46710000';
const context = { vatRate: 10, vatRateCommission: 20 };
const taxContext = { collectedOnArrival: false };

const accountingRow = (extra) => ({
  id: 1, platform: 'Canal', finalPrice: 595.2, touristTaxTotal: 7.2, touristTaxAddedGuestsAmount: 2.4,
  balanceAmount: 600, balancePaid: 1, balancePaidDate: TODAY,
  complementAmount: 2.4, complementPaid: 1, complementPaidDate: TODAY, firstName: 'J', lastName: 'D', propertyName: 'Gite',
  ...extra,
});
const taxOf = (row, kind) => buildEntry(row, kind, null, context, taxContext).taxTtc;

test('rule 13: the solde books what was reversed, the complement the added tax', () => {
  assert.equal(taxOf(accountingRow(), 'balance'), 4.8);
  assert.equal(taxOf(accountingRow(), 'complement'), 2.4);
});

test('rule 13: without added tax the solde books the whole tax, as before', () => {
  const row = accountingRow({ touristTaxAddedGuestsAmount: 0, touristTaxTotal: 4.8 });
  assert.equal(taxOf(row, 'balance'), 4.8);
  assert.equal(taxOf(row, 'complement'), 0);
});

const frozen = { accommodationSoldeContribTtc: 595.2, touristTaxSoldeContribTtc: 4.8 };

test('rule 17: a frozen solde keeps its tax, the complement books the rest, the addition once', () => {
  const row = accountingRow(frozen);
  assert.equal(taxOf(row, 'balance'), 4.8);
  assert.equal(taxOf(row, 'complement'), 2.4);
});

test('rule 17: a tax that rose after the solde, with no addition, still rides the complement', () => {
  const row = accountingRow({ ...frozen, touristTaxAddedGuestsAmount: 0 });
  assert.equal(taxOf(row, 'balance'), 4.8);
  assert.equal(taxOf(row, 'complement'), 2.4);
});

test('rule 17: contribs that no longer describe the solde read the addition instead', () => {
  const row = accountingRow({ accommodationSoldeContribTtc: 100, touristTaxSoldeContribTtc: 1 });
  assert.equal(taxOf(row, 'balance'), 4.8);
  assert.equal(taxOf(row, 'complement'), 2.4);
});

test('rule 17: reversed platform, gross entered, 2 → 3 adults, solde then complement paid', async () => {
  seed();
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests,
      extraGuestPrice, extraGuestPriceUnit, defaultCautionAmount)
    VALUES (3, 'Gîte', 8, 'per_day_per_person', 1.2, 2, 20, 'per_night', 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 300)").run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();

  const stay = { propertyId: 3, platform: 'Canal', startDate: inDays(100), endDate: inDays(102) };
  const id = createStay({ ...stay, platformGrossAmount: 600 });
  assert.equal(rowOf(id).balanceAmount, 600);

  const saved = await save(id, { ...stay, adults: 3, platformGrossAmount: 600 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(id).balanceAmount, 600);
  assert.equal(rowOf(id).complementAmount, 42.4);
  assert.equal(rowOf(id).touristTaxAddedGuestsAmount, 2.4);

  const solde = mark(id, { balancePaid: true, balancePaidDate: TODAY });
  assert.equal(solde.statusCode, 200, JSON.stringify(solde.body));
  assert.equal(rowOf(id).touristTaxSoldeContribTtc, 4.8);
  const complement = mark(id, { complementPaid: true, complementPaidDate: TODAY });
  assert.equal(complement.statusCode, 200, JSON.stringify(complement.body));

  const journal = () => {
    let month = null;
    const res = { setHeader() {}, status() { return res; }, json(b) { month = b; return res; } };
    createAccountingController(createAccountingModel(db))
      .salesJson({ query: { year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) } }, res);
    return month;
  };
  const taxCredit = (month, kind) => month.entries.find((e) => e.reservationId === id && e.kind === kind).lines
    .filter((l) => l.compte === TAX_ACCOUNT).reduce((sum, l) => sum + Number(l.credit), 0);
  const month = journal();
  assert.equal(month.totals.allBalanced, true);
  assert.equal(taxCredit(month, 'balance'), 4.8);
  assert.equal(taxCredit(month, 'complement'), 2.4);

  // Contribs that no longer describe the solde: the export reads the addition from its own SELECT.
  db.prepare('UPDATE reservations SET accommodationSoldeContribTtc = 100 WHERE id = ?').run(id);
  assert.equal(taxCredit(journal(), 'balance'), 4.8);
});
