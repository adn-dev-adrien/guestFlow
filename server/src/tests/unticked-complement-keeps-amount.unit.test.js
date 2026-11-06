// specs/reservation-payment-ledger.md rule 67 (audit R23 N8 withdrawn, 2026-11-05) — a complement un-ticked keeps its amount, so
// a mis-click corrected by a re-tick rewrites no collected money. A stale amount after a forced line removal is accepted.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, rowOf, NO_ACOMPTE, S, C, forced, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');

const money = (id) => {
  const { complementAmount, endOfStayComplementAmount, complementAllocation } = rowOf(id);
  return { complementAmount, endOfStayComplementAmount, complementAllocation };
};

test('un-tick then re-tick: every amount stays, with no history line', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  const before = money(stay.id);
  const entries = () => db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(stay.id).n;
  const history = entries();
  pay(stay.id, { complementPaid: false });
  assert.deepEqual(money(stay.id), before);
  pay(stay.id, C);
  assert.deepEqual(money(stay.id), before);
  assert.equal(entries(), history);
});

test('a growth claimed at the end of stay stays there: the re-tick moves nothing and claims nothing twice', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  const before = money(stay.id);
  assert.equal(before.endOfStayComplementAmount, 42.4);
  pay(stay.id, { complementPaid: false });
  assert.deepEqual(money(stay.id), before);
  assert.equal(ficheView(stay.id).ledger.remaining, 62.4);
  pay(stay.id, C);
  assert.deepEqual(money(stay.id), before);
});

test('accepted: forced 50 €, line removed by a forced save, un-tick: the 50 € stays due until the operator adjusts it', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [] });
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  await put(stay, { complementAmountOverride: 10 });
  assert.equal(rowOf(stay.id).complementAmount, 10);
});

test('an operator’s adjusted complement keeps his amount', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S);
  await put(stay, { complementAmountOverride: 80 });
  pay(stay.id, C);
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 80);
});

test('the arrival undo keeps the amount too', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  const settle = (mode) => {
    const res = respond();
    controller.settleArrivalPayment({ params: { id: stay.id }, body: { mode, date: TODAY }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  };
  settle('card');
  await put(stay, { customOptions: [] });
  settle('undo');
  assert.equal(rowOf(stay.id).complementPaid, 0);
  assert.equal(rowOf(stay.id).complementAmount, 50);
});

// Audit R24-DB-3 (2026-11-05) — the correction rule 67 names: an adjustment equal to the engine's figure used to read as « no
// pricing input moved », so the save pinned the stale amount back beside the new adjustment.
test('the stale 50 € adjusted to 0: the complement is 0, the ledger asks nothing more', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [] });
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  await put(stay, { complementAmountOverride: 0 });
  assert.equal(rowOf(stay.id).complementAmount, 0);
  assert.equal(rowOf(stay.id).complementAmountOverride, 0);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
});

test('an unpaid end-of-stay complement adjusted to 0 is 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
  await put(stay, { endOfStayComplementAmountOverride: 0 });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 0);
});

test('an adjustment sent back unchanged keeps the stay as priced', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S);
  await put(stay, { complementAmountOverride: 80 });
  const before = rowOf(stay.id);
  await put(stay, { complementAmountOverride: 80 });
  const after = rowOf(stay.id);
  assert.equal(after.complementAmount, 80);
  assert.equal(after.finalPrice, before.finalPrice);
});
