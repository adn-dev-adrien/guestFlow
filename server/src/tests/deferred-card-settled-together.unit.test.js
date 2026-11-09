// Audit R28 verification V1 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rules 8 and 22,
// specs/reservation-payment-ledger.md rule 69. The merged « Complément de fin de séjour » card settles both buckets with
// one collection (same date, same caisse flag). That state is still ONE collection: the card stays merged and paid with
// both amounts, so its « Annuler », its caisse switch and the preview the guards read carry both buckets. Kept as they
// were: stay 22281 (0 € arrival part), an arrival part due over an end of stay settled on its own, and an arrival part
// paid on another date (or another caisse flag) than the end of stay.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, rowOf, mark, NO_ACOMPTE, S, forced, fiche, pay, storedEndOfStayPaid, ficheView } = require('./moneyLedgerFixture');
const { buildCheckoutComplement } = require('../utils/checkoutComplement');
const { __test: { paymentPatchChanges } } = require('../controllers/reservationsController');

const MARKED_ON = inDays(-1);
const keysOf = (id) => ficheView(id).ledger.rows.filter((r) => /omplement/i.test(r.key)).map((r) => [r.key, r.amount, r.state]);
const flags = (id) => {
  const r = rowOf(id);
  return [r.complementPaid, r.complementPaidCash, r.endOfStayComplementPaid, r.endOfStayComplementPaidCash, r.endOfStayComplementPaidDate];
};

// A checked-out direct stay: 20 € arrival complement deferred to the check-out, 12 € end of stay, both due.
function checkedOutDeferred() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, endOfStayComplementAmount = 12, startDate = ?, endDate = ? WHERE id = ?')
    .run(inDays(-5), inDays(-3), stay.id);
  return stay;
}

function settledTogether(body = { complementPaid: true, complementPaidDate: MARKED_ON }) {
  const stay = checkedOutDeferred();
  assert.deepEqual(keysOf(stay.id), [['checkoutComplement', 32, 'due']]);
  const res = mark(stay.id, body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return stay;
}

test('settled together: the merged card stays one paid card holding both amounts', () => {
  const stay = settledTogether();
  assert.deepEqual(keysOf(stay.id), [['checkoutComplement', 32, 'paid']]);
  assert.deepEqual(flags(stay.id), [1, 0, 1, 0, MARKED_ON]);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
  const block = ficheView(stay.id).checkoutComplement;
  assert.deepEqual([block.deferred, block.amount, block.endOfStayAmount, block.paid], [true, 32, 12, true]);
});

test('settled together, « Annuler »: the un-mark clears both buckets, 32 € due again on the merged card', () => {
  const stay = settledTogether();
  const res = mark(stay.id, { complementPaid: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(flags(stay.id), [0, 0, 0, 0, null]);
  assert.deepEqual(keysOf(stay.id), [['checkoutComplement', 32, 'due']]);
  assert.equal(ficheView(stay.id).ledger.remaining, 32);
});

test('settled together, caisse switch: both buckets follow, the card stays merged', () => {
  const stay = settledTogether();
  assert.equal(mark(stay.id, { complementPaidCash: true }).statusCode, 200);
  assert.deepEqual(flags(stay.id), [1, 1, 1, 1, MARKED_ON]);
  assert.deepEqual(keysOf(stay.id), [['checkoutComplement', 32, 'paid']]);
  assert.equal(mark(stay.id, { complementPaidCash: false }).statusCode, 200);
  assert.deepEqual(flags(stay.id), [1, 0, 1, 0, MARKED_ON]);
  assert.deepEqual(keysOf(stay.id), [['checkoutComplement', 32, 'paid']]);
});

test('settled together, preview: the un-mark the guards read takes the end of stay too', () => {
  const stay = settledTogether();
  const changes = paymentPatchChanges(rowOf(stay.id), { complementPaid: false }, inDays(0));
  assert.equal(changes.complementPaid, 0);
  assert.equal(changes.endOfStayComplementPaid, 0);
});

test('kept: an arrival part paid on another date, or on another caisse flag, than the end of stay draws two cards', () => {
  const apart = checkedOutDeferred();
  storedEndOfStayPaid(apart.id, { date: inDays(-2) });
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = ?').run(MARKED_ON, apart.id);
  assert.deepEqual(keysOf(apart.id), [['complement', 20, 'paid'], ['endOfStayComplement', 12, 'paid']]);
  assert.equal(mark(apart.id, { complementPaid: false }).statusCode, 200);
  assert.deepEqual(flags(apart.id), [0, 0, 1, 0, inDays(-2)]);

  const otherTill = checkedOutDeferred();
  storedEndOfStayPaid(otherTill.id, { date: MARKED_ON, cash: true });
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = ?').run(MARKED_ON, otherTill.id);
  assert.deepEqual(keysOf(otherTill.id), [['complement', 20, 'paid'], ['endOfStayComplement', 12, 'paid']]);
});

test('buildCheckoutComplement: settled together stays deferred with both parts; apart, it is not', () => {
  const base = {
    complementDeferredToCheckout: 1, complementAmount: 20, endOfStayComplementAmount: 12,
    endOfStayComplementDetail: [{ label: 'Bois', qty: 1, unitPrice: 12, amount: 12 }],
    complementPaid: 1, complementPaidDate: MARKED_ON, endOfStayComplementPaid: 1, endOfStayComplementPaidDate: MARKED_ON,
  };
  const arrival = { amount: 20, detail: [{ label: 'Draps', qty: 1, unitPrice: 20, amount: 20 }] };
  const together = buildCheckoutComplement(base, arrival);
  assert.deepEqual([together.deferred, together.amount, together.endOfStayAmount], [true, 32, 12]);
  assert.deepEqual(together.lines.map((l) => l.label), ['Draps', 'Bois']);
  assert.equal(buildCheckoutComplement({ ...base, endOfStayComplementPaidDate: inDays(-2) }, arrival).deferred, false);
  assert.equal(buildCheckoutComplement({ ...base, endOfStayComplementPaidCash: 1 }, arrival).deferred, false);
});
