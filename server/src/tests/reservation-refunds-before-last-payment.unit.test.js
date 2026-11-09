// specs/reservation-refunds.md rule 53 (verification R35b, finding 5) — a book refund dated before the stay's last book
// payment is refused (400 REFUND_BEFORE_PAYMENT) before anything is written: the refund closing a stay's books reads
// the encaissements up to its own date, so a refund dated before the money it gives back left 706 / 709 open. The caisse
// interne is off the books: neither its payments nor its refunds are judged.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, inDays, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, fiche,
} = require('./moneyLedgerFixture');
const refundsController = require('../controllers/refundsController');
const { lastBookPaymentDateOf } = require('../utils/refunds');

function refundOn(id, refundDate, lines, method = 'transfer') {
  const res = respond();
  refundsController.create({ params: { id }, body: { refundDate, method, reason: 'r', lines } }, res);
  return res;
}
const refundsOf = (id) => db.prepare('SELECT COUNT(*) AS n FROM reservation_refunds WHERE reservationId = ?').get(id).n;
const frDay = (iso) => iso.split('-').reverse().join('/');

test('rule 53 — a refund dated before the solde\'s payment is refused, nothing written; on its day it passes', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: inDays(-2) }).statusCode, 200);
  const early = refundOn(stay.id, inDays(-5), [{ key: 'accommodation', amountTtc: 10 }]);
  assert.equal(early.statusCode, 400);
  assert.equal(early.body.code, 'REFUND_BEFORE_PAYMENT');
  assert.equal(early.body.error, `Date antérieure au dernier paiement (${frDay(inDays(-2))}).`);
  assert.equal(refundsOf(stay.id), 0);
  assert.equal(refundOn(stay.id, inDays(-2), [{ key: 'accommodation', amountTtc: 10 }]).statusCode, 201);
});

test('rule 53 — the LAST book payment counts: after the acompte but before the solde is refused', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, { depositPaid: true, depositPaidDate: inDays(-9) }).statusCode, 200);
  assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: inDays(-3) }).statusCode, 200);
  assert.equal(refundOn(stay.id, inDays(-6), [{ key: 'accommodation', amountTtc: 10 }]).body.code, 'REFUND_BEFORE_PAYMENT');
  assert.equal(refundOn(stay.id, inDays(-1), [{ key: 'accommodation', amountTtc: 10 }]).statusCode, 201);
});

test('rule 53 — a solde collected in the caisse interne is off the books: a book refund after the acompte passes', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, { depositPaid: true, depositPaidDate: inDays(-9) }).statusCode, 200);
  // Collected at the arrival in the caisse interne: the flag that payment stores.
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ?, balancePaidCash = 1 WHERE id = ?').run(inDays(-1), stay.id);
  assert.equal(Number(rowOf(stay.id).balancePaidCash), 1);
  assert.equal(refundOn(stay.id, inDays(-4), [{ key: 'accommodation', amountTtc: 10 }]).statusCode, 201);
});

test('rule 53 — a caisse-interne refund is not judged by the book payments', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: inDays(-1) }).statusCode, 200);
  const res = refundOn(stay.id, inDays(-4), [{ key: 'accommodation', amountTtc: 10 }], 'internal');
  assert.notEqual(res.body && res.body.code, 'REFUND_BEFORE_PAYMENT');
});

test('rule 53 — lastBookPaymentDateOf reads every book payment and skips the caisse interne', () => {
  const row = {
    depositPaid: 1, depositPaidDate: inDays(-30),
    balancePaid: 1, balancePaidCash: 1, balancePaidDate: inDays(-2),
    complementPaid: 1, complementPaidDate: inDays(-20),
    midStaySettledNotes: JSON.stringify([{ id: 'n1', paidDate: inDays(-10), paidCash: 0 }, { id: 'n2', paidDate: inDays(-1), paidCash: 1 }]),
  };
  assert.equal(lastBookPaymentDateOf(row), inDays(-10));
  assert.equal(lastBookPaymentDateOf(row, { installments: [{ paid: 1, paidDate: inDays(-7) }, { paid: 0, paidDate: inDays(-1) }] }), inDays(-7));
  const caisseOnly = { paidDate: inDays(-1), tenders: [{ method: 'cash', amountCents: 500, internal: 1 }] };
  const withCard = { paidDate: inDays(-3), tenders: [{ method: 'cash', amountCents: 500, internal: 1 }, { method: 'card', amountCents: 100, internal: 0 }] };
  assert.equal(lastBookPaymentDateOf(row, { settlements: [caisseOnly] }), inDays(-10));
  assert.equal(lastBookPaymentDateOf(row, { settlements: [caisseOnly, withCard] }), inDays(-3));
  assert.equal(lastBookPaymentDateOf({}), null);
});
