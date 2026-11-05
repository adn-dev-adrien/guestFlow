// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-05 (audit R23 N4) — D9 makes an end-of-stay
// complement exist before arrival. Once it is paid, a future stay refuses what would raise the stay, as a started stay does:
// nothing could claim it any more. A lowering or an unchanged save still passes.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, NO_ACOMPTE, S, C, forced, free, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');

const E = { endOfStayComplementPaid: true, endOfStayComplementPaidDate: TODAY };

async function save(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user: ADMIN }, res);
  return res;
}

async function paidEndOfStay() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  pay(stay.id, E);
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
  pay(stay.id, { endOfStayComplementPaidCash: true, endOfStayComplementPaidDate: TODAY });
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
