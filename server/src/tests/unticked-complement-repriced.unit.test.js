// specs/reservation-payment-ledger.md rule 67 (audit R23 N8, 2026-11-05) — a complement un-ticked asks what the stay asks now,
// never the amount it collected: with its line removed since, it stayed at 50 € due on a stay fully covered.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, S, C, forced, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');

test('the auditor’s E: forced 50 €, line removed by a forced save, un-tick: nothing is asked, nothing to mark again', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [] });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 0);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
  assert.equal(mark(stay.id, C).body.code, 'NOTHING_TO_COLLECT');
});

test('a growth claimed at the end of stay comes back on the complement, never claimed twice', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
  pay(stay.id, { complementPaid: false });
  const row = rowOf(stay.id);
  assert.equal(row.complementAmount, 62.4);
  assert.equal(row.endOfStayComplementAmount, 0);
  assert.equal(ficheView(stay.id).ledger.remaining, 62.4);
});

test('an amount unchanged: the un-tick and the re-tick land on the same figure, with no history line', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  const entries = () => db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(stay.id).n;
  const before = entries();
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  assert.equal(entries(), before);
  pay(stay.id, C);
  assert.equal(rowOf(stay.id).complementAmount, 50);
});

test('an operator’s adjusted complement keeps his amount', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S);
  await put(stay, { complementAmountOverride: 80 });
  pay(stay.id, C);
  assert.equal(rowOf(stay.id).complementAmount, 80);
  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).complementAmount, 80);
});

test('a changed amount leaves a line in the history', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [] });
  pay(stay.id, { complementPaid: false });
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id DESC').all(stay.id)[0].changedFields;
  assert.match(history, /complementAmount/);
});

test('the arrival undo re-prices it the same way', async () => {
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
  assert.equal(rowOf(stay.id).complementAmount, 0);
});
