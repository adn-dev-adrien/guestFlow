// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-05 (audit R23 N4) — D9 makes an end-of-stay
// complement exist before arrival. Once it is paid, a future stay refuses what would raise the stay, as a started stay does:
// nothing could claim it any more. A lowering or an unchanged save still passes.
// Reading of 2026-11-06 (D20, reservation-payment-ledger rule 68): no path collects the end of stay before the check-out, so a
// stay in this state is a row stored before D20, written here as stored. Audit R26 MEDIUM 1: a started fiche still locked is
// judged too (its price adjustments are allowed fields); the admin unlock is not.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, rowOf, NO_ACOMPTE, S, C, forced, free, fiche, put, pay, storedEndOfStayPaid, ficheView,
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

test('D20: an admin unlock of a started stay is not judged, no end of stay being collected before the check-out; a stored one is not rewritten', async () => {
  const stay = await paidEndOfStay();
  db.prepare("UPDATE reservations SET startDate = date('now', '-1 day'), endDate = date('now', '+1 day') WHERE id = ?").run(stay.id);
  const moved = { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate };
  const res = await save(stay, { ...moved, adults: 4, unlockPast: true });
  assert.notEqual(res.body.code, 'MID_STAY_EXTRAS_CLOSED', JSON.stringify(res.body));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
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
