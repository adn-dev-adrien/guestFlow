// specs/platform-added-guests-tourist-tax.md rule 19 (audit R22-8, 2026-11-05) — the tax the pre-arrival money holds is
// touristTaxTotal − touristTaxAddedGuestsAmount; the addition rides the complement. On a plan, a link, the avoir and the
// acompte's ceiling. Replay of the auditor's p5 probe.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, PLATFORM, C, fiche, put, pay, rowOf, net, entriesOf, TODAY,
} = require('./journalFixture');
const { respond, ADMIN, cancel, giveAll } = require('./journalFixture');
const installmentsController = require('../../../controllers/installmentsController');
const paymentsController = require('../../../controllers/paymentsController');
const { storedLinkComponents } = require('../../../utils/storedLinkComponents');
const { computeInstallmentPaidSplit } = require('../../../utils/installmentPaidSplit');

const TAX = '46710000';

async function planOfTwo(stay) {
  const res = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return db.prepare('SELECT id, amountCents FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
}
async function payInstallment(stay, installment) {
  const res = respond();
  await installmentsController.markPaid({ params: { id: stay.id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
const taxOnJournal = (id) => entriesOf(id).flatMap((e) => e.lines).filter((l) => String(l.compte) === TAX)
  .reduce((sum, l) => sum + Number(l.credit || 0) - Number(l.debit || 0), 0);

test('a plan on an own channel with a guest added: 46710000 holds 7,20 €, never 9,60 €', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).touristTaxTotal, 7.2);
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  const split = plan.map((i) => computeInstallmentPaidSplit(db, i.id));
  assert.equal(split.reduce((sum, s) => sum + s.taxCents, 0), 480);
  pay(stay.id, C);
  assert.equal(Math.round(taxOnJournal(stay.id) * 100) / 100, 7.2);
});

test('the link basket of the plan names the tax the money holds', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  const components = paymentsController.__test.resolveInstallmentComponents(stay.id, plan[0], plan, db).components;
  const tax = components.find((c) => c.title === 'Taxe de séjour');
  assert.equal(tax.grossCents, 240);
});

test('a plan cancelled: the avoir reverses the tax the plan collected, everything given back nets to 0', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  await payInstallment(stay, plan[0]);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('the link of a solde: 595,20 € + 4,80 €, the added tax out of it', () => {
  const row = { depositAmount: 0, balanceAmount: 600, touristTaxTotal: 7.2, touristTaxAddedGuestsAmount: 2.4 };
  const { components } = storedLinkComponents(row, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: { balance: 'Solde' } });
  assert.deepEqual(components.map((c) => c.grossCents), [59520, 480]);
});

test('no added tax: the link is unchanged', () => {
  const row = { depositAmount: 0, balanceAmount: 604.8, touristTaxTotal: 4.8 };
  const { components } = storedLinkComponents(row, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: { balance: 'Solde' } });
  assert.deepEqual(components.map((c) => c.grossCents), [60000, 480]);
});
