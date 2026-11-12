// specs/pricing-components.md §3 rules 48 and 76 — the loader that builds the `ctx` of REFUNDS / overpayment from the ports:
// allocations, the stored total, the free lines of origin `overpayment`, the adjusted complement and the departure's own sales.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, S, NO_ACOMPTE, TODAY, refund, forced, C,
} = require('./moneyLedgerFixture');
const { overpaymentContext } = require('../models/refundInputModel');

test('rule 76 — the context carries the allocations, the stored total and the refunds of origin overpayment, in cents', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  const stay = db.prepare('SELECT finalPrice, touristTaxTotal, balanceAmount FROM reservations WHERE id = ?').get(id);
  const ctx = overpaymentContext(db, id);
  assert.equal(ctx.totalCents, Math.round(stay.finalPrice * 100) + Math.round(stay.touristTaxTotal * 100));
  assert.equal(ctx.paymentsCents, Math.round(stay.balanceAmount * 100));
  assert.equal(ctx.overpaymentRefundedCents, 0);
  assert.equal(ctx.platform, 'direct');
  assert.equal(overpaymentContext(db, 999999), null);
});

test('rule 76 — an adjusted complement that was paid is isolated; an unadjusted one is not', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(id, S, C);
  assert.equal(overpaymentContext(db, id).adjustedComplementCents, 0);
  db.prepare('UPDATE reservations SET complementAmountOverride = 70 WHERE id = ?').run(id);
  const ctx = overpaymentContext(db, id);
  assert.equal(ctx.adjustedComplementCents, Math.round(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount * 100));
});

test('rule 76 — the end of stay collected for the departure\'s own sales is counted apart, its mid-stay lines are inside the price', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  db.prepare(`UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementAmount = 50,
      endOfStayComplementDetail = '[{"label":"Ménage","amount":30,"source":"sas"},{"label":"Bois","amount":20,"source":"midStayExtra"}]' WHERE id = ?`).run(TODAY, id);
  assert.equal(overpaymentContext(db, id).departureOwnCents, 3000);
});

test('rule 76 — a refund opened on the trop-perçu is counted, a gesture is not', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  assert.equal(refund(id, [{ label: 'Geste', bucket: 'accommodation', amountTtc: 4 }]).statusCode, 201);
  assert.equal(overpaymentContext(db, id).overpaymentRefundedCents, 0);
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5 WHERE id = ?').run(id);
  assert.equal(refund(id, [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 3 }], 'transfer', { fromOverpayment: true }).statusCode, 201);
  assert.equal(overpaymentContext(db, id).overpaymentRefundedCents, 300);
});
