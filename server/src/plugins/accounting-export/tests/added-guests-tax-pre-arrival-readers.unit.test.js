// specs/platform-added-guests-tourist-tax.md rule 19 (audit R22-8, 2026-11-05) — the tax the pre-arrival money holds is
// touristTaxTotal − touristTaxAddedGuestsAmount; the addition rides the complement. On a plan, a link, the avoir and the
// acompte's ceiling. Replay of the auditor's p5 probe.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, C, forced, fiche, put, pay, rowOf, net, entriesOf, TODAY, register, offered, ficheView,
} = require('./journalFixture');
const { respond, ADMIN, cancel, giveAll } = require('./journalFixture');
const installmentsController = require('../../../controllers/installmentsController');
const paymentsController = require('../../../controllers/paymentsController');
const { storedLinkComponents } = require('../../../utils/storedLinkComponents');
const { computeInstallmentPaidSplit } = require('../../../utils/installmentPaidSplit');
const { bookedStayBuckets } = require('../../../utils/cancelReservation');
const { collectedByLine } = require('../../../utils/refunds');
const reservationsModel = require('../../../models/reservationsModel');
const installmentsModel = require('../../../models/installmentsModel');

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

test('L1 — plan of 2 paid, an added guest, its complement paid, cancelled: everything given back nets every account to 0', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  pay(stay.id, C);
  await cancel(stay.id);
  assert.deepEqual(offered(stay.id), { accommodation: 635.2, touristTax: 7.2 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('L1 — the same with one installment paid: the plan\'s share of what it collected, no more', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  await payInstallment(stay, plan[0]);
  pay(stay.id, C);
  await cancel(stay.id);
  const lines = offered(stay.id);
  assert.equal(Math.round((lines.accommodation + lines.touristTax) * 100) / 100, 342.4);
  assert.equal(lines.touristTax, 4.8);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('L1 — no added guest, a forced line in the complement: unchanged and sound', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  pay(stay.id, C);
  await cancel(stay.id);
  assert.deepEqual(offered(stay.id), { accommodation: 600, 'custom:forcée': 50, touristTax: 4.8 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('L1 — the tax on the complement: the plan holds none, the complement all of it', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1 });
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  pay(stay.id, C);
  await cancel(stay.id);
  assert.deepEqual(offered(stay.id), { accommodation: 600, touristTax: 4.8 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('L1 — the caisse interne\'s reading holds no installment: a complement paid there offers its own money only in cash', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  pay(stay.id, { ...C, complementPaidCash: true });
  await cancel(stay.id);
  const lines = register(stay.id).refundableLines;
  assert.equal(lines.reduce((sum, line) => sum + (line.cashTtc || 0), 0).toFixed(2), '42.40');
  const details = reservationsModel.getByIdWithDetails(stay.id);
  const booked = bookedStayBuckets({ database: db, reservationsModel, installmentsModel }, details, 10);
  assert.equal(collectedByLine({ reservation: details, booked, cash: true }).accommodation, 40);
  assert.equal(collectedByLine({ reservation: details, booked }).accommodation, 595.2);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('R22-8 readers — the export\'s own shares, on an installment with no frozen split: 4,80 € of tax, never 7,20 €', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  for (const installment of plan) await payInstallment(stay, installment);
  db.prepare('UPDATE reservation_installments SET paidSplit = NULL WHERE reservationId = ?').run(stay.id);
  assert.equal(Math.round(taxOnJournal(stay.id) * 100) / 100, 4.8);
});

test('R22-8 readers — the avoir\'s own shares, when no split is at hand: the tax of the installment paid, without the addition', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const plan = await planOfTwo(stay);
  await payInstallment(stay, plan[0]);
  const planOnly = { listFor: installmentsModel.listFor };
  const row = rowOf(stay.id);
  const { installments } = bookedStayBuckets({ database: null, reservationsModel, installmentsModel: planOnly }, row, 10);
  assert.equal(installments.touristTax, 2.4);
  assert.equal(installments.accommodation, Math.round(plan[0].amountCents - 240) / 100);
});

test('R22-8 readers — the acompte\'s ceiling on the stored ledger leaves the addition out', async () => {
  const stay = fiche(WITH_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const deposit = ficheView(stay.id).ledger.rows.find((row) => row.key === 'deposit');
  assert.equal(deposit.amountEdit.max, 595.2);
});
