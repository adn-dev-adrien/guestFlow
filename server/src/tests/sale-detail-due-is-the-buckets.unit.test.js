// specs/pricing-components.md §3 rule 31 and rule 104 e (stabilisation loop t6, UI6-1 / UI6-2 / UI6-3, 2026-11-16) — the sale panel's « Reste à
// payer » (`totals.dueCents`) is what the stored stay still asks: its open acompte, solde, installments and complements, gross, a rule-104 credit
// already off the bucket it sits in. Before: Σ lines − Σ line-level settled, so every euro paid through the acompte, the solde or the platform
// read as still due (a fully paid stay showed its whole price). The departure section's credit row offers nothing and reads its label once.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { stayOpenCents } = require('../utils/saleDetail');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const respond = () => ({ status() { return this; }, json() { return this; } });
const patch = (id, body) => ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, respond());

// A direct stay, solde paid, a 45 € basket due at the arrival, checked in, 30 € of beer paid cash (credit-panel fixture of the round-6 review).
function cashBeer({ collected = false } = {}) {
  const id = stay(20);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now: at(id, '12:00', -3) });
  patch(id, { balancePaid: true, balancePaidDate: todayIso() });
  patch(id, { checkInDone: true });
  if (collected) patch(id, { complementPaid: true, complementPaidDate: todayIso() });
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  return { id, ref: sold.saleDetail.lines.find((l) => l.articleKey === `option:${beer}`).ref };
}

test('UI6-2 — solde paid, basket open: « Reste à payer » is the 45 € the arrival asks, not 345 €', () => {
  const { id } = cashBeer();
  const detail = extraSale.saleDetailOf(id, at(id, '13:00', 1));
  assert.equal(detail.totals.dueCents, 4500);
});

test('UI6-1 / rule 104 e — the beer discounted 10 €: the credit is served and « Reste à payer » reads the 35 € the arrival asks', () => {
  const { id, ref } = cashBeer();
  const now = at(id, '13:00', 1);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { now }).status, 200);
  const detail = extraSale.saleDetailOf(id, now);
  assert.deepEqual(detail.credits.map((c) => [c.bucket, c.totalCents]), [['arrival', -1000]]);
  assert.equal(detail.buckets.arrival, 3500);
  assert.equal(detail.totals.dueCents, 3500);
});

test('UI6-2 — a stay paid in full asks nothing; a platform stay paid by the platform asks nothing', () => {
  const { id } = cashBeer({ collected: true });
  assert.equal(extraSale.saleDetailOf(id, at(id, '13:00', 1)).totals.dueCents, 0);
  const platform = stay(20);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(platform);
  ctrl.performUpdate(platform, { ...storedBody(platform), restatePricing: true });
  patch(platform, { balancePaid: true, balancePaidDate: todayIso() });
  assert.equal(extraSale.saleDetailOf(platform).totals.dueCents, 0);
});

test('UI6-2 — the open figure is gross: no commission or penalty netted out, a cancelled stay asks nothing through its sale', () => {
  const base = {
    kind: 'reservation', depositAmount: 100, depositPaid: 0, balanceAmount: 200, balancePaid: 0, complementAmount: 45, complementPaid: 0,
    endOfStayComplementAmount: 12.5, endOfStayComplementPaid: 0, acompteCommissionAmount: 15, platformCommissionAmount: 30, platformPenaltyAmount: 20,
  };
  assert.equal(stayOpenCents(base), 35750);
  assert.equal(stayOpenCents({ ...base, depositPaid: 1, complementPaidCash: 1 }), 21250);
  assert.equal(stayOpenCents({ ...base, kind: 'cancelled' }), 0);
});

test('UI6-3 — the departure credit row offers nothing and carries no second « Déjà réglé »', () => {
  const { id, ref } = cashBeer({ collected: true });
  const now = at(id, '13:00', 1);
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Balade', amount: 65 }], { now });
  extraSale.changeLine(id, ref, { offered: true }, { now });
  const section = extraSale.departureSalesOf(id, now);
  const credit = section.lines.find((l) => l.status === 'credit');
  assert.deepEqual([credit.totalCents, credit.offerable, credit.statusLabel], [-3000, false, null]);
  assert.equal(section.dueCents, 3500);
});
