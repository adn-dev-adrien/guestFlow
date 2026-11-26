// specs/pricing/pricing-components.md §3 rules 23, 93, 104 (stabilisation loop t5, S5-2, 2026-11-16) — a stay whose arrival complement the engine no longer
// reproduces (stored 0, the engine of today asks a gap): a cash-paid line offered is credited to that complement by the engine, the stored one stops
// at 0 and the 30 € become the refund owed. Un-offered, the line is the note's again: the refund closes and nothing is asked. Before: the way back
// raised the stored complement by the whole credit, so the guest was asked 30 € at the arrival for a line paid in cash.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { pinSaleDelta } = require('../utils/storedReservationQuote');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const patch = (id, body) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, res);
  return status;
};
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const balance = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};

test('S5-2 — offer (confirmed) then un-offer of a cash-paid line on a drifted complement: nothing asked, the refund closed, the money where it was', () => {
  const id = stay(20);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  assert.equal(patch(id, { balancePaid: true, balancePaidDate: todayIso() }), 200);
  // The drift: the solde was stored 50 € under the price, so today's engine asks a 50 € arrival gap the stay does not store.
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount - 50, complementAmount = 0 WHERE id = ?').run(id);
  assert.equal(patch(id, { checkInDone: true }), 200);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const { ref } = sold.saleDetail.lines.find((line) => line.articleKey === `option:${beer}`);
  const start = balance(id);

  const refused = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.deepEqual([refused.status, refused.body.code], [409, 'OVERPAID']);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1), forceOverpayment: true }).status, 200);
  assert.deepEqual([cents(row(id).complementAmount), owed(id), balance(id)], [0, 3000, start]);

  const back = extraSale.changeLine(id, ref, { offered: false }, { now: at(id, '13:00', 1) });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([cents(row(id).complementAmount), owed(id), balance(id)], [0, 0, start]);
});

test('S5-2 — pinSaleDelta: a credit withdrawn from a bucket the stay stores below the engine closes the owed refund first; elsewhere it is asked again', () => {
  const stored = { totalPrice: 100, finalPrice: 100, depositAmount: 0, balanceAmount: 100, complementAmount: 0 };
  const base = { ...stored, finalPrice: 70, complementAmount: 20, noteCreditCuts: { complementAmount: 30 } };
  const quote = { ...stored, complementAmount: 50 };
  assert.equal(pinSaleDelta(quote, stored, base, { owedCents: 3000 }).complementAmount, 0);
  assert.equal(pinSaleDelta(quote, stored, base, { owedCents: 1000 }).complementAmount, 20);
  const beyond = { ...base, noteCreditCuts: { complementAmount: 30, unabsorbed: 30 } };
  assert.equal(pinSaleDelta(quote, { ...stored, complementAmount: 20 }, beyond, { owedCents: 3000 }).complementAmount, 50,
    'a bucket stored at the engine figure took the credit, the owed refund is the money beyond the total: the bucket gets its credit back');
});

// specs/pricing/pricing-components.md rule 107 a (loop t6 S6-2) — the credit took the WHOLE engine bucket (base 0 = stored 0): the bound reads the engine's figure before the credit.
test('S6-2 — pinSaleDelta: a credit that emptied the engine bucket closes the clamped refund on the way back, not the money beyond the total', () => {
  const stored = { totalPrice: 100, finalPrice: 100, depositAmount: 0, balanceAmount: 100, complementAmount: 0 };
  const base = { ...stored, finalPrice: 35, complementAmount: 0, noteCreditCuts: { complementAmount: 50.5, unabsorbed: 14.5 } };
  const quote = { ...stored, complementAmount: 50.5 };
  assert.equal(pinSaleDelta(quote, stored, base, { owedCents: 6500 }).complementAmount, 0, 'stay 14: the 65 € owed = 50,50 clamped + 14,50 beyond');
  assert.equal(pinSaleDelta(quote, stored, base, { owedCents: 1450 }).complementAmount, 50.5, 'a stay stored at the engine figure: only the 14,50 beyond was owed');
});

function driftedStayWithCashLines(lines) {
  const id = stay(20);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  assert.equal(patch(id, { balancePaid: true, balancePaidDate: todayIso() }), 200);
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount - 50, complementAmount = 0 WHERE id = ?').run(id);
  assert.equal(patch(id, { checkInDone: true }), 200);
  const refs = lines.map(([article, quantity]) => {
    const sold = extraSale.sell(id, [{ articleRef: `option:${article}`, quantity }], { now: at(id, '12:00', 1), payment: 'cash' });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    return sold.saleDetail.lines.filter((line) => line.articleKey === `option:${article}`).pop().ref;
  });
  return { id, refs, start: balance(id) };
}

const change = (id, ref, offered, time) => {
  let res = extraSale.changeLine(id, ref, { offered }, { now: at(id, time, 1) });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered }, { now: at(id, time, 1), forceOverpayment: true });
  return res;
};

test('S6-2 — one cash-paid line LARGER than the drifted complement, offered (confirmed) then un-offered: nothing asked, nothing owed, Σ unchanged', () => {
  const { id, refs: [ref], start } = driftedStayWithCashLines([[beer, 10]]);
  assert.equal(change(id, ref, true, '12:30').status, 200);
  assert.deepEqual([cents(row(id).complementAmount), owed(id), balance(id)], [0, 6000, start]);
  assert.equal(change(id, ref, false, '13:00').status, 200);
  assert.deepEqual([cents(row(id).complementAmount), owed(id), balance(id)], [0, 0, start]);
});

test('S6-2 — two cash-paid lines (30 + 60) on the drifted complement: offer A, offer B, un-offer A, un-offer B — balanced at every step, nothing asked at the end', () => {
  const { id, refs: [a, b], start } = driftedStayWithCashLines([[beer, 5], [breakfast, 1]]);
  for (const [ref, offered, time] of [[a, true, '12:30'], [b, true, '12:40'], [a, false, '12:50'], [b, false, '13:00']]) {
    assert.equal(change(id, ref, offered, time).status, 200);
    assert.equal(balance(id), start, `${offered ? 'offer' : 'un-offer'} at ${time}`);
  }
  assert.deepEqual([cents(row(id).complementAmount), owed(id)], [0, 0]);
});
