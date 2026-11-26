// specs/pricing/pricing-components.md §3 rule 116, reading of 2026-11-16 (stabilisation loop t9, B9-3 and B9-1) — on a platform stay the collected
// arrival complement's money a line no longer charges is credited to what is still due exactly as a note's (rule 104): Booking, complement
// (beer ×5, 30 €) collected, a plank 20 € sold unpaid before the arrival, then the beer offered → nothing asked, 10 € owed (before: 20 €
// asked AND 30 € owed). Offering a line that credit paid gives the credit back (owed again). And a caisse-interne refund of complement cash
// is no note money (rule 115 stamp): the rest of a mixed excess (a card note) is proposed by transfer, never through the till.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./stayIdentityFixtures');

const plank = F.option('Planche plateforme', 20);
const lowered = (id) => F.db.prepare("SELECT amountCents, status, noteCents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' ORDER BY id").all(id)
  .map((r) => [r.amountCents, r.status, r.noteCents]);

function collectedComplement(cash = false) {
  const id = F.paidStay('Booking');
  F.pay(id, cash ? { complementPaidCash: true, complementPaidDate: F.todayIso() } : { complementPaid: true, complementPaidCash: false, complementPaidDate: F.todayIso() });
  return id;
}

for (const path of ['line', 'fiche']) {
  test(`B9-3 ${path}: the complement's freed beer pays the plank sold unpaid first — nothing asked, 10 € owed`, () => {
    const id = collectedComplement();
    assert.equal(F.sell(id, plank, 1, F.at(id, -3, '12:00')).status, 200);
    assert.equal(F.identity(id).asked, 2000);
    const gesture = path === 'line'
      ? F.change(id, F.beer, { offered: true }, F.at(id, -2, '12:00'))
      : F.fiche(id, F.offerInFiche(F.beer), F.at(id, -2, '12:00'));
    assert.equal(gesture.first.status, 409);
    assert.equal(gesture.first.body.overpaymentTtc, 10);
    assert.equal(gesture.final.status, 200);
    const money = F.identity(id);
    assert.deepEqual([money.asked, money.owed, money.gap], [0, 1000, 0]);
    assert.equal(F.cents(F.row(id).endOfStayComplementAmount), 0);
  });
}

test('B9-3: a line the credit paid, offered, gives the credit back — owed again in full', () => {
  const id = collectedComplement();
  assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -2, '12:00')).final.status, 200);
  F.pay(id, { checkInDone: true });
  assert.equal(F.sell(id, plank, 1, F.at(id, 1, '11:00'), 'card').status, 200);
  assert.deepEqual([F.identity(id).asked, F.identity(id).owed], [0, 1000]);
  assert.equal(F.change(id, plank, { offered: true }, F.at(id, 1, '13:00')).final.status, 200);
  const money = F.identity(id);
  assert.deepEqual([money.asked, money.owed, money.gap], [0, 3000, 0]);
});

test('B9-3: the complement money already refunded is no credit', () => {
  const id = collectedComplement();
  assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -2, '12:00')).final.status, 200);
  assert.deepEqual(F.refundAsProposed(id).map((r) => r.statusCode), [201]);
  assert.equal(F.sell(id, plank, 1, F.at(id, -2, '13:00')).status, 200);
  const money = F.identity(id);
  assert.deepEqual([money.asked, money.owed, money.gap], [2000, 0, 0]);
});

test('B9-1: complement collected caisse interne + a card note, both open — the till gives the cash back, the rest goes by transfer', () => {
  const id = F.paidStay('Booking');
  const now = F.at(id, -3, '11:00');
  const request = [{ articleRef: `option:${plank}`, quantity: 1 }];
  const quote = F.extraSale.quote(id, request, { now, source: 'shop' });
  assert.equal(F.extraSale.sell(id, request, { now, source: 'shop', paid: { amountCents: quote.totalCents, ref: 'card-b91' }, orderRef: 'order:b91' }).status, 200);
  F.pay(id, { complementPaidCash: true, complementPaidDate: F.todayIso() });
  assert.equal(F.change(id, F.beer, { offered: true }, F.at(id, -2, '12:00')).final.status, 200);
  assert.equal(F.change(id, plank, { offered: true }, F.at(id, -2, '13:00')).final.status, 200);
  const prefill = F.overpaymentRow(id).refundPrefill;
  assert.equal(prefill.overpaymentTtc, 50);
  assert.equal(prefill.cashPart.amountTtc, 30);
  // The cash part alone, as an operator who stops there.
  const cashOnly = F.call(require('../controllers/refundsController').create, { id: String(id) }, {
    refundDate: F.todayIso(), method: 'internal', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: 30,
    lines: prefill.cashPart.lines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(cashOnly.statusCode, 201, JSON.stringify(cashOnly.body));
  assert.deepEqual(lowered(id), [[3000, 'settled', 0], [2000, 'open', 0]], 'the till gave back complement cash, no note money');
  const rest = F.overpaymentRow(id).refundPrefill;
  assert.equal(rest.overpaymentTtc, 20);
  assert.equal(rest.method, null, 'a card note is not refunded through the till');
  assert.equal(rest.cashPart, undefined);
});
