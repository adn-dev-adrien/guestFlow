// specs/vat-optional-mode.md rules 10, 11 and 13 — « Sans TVA » moves no price: the same TTC figures on
// a direct, a platform, a discounted and an installment stay, VAT extracted at 0 so HT = TTC; the
// proportional tourist tax follows the price paid (its base HT is the price itself), a frozen or
// declared one never moves; a view that spans both regimes treats each row with its own.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const finance = require('../models/financeModel');

db.prepare("UPDATE reservations SET discountPercent = 10 WHERE id = 105").run();
db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-05-16' WHERE id = 103").run();
db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-07-03' WHERE id = 106").run();

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const quote = (id, extra = {}) => calculateReservationQuote({ ...buildReservationEngineInput(db, row(id)), ...extra });
const NOT_SUBJECT = Number(db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run().lastInsertRowid);
const toggle = (id, notSubject) => db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?').run(notSubject ? NOT_SUBJECT : 1, id);

const STAY_MONEY = ['totalPrice', 'finalPrice', 'engineFinalPrice', 'accommodationAdjustedPrice', 'optionsTotal', 'resourcesTotal', 'discountAmount'];
const ALL_MONEY = [...STAY_MONEY, 'depositAmount', 'balanceAmount', 'complementAmount', 'totalStayPrice', 'platformCommissionAmount',
  'acompteCommissionAmount', 'platformNetReceivedAmount', 'preArrivalAmount', 'sejourNetTotal'];

// The stays whose tourist tax is proportional (L'Estiva, direct) keep the price of the stay only: the tax
// is the one thing the regime moves (rule 11), and the totals that include it move with it.
for (const [label, id, keys] of [['direct', 101, ALL_MONEY], ['airbnb platform', 102, ALL_MONEY], ['booking platform, proportional tax', 104, ALL_MONEY],
  ['discounted', 105, ALL_MONEY], ['installment plan, proportional tax', 106, STAY_MONEY]]) {
  test(`rule 10: a ${label} stay keeps every TTC figure, the VAT extracted at 0`, () => {
    const before = quote(id);
    toggle(id, true);
    const after = quote(id);
    toggle(id, false);
    for (const key of keys) assert.deepEqual(after[key], before[key], key);
    assert.equal(after.vatRegime.regime, 'not_subject');
    assert.deepEqual([after.vatPercentageAccommodation, after.vatPercentageOptions, after.vatPercentageResources], [0, 0, 0]);
    assert.equal(after.totalVatAmount, 0);
    assert.equal(after.totalNetPrice, after.finalPrice);
  });
}

test('rule 11: a tourist tax per person and per night does not move', () => {
  const before = quote(101).touristTaxTotal;
  toggle(101, true);
  const after = quote(101).touristTaxTotal;
  toggle(101, false);
  assert.equal(after, before);
});

test('rule 11: the proportional tourist tax is based on the price paid, so it rises by the rate', () => {
  const before = quote(106);
  toggle(106, true);
  const after = quote(106);
  toggle(106, false);
  assert.ok(Math.abs(before.touristTaxBaseHt - before.touristTaxAccommodationPaid / 1.1) < 0.05);
  assert.ok(Math.abs(after.touristTaxBaseHt - after.touristTaxAccommodationPaid) < 0.05);
  assert.ok(Math.abs(after.touristTaxTotal / before.touristTaxTotal - 1.1) < 0.03, `${after.touristTaxTotal} / ${before.touristTaxTotal}`);
  assert.equal(Math.round((after.totalStayPrice - before.totalStayPrice) * 100), Math.round((after.touristTaxTotal - before.touristTaxTotal) * 100));
});

test('rule 11: a frozen tourist tax never changes because of a regime', () => {
  assert.ok(row(103).touristTaxFrozenAt);
  const before = quote(103, { freezeTouristTax: true });
  toggle(103, true);
  const after = quote(103, { freezeTouristTax: true });
  toggle(103, false);
  assert.equal(after.touristTaxTotal, before.touristTaxTotal);
  assert.equal(after.touristTaxFrozen, true);
});

test('rule 11: a declared tourist tax never changes because of a regime', () => {
  const page = () => finance.getTouristTaxExtraction({ month: '2027-07' }).data.reservations.filter((r) => r.reservationId === 106)
    .map((r) => [r.reservationId, r.taxAmount, r.touristTaxDeclaredAt]);
  const before = page();
  assert.equal(before.length, 1);
  toggle(106, true);
  const after = page();
  toggle(106, false);
  assert.deepEqual(after, before);
});

test('rule 13: a view spanning both regimes treats each stay with its own rate', () => {
  const { totalSejour, htAmount } = finance.helpers;
  const mixed = (flag) => { toggle(104, flag); return finance.getSummary({ fiscalYear: 2027 }); };
  const asSubject = mixed(false);
  const withOne = mixed(true);
  toggle(104, false);
  const stay = totalSejour(row(104));
  const delta = Math.round((htAmount(row(104), stay, 0) - htAmount(row(104), stay, 10)) * 100) / 100;
  assert.ok(delta > 0);
  assert.equal(Math.round((withOne.yearTotalHt - asSubject.yearTotalHt) * 100) / 100, delta);
  assert.equal(withOne.showHt, true);
});

test('rule 13: the accounting month holds entries with VAT and entries without', () => {
  const { create } = require('../plugins/accounting-export/accountingModel');
  toggle(104, true);
  const entries = create(db).encaissementsByMonth({ month: 8, year: 2027 });
  toggle(104, false);
  assert.deepEqual(entries.filter((e) => e.reservationId === 104).flatMap((e) => e.buckets).map((b) => [b.ratePercent, b.vat]), [[0, 0]]);
});
