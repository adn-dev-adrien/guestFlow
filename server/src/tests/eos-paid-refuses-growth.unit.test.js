// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-05 (audit R23 N4) — D9 makes an end-of-stay
// complement exist before arrival. Once it is paid, a future stay refuses what would raise the stay, as a started stay does:
// nothing could claim it any more. A lowering or an unchanged save still passes.
// Reading of 2026-11-06 (D20, reservation-payment-ledger rule 68): no path collects the end of stay before the check-out, so a
// stay in this state is a row stored before D20, written here as stored. Audit R26 MEDIUM 1: a started fiche still locked is
// judged too (its price adjustments are allowed fields), on the part of the rise no unpaid bucket takes on (audit R26
// finding 1); the admin unlock refuses any final price change (D21).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, rowOf, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, forced, free, fiche, put, pay,
  storedEndOfStayPaid, ficheView, unclaimed, TODAY,
} = require('./moneyLedgerFixture');

async function save(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user: ADMIN }, res);
  return res;
}

async function paidEndOfStay() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
  return stay;
}

test('one adult more: refused, the stay does not move', async () => {
  const stay = await paidEndOfStay();
  const before = rowOf(stay.id);
  const res = await save(stay, { adults: 4 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.match(res.body.error, /décocher « payé »/);
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
  assert.equal(rowOf(stay.id).adults, 3);
});

test('a 30 € line: refused', async () => {
  const stay = await paidEndOfStay();
  const res = await save(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
});

test('the same in the caisse interne: refused', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id, { cash: true });
  assert.equal((await save(stay, { adults: 4 })).body.code, 'MID_STAY_EXTRAS_CLOSED');
});

test('an unchanged save and a lowering pass', async () => {
  const stay = await paidEndOfStay();
  assert.equal((await save(stay, {})).statusCode, 200);
  assert.equal((await save(stay, { adults: 2 })).statusCode, 200);
  assert.equal(rowOf(stay.id).adults, 2);
});

test('a text change passes: the total does not rise', async () => {
  const stay = await paidEndOfStay();
  assert.equal((await save(stay, { notes: 'Arrivée tardive' })).statusCode, 200);
});

test('the end of stay un-ticked, the growth passes again and is claimed', async () => {
  const stay = await paidEndOfStay();
  pay(stay.id, { endOfStayComplementPaid: false });
  assert.equal((await save(stay, { adults: 4 })).statusCode, 200);
  assert.equal(ficheView(stay.id).ledger.remaining, 84.8);
});

test('no paid end of stay: growth passes, as before', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  assert.equal((await save(stay, { adults: 3 })).statusCode, 200);
});

// Audit R23 L1.
test('a rise of the tax alone: refused, the price has not moved', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { adults: 2, children: 1, customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { children: 2 });
  storedEndOfStayPaid(stay.id);
  const before = rowOf(stay.id);
  const res = await save(stay, { adults: 3, children: 1 });
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).touristTaxTotal, before.touristTaxTotal);
});

// D21 (Adrien, 2026-11-06) replaces N4's « unlock of a started stay unchanged »: the unlocked fiche keeps its final price
// (specs/settings-rationalization.md rule 35), so the growth line 308 of the audit registry feared is refused there too.
test('D21: an admin unlock of a started stay refuses the growth, the stay does not move', async () => {
  const stay = await paidEndOfStay();
  db.prepare("UPDATE reservations SET startDate = date('now', '-1 day'), endDate = date('now', '+1 day') WHERE id = ?").run(stay.id);
  const moved = { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate };
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, adults: 4, unlockPast: true });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'UNLOCKED_PRICE_CHANGED');
  assert.equal(rowOf(stay.id).adults, 3);
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
});

// Audit R26 MEDIUM 1 (reviewer's w3b probe) — started, NOT unlocked: the discount is an allowed field of the locked fiche.
async function startedLocked({ collected }) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)], discountPercent: 5 });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  if (collected) storedEndOfStayPaid(stay.id);
  db.prepare("UPDATE reservations SET startDate = date('now', '-1 day'), endDate = date('now', '+1 day') WHERE id = ?").run(stay.id);
  return { stay, moved: { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate } };
}

test('R26 MEDIUM 1: a discount removed on a started locked fiche whose end of stay is collected: refused, nothing moves', async () => {
  const { stay, moved } = await startedLocked({ collected: true });
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
  assert.equal(rowOf(stay.id).discountPercent, 5);
});

test('R26 MEDIUM 1: the same with the end of stay open passes, the rise claimed on it', async () => {
  const { stay, moved } = await startedLocked({ collected: false });
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(rowOf(stay.id).finalPrice > before.finalPrice);
  assert.ok(rowOf(stay.id).endOfStayComplementAmount > before.endOfStayComplementAmount);
});

test('R26 MEDIUM 1: a forbidden change on that fiche keeps its own refusal', async () => {
  const { stay, moved } = await startedLocked({ collected: true });
  const res = await save(stay, { ...moved, adults: 4 });
  assert.equal(res.body.code, 'PAST_RESERVATION_LOCKED');
});

// Audit R26 finding 1 (reviewer's p2 / p3 probes) — a checked-out stay whose end of stay was collected at departure and whose
// solde is still open: the rise lands on the solde, nothing is left unclaimed, the save passes. All paid stays refused.
async function checkedOut(platform, marks) {
  const stay = fiche(platform === 'direct' ? WITH_ACOMPTE : NO_ACOMPTE, platform, { customOptions: [forced(20)], discountPercent: 5 });
  pay(stay.id, ...marks);
  db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 30, endOfStayComplementDetail = ?, endOfStayComplementPaid = 1,
      endOfStayComplementPaidDate = date('now'), endOfStayComplementPaidAtDeparture = 1,
      startDate = date('now', '-3 day'), endDate = date('now', '-1 day'), departureSasDoneAt = datetime('now'), checkOutDone = 1 WHERE id = ?`)
    .run(JSON.stringify([{ label: 'Ménage', qty: 1, unitPrice: 30, amount: 30, key: 'cleaning' }]), stay.id);
  return { stay, moved: { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate } };
}

for (const platform of ['direct', PLATFORM.remitted, PLATFORM.reversed, PLATFORM.owner]) {
  test(`finding 1: ${platform}, checked out, solde open: a discount removed passes, the rise on the solde`, async () => {
    const { stay, moved } = await checkedOut(platform, platform === 'direct' ? [D, C] : [C]);
    const before = rowOf(stay.id);
    const res = await save(stay, { ...moved, discountPercent: 0 });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const after = rowOf(stay.id);
    assert.ok(after.finalPrice > before.finalPrice);
    assert.equal(Math.round((after.balanceAmount - before.balanceAmount) * 100) / 100,
      Math.round((after.finalPrice + after.touristTaxTotal - before.finalPrice - before.touristTaxTotal) * 100) / 100);
    assert.equal(after.endOfStayComplementAmount, 30);
    assert.equal(unclaimed(stay.id) + 0, 0);
  });
}

test('finding 1: the same stay with its solde paid: refused, nothing would claim the rise', async () => {
  const { stay, moved } = await checkedOut('direct', [D, S, C]);
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
});

// Audit R26 D21 review L3 — a direct stay paid by a plan keeps its solde at 0: the unpaid installments are what claims a rise
// (the save re-spreads it on them, direct-installments rules 7-9a). A checked-out stay with one installment still unpaid
// accepts a removed discount, the installment taking it; a fully paid plan is still refused.
const installmentsController = require('../controllers/installmentsController');

async function checkedOutOnPlan(paidCount) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)], discountPercent: 5 });
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  const rows = db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  for (const row of rows.slice(0, paidCount)) {
    const paid = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: row.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, paid);
    assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  }
  return checkedOutStay(stay);
}

function checkedOutStay(stay) {
  pay(stay.id, C);
  db.prepare(`UPDATE reservations SET endOfStayComplementAmount = 30, endOfStayComplementDetail = ?, endOfStayComplementPaid = 1,
      endOfStayComplementPaidDate = date('now'), endOfStayComplementPaidAtDeparture = 1,
      startDate = date('now', '-3 day'), endDate = date('now', '-1 day'), departureSasDoneAt = datetime('now'), checkOutDone = 1 WHERE id = ?`)
    .run(JSON.stringify([{ label: 'Ménage', qty: 1, unitPrice: 30, amount: 30, key: 'cleaning' }]), stay.id);
  return { stay, moved: { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate } };
}

const planOf = (id) => db.prepare('SELECT number, amountCents, paid FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id);

test('L3: checked out, one installment unpaid: a discount removed passes, the installment takes the rise', async () => {
  const { stay, moved } = await checkedOutOnPlan(1);
  const before = rowOf(stay.id);
  const [, unpaidBefore] = planOf(stay.id);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = rowOf(stay.id);
  const rise = Math.round((after.finalPrice + after.touristTaxTotal - before.finalPrice - before.touristTaxTotal) * 100);
  assert.ok(rise > 0);
  const [, unpaidAfter] = planOf(stay.id);
  assert.equal(unpaidAfter.amountCents - unpaidBefore.amountCents, rise);
  assert.equal(after.endOfStayComplementAmount, 30);
  assert.equal(ficheView(stay.id).ledger.remaining, unpaidAfter.amountCents / 100);
});

test('L3: the same stay with its plan fully paid: refused, nothing would claim the rise', async () => {
  const { stay, moved } = await checkedOutOnPlan(2);
  const before = rowOf(stay.id);
  const plan = planOf(stay.id);
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
  assert.deepEqual(planOf(stay.id), plan);
});

// Audit R27-RES-1 (auditor's p2 / p3 probes) — a checked-out stay whose every bucket and end of stay are collected holds a
// trop-perçu once a discount typed by mistake lowered it: the money already collected claims a rise up to that trop-perçu
// (the ledger's own figure, net of the free refunds), so the operator can take the discount back. Above it, still refused.
async function overCollected() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)], discountPercent: 5 });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id);
  db.prepare("UPDATE reservations SET startDate = date('now', '-3 day'), endDate = date('now', '-1 day') WHERE id = ?").run(stay.id);
  const moved = { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate, adults: 3 };
  const typo = await save(stay, { ...moved, discountPercent: 20 });
  assert.equal(typo.statusCode, 200, JSON.stringify(typo.body));
  return { stay, moved, overpayment: () => (ficheView(stay.id).ledger.rows.find((r) => r.key === 'overpayment') || { amount: 0 }).amount };
}

test('R27-RES-1: 20 % typed by mistake, back to 5 %: passes, the trop-perçu is gone', async () => {
  const { stay, moved, overpayment } = await overCollected();
  assert.equal(rowOf(stay.id).finalPrice, 540);
  assert.equal(overpayment(), 90);
  const res = await save(stay, { ...moved, discountPercent: 5 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).finalPrice, 630);
  assert.equal(overpayment(), 0);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
});

test('R27-RES-1: 20 % → 10 %: passes, 30 € of trop-perçu left', async () => {
  const { stay, moved, overpayment } = await overCollected();
  const res = await save(stay, { ...moved, discountPercent: 10 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).finalPrice, 600);
  assert.equal(overpayment(), 30);
});

test('R27-RES-1: 20 % → 0 %: refused, 30 € above what was collected, nothing moves', async () => {
  const { stay, moved } = await overCollected();
  const res = await save(stay, { ...moved, discountPercent: 0 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(rowOf(stay.id).finalPrice, 540);
  assert.equal(rowOf(stay.id).discountPercent, 20);
});
