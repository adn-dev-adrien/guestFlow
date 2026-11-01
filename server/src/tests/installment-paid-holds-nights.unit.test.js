// specs/payment-link-lifecycle.md rule 32, reading of 2026-11-01 (audit R11 reservations R11-1). A paid échéance is the
// stay's money (rule 31), so from that payment on the stay holds its nights (rule 37, « first paid wins »). Beside a
// plan it is the only payment that can arrive (rule 63): its recorder withdraws the other requests' links on those
// nights at once, like `stayPaymentRecorder` does for an acompte, never 15 minutes later at the lifecycle pass.
// Also specs/direct-installments.md rule 50.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf } = require('./datesTakenFixture');
const { recordInstallmentPayment } = require('../utils/installmentPayment');

function addInstallment(reservationId, { number = 1, amountCents = 13300, dueDays = 10 } = {}) {
  const info = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents) VALUES (?, ?, ?, ?)')
    .run(reservationId, number, inDays(dueDays), amountCents);
  return Number(info.lastInsertRowid);
}

// A direct stay with a plan (nothing paid yet) and an unpaid devis on its nights, whose acompte link is open.
function scene(start) {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(start), end: inDays(start + 4), extra: { depositAmount: 0, balanceAmount: 0 } });
  const first = addInstallment(stay, { number: 1 });
  addInstallment(stay, { number: 2, dueDays: 40 });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(start + 1), end: inDays(start + 3) });
  const devisLink = addLink(devisId, { type: 'full' });
  return { stay, first, devisId, devisLink };
}

for (const method of ['transfer', 'link']) {
  test(`rule 32 / direct-installments rule 50 (R11): an échéance recorded (${method}) makes the stay hold its nights — the devis link on them is withdrawn at once`, () => {
    const { stay, first, devisLink } = scene(method === 'transfer' ? 210 : 220);
    assert.equal(linkOf(devisLink).status, 'open');
    const out = recordInstallmentPayment({ db }, { installmentId: first, method });
    assert.equal(out.flipped, true);
    const link = linkOf(devisLink);
    assert.equal(link.status, 'cancelled');
    assert.equal(link.cancelReason, 'dates-taken');
    assert.equal(Number(link.takenByReservationId), stay);
    assert.ok(link.remoteCancelPendingAt, 'its deactivation is owed');
  });
}

test('rule 32 (R11): a replayed échéance payment withdraws nothing more and never throws', () => {
  const { first, devisLink } = scene(230);
  recordInstallmentPayment({ db }, { installmentId: first, method: 'transfer' });
  const before = linkOf(devisLink);
  const again = recordInstallmentPayment({ db }, { installmentId: first, method: 'transfer' });
  assert.equal(again.flipped, false);
  assert.deepEqual(linkOf(devisLink), before);
});

test('rule 37 (R11): a plan with nothing paid holds nothing — the devis link stays open', () => {
  const { devisLink } = scene(240);
  assert.equal(linkOf(devisLink).status, 'open');
});
