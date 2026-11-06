// specs/defer-arrival-complement-to-checkout.md rule 21, specs/single-payment-at-check-in.md rule 18 (audit R25-A1) — the
// arrival SAS only settles, undoes or re-stamps the complement it settled itself: one paid before check-in (fiche tick,
// reconciliation, payment link) stays paid whatever the commit answers. Same at departure for the end-of-stay complement
// (specs/recall-unpaid-arrival-complement-at-checkout.md rule 10). specs/reception-role-checkin-only.md rule 16 (audit R25-A2) —
// the refund refusal a reception user meets names no refund.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, TODAY, inDays, rowOf, NO_ACOMPTE, S, C, forced, fiche, put, pay, refund, register,
} = require('./moneyLedgerFixture');
const { applyPaymentMark } = require('../utils/reservationPaymentMark');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };
const RECEPTION = { id: 2, roles: ['reception'] };
const CODE = 'REFUND_BLOCKS_UNTICK';
const PAID_ON = inDays(-5);

function sas(id, side, body, user = ADMIN) {
  const res = respond();
  sasController[side === 'arrival' ? 'commitArrival' : 'commitDeparture']({ params: { id: String(id) }, body, user }, res);
  return res;
}

const complementState = (id) => {
  const row = rowOf(id);
  return {
    complementPaid: row.complementPaid,
    complementPaidDate: row.complementPaidDate,
    complementPaidCash: row.complementPaidCash,
    complementPaidAtArrival: row.complementPaidAtArrival,
    complementDeferredToCheckout: row.complementDeferredToCheckout,
  };
};
const PREPAID = {
  complementPaid: 1, complementPaidDate: PAID_ON, complementPaidCash: 0, complementPaidAtArrival: 0, complementDeferredToCheckout: 0,
};

function prepaidStay(how) {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, S);
  const body = { ...C, complementPaidDate: PAID_ON };
  if (how === 'fiche') pay(stay.id, body);
  if (how === 'reconciliation') assert.equal(applyPaymentMark({ reservationId: stay.id, body, user: ADMIN }).status, 200);
  if (how === 'link') {
    db.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = ?, complementPaidCash = 0 WHERE id = ?").run(PAID_ON, stay.id);
  }
  assert.deepEqual(complementState(stay.id), PREPAID);
  return stay;
}

// The body the dialog sent before the fix: the recap hid the payment buttons, the mode stayed on « Plus tard ».
const FIRST_RUN_BODY = { complementSettled: false, arrivalPaymentMode: 'defer' };

for (const how of ['fiche', 'reconciliation', 'link']) {
  test(`first arrival SAS on a complement paid before check-in (${how}): it stays paid, not deferred`, SAS, () => {
    const stay = prepaidStay(how);
    const res = sas(stay.id, 'arrival', FIRST_RUN_BODY);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(complementState(stay.id), PREPAID);
    assert.ok(rowOf(stay.id).arrivalSasDoneAt);
  });
}

test('split answer « Pas maintenant » on a prepaid complement: untouched', SAS, () => {
  const stay = prepaidStay('fiche');
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: false }).statusCode, 200);
  assert.deepEqual(complementState(stay.id), PREPAID);
});

test('« Payé en liquide » on a card-prepaid complement: no move to the caisse interne, no ownership taken', SAS, () => {
  const stay = prepaidStay('fiche');
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: true, complementPaidCash: true }).statusCode, 200);
  assert.deepEqual(complementState(stay.id), PREPAID);
  // A re-opened SAS still cannot undo it: the settlement never became its own.
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: false }).statusCode, 200);
  assert.deepEqual(complementState(stay.id), PREPAID);
});

test('a prepaid complement with a book refund on the stay: the check-in passes, nothing refused', SAS, () => {
  const stay = prepaidStay('fiche');
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 30 }]).statusCode, 201);
  const collected = register(stay.id).collectedTtc;
  const res = sas(stay.id, 'arrival', FIRST_RUN_BODY);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(complementState(stay.id), PREPAID);
  assert.equal(register(stay.id).collectedTtc, collected);
});

// Reception runs the SAS of the day only (reception-sas-today-only rule 5): the stay is moved onto today.
function today(stay) {
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(TODAY, inDays(2), stay.id);
  return stay;
}

test('reception, first arrival SAS on a prepaid complement: it stays paid', SAS, () => {
  const stay = today(prepaidStay('link'));
  const res = sas(stay.id, 'arrival', { complementSettled: false }, RECEPTION);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(complementState(stay.id), PREPAID);
});

test('the SAS still settles an open complement and undoes its own settlement', SAS, () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, S);
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: true, complementPaidCash: true }).statusCode, 200);
  assert.equal(rowOf(stay.id).complementPaidCash, 1);
  assert.equal(rowOf(stay.id).complementPaidAtArrival, 1);
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: false }).statusCode, 200);
  assert.equal(rowOf(stay.id).complementPaid, 0);
  assert.equal(rowOf(stay.id).complementDeferredToCheckout, 1);
});

// The refusal itself: a complement this SAS settled, then refunded, then taken back.
function ownedRefundedComplement() {
  const stay = today(fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] }));
  assert.equal(sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: true }).statusCode, 200);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 50 }]).statusCode, 201);
  // Reception runs a SAS that was never committed: the stored state is set by hand to reach the refusal.
  db.prepare('UPDATE reservations SET arrivalSasDoneAt = NULL WHERE id = ?').run(stay.id);
  return stay;
}

test('reception meets the refund refusal: same 409, no amount, date or id', SAS, () => {
  const stay = ownedRefundedComplement();
  const before = rowOf(stay.id);
  const res = sas(stay.id, 'arrival', { complementSettled: false }, RECEPTION);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.deepEqual(res.body, { error: 'Un remboursement bloque ce passage : à voir avec l’administrateur.', code: CODE });
  assert.deepEqual(rowOf(stay.id), before);
});

test('admin meets the refund refusal unchanged: the refund named, with its id', SAS, () => {
  const stay = ownedRefundedComplement();
  const res = sas(stay.id, 'arrival', { arrivalPaymentSplit: true, complementSettled: false });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, CODE);
  assert.match(res.body.error, /^Remboursement du .+ \(50,00\s€\) à supprimer d’abord\.$/);
  assert.equal(res.body.refundIds.length, 1);
});

async function endOfStayPaidOnTheFiche() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  pay(stay.id, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: PAID_ON });
  const row = rowOf(stay.id);
  assert.ok(row.endOfStayComplementAmount > 0);
  assert.equal(row.endOfStayComplementPaidAtDeparture, 0);
  return stay;
}
const endOfStayState = (id) => {
  const row = rowOf(id);
  return {
    paid: row.endOfStayComplementPaid,
    date: row.endOfStayComplementPaidDate,
    cash: row.endOfStayComplementPaidCash,
    atDeparture: row.endOfStayComplementPaidAtDeparture,
  };
};
const EOS_PREPAID = { paid: 1, date: PAID_ON, cash: 0, atDeparture: 0 };

test('departure « Payé en liquide » on an end-of-stay complement paid on the fiche: not re-stamped', SAS, async () => {
  const stay = await endOfStayPaidOnTheFiche();
  const res = sas(stay.id, 'departure', { complementsSettled: true, complementsPaidCash: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(endOfStayState(stay.id), EOS_PREPAID);
});

test('departure « Payé en liquide » on a fiche-paid end of stay with refunds: no false refusal', SAS, async () => {
  const stay = await endOfStayPaidOnTheFiche();
  const refunded = refund(stay.id, [{ key: 'accommodation', amountTtc: 600 }, { key: 'custom:forcée', amountTtc: 20 }, { label: 'Geste', bucket: 'options', amountTtc: 40 }]);
  assert.equal(refunded.statusCode, 201, JSON.stringify(refunded.body));
  const res = sas(stay.id, 'departure', { complementsSettled: true, complementsPaidCash: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(endOfStayState(stay.id), EOS_PREPAID);
});

test('departure still re-stamps the end of stay it settled itself', SAS, async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(sas(stay.id, 'departure', { complementsSettled: true }).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementPaidAtDeparture, 1);
  assert.equal(sas(stay.id, 'departure', { complementsSettled: true, complementsPaidCash: true }).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementPaidCash, 1);
  assert.equal(rowOf(stay.id).endOfStayComplementPaidAtDeparture, 1);
});
