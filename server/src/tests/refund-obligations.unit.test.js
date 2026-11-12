// specs/pricing-components.md §3 rules 23 and 75 — the register of refund obligations (owner O-2, O-5, O-10): every writer of
// "money that must leave" opens a row, the ledger shows the open ones with a close action, the PATCH closes them, a refund opened
// on the trop-perçu settles what it covered, and money the provider already refunded is a row opened then settled.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, put, respond, ADMIN, NO_ACOMPTE, S, TODAY, refund, ficheView,
} = require('./moneyLedgerFixture');
const obligations = require('../models/refundObligationsModel');
const closeController = require('../controllers/refundObligationsController');
const paymentLinksModel = require('../models/paymentLinksModel');
const { recordRefundOwed } = require('../utils/paymentPollRunner');
const { settleWithdrawnPayment } = require('../utils/withdrawnPayments');

const openRows = (id) => obligations.listFor(id, { status: 'open' });
const patch = (id, oid, status) => {
  const res = respond();
  closeController.closeObligation({ params: { id: String(id), oid: String(oid) }, body: { status }, user: ADMIN }, res);
  return res;
};

function paidLink(reservationId, amountCents = 5000, over = {}) {
  const links = paymentLinksModel.buildModel(db);
  const link = links.create({ reservationId, type: 'balance', amountCents, provider: 'qonto', providerLinkId: `L${Math.random()}`, url: 'u', status: 'open', ...over });
  links.markPaid(link.id, { providerPaymentId: 'pay', paidAt: `${TODAY}T10:00:00Z` });
  return links.findById(link.id);
}

test('rule 75 — a link paid twice opens a duplicate obligation, once, with the history entry', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const link = paidLink(id, 7000);
  recordRefundOwed(db, id, link, 3000);
  recordRefundOwed(db, id, link, 3000);
  const rows = openRows(id);
  assert.equal(rows.length, 1, 'one row per link and origin');
  assert.deepEqual([rows[0].origin, rows[0].amountCents, rows[0].paymentLinkId, rows[0].status], ['duplicatePayment', 3000, link.id, 'open']);
});

test('rule 75 — the ledger shows each open obligation with its close action; the PATCH closes it and the row goes', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const link = paidLink(id, 7000);
  recordRefundOwed(db, id, link, 7000);
  const row = ficheView(id).ledger.rows.find((r) => String(r.key).startsWith('obligation-'));
  assert.deepEqual([row.label, row.amount, row.state, row.stateLabel], ['Paiement en double à rembourser', 70, 'due', 'À rembourser']);
  assert.equal(row.action.kind, 'closeObligation');
  assert.equal(row.action.label, 'Marquer remboursé');
  const done = patch(id, row.action.obligationId, 'settled');
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(done.body.obligation.status, 'settled');
  assert.equal(done.body.obligation.settledBy, 'operator');
  assert.ok(done.body.obligation.settledAt);
  assert.equal(ficheView(id).ledger.rows.some((r) => String(r.key).startsWith('obligation-')), false);
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id DESC").all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'refundOwed' && c.to === 'remboursé'));
});

test('rule 75 — only an open row of the stay closes: unknown 404, other stay 404, already closed 409, bad status 400', () => {
  const a = fiche(NO_ACOMPTE, 'direct');
  const b = fiche(NO_ACOMPTE, 'direct');
  const row = obligations.open({ reservationId: a.id, origin: 'orderConflict', amountCents: 1200 });
  assert.equal(patch(a.id, 99999, 'settled').statusCode, 404);
  assert.equal(patch(b.id, row.id, 'settled').statusCode, 404);
  assert.equal(patch(a.id, row.id, 'refunded').statusCode, 400);
  assert.equal(patch(a.id, row.id, 'cancelled').statusCode, 200);
  assert.equal(patch(a.id, row.id, 'settled').statusCode, 409);
  assert.equal(obligations.findById(row.id).status, 'cancelled');
});

test('rule 75 — a basket obligation closes its link\'s refund flag too (the legacy flag is kept in step)', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const link = paidLink(id, 4200);
  db.prepare('UPDATE payment_links SET basketJson = ? WHERE id = ?').run(JSON.stringify({ source: 'shop', ref: '4', refundOwed: true, refundCents: 600 }), link.id);
  const row = obligations.open({ reservationId: id, origin: 'basket', paymentLinkId: link.id, amountCents: 600 });
  assert.equal(patch(id, row.id, 'settled').statusCode, 200);
  const basket = JSON.parse(paymentLinksModel.buildModel(db).findById(link.id).basketJson);
  assert.equal(basket.refundOwed, undefined);
  assert.equal(basket.refundCents, undefined);
  assert.equal(basket.source, 'shop');
});

test('rule 75 (O-5) — a payment the provider refunded is opened then settled: provider, no journal entry; a devis never booked is neverBooked', async () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const links = paymentLinksModel.buildModel(db);
  const link = paidLink(id, 5000);
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator' WHERE id = ?").run(link.id);
  await settleWithdrawnPayment(link.id, { database: db, paymentLinksModel: links, outcome: 'refunded' });
  const row = obligations.forLink(link.id, 'withdrawnLink');
  assert.deepEqual([row.status, row.settledBy, row.amountCents], ['settled', 'provider', 5000]);
  assert.ok(row.settledAt);
  assert.equal(openRows(id).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_refunds WHERE reservationId = ?').get(id).n, 0, 'no refund of the register: nothing for the journal');

  const devis = Number(db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, devisStatus) VALUES ('devis', 1, 1, '2031-01-10', '2031-01-12', 1, 100, 'draft')").run().lastInsertRowid);
  const devisLink = paidLink(devis, 2500);
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator' WHERE id = ?").run(devisLink.id);
  await settleWithdrawnPayment(devisLink.id, { database: db, paymentLinksModel: links, outcome: 'refunded' });
  assert.equal(obligations.forLink(devisLink.id, 'neverBooked').status, 'settled');
});

test('rule 23 (O-10) — a paid line lowered is refused until confirmed; the confirmed excess is an obligation, the trop-perçu row is its face', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  const refused = respond();
  const { controller } = require('./moneyLedgerFixture');
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, adults: 1 }, user: ADMIN }, refused);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'OVERPAID');
  assert.equal(openRows(stay.id).length, 0, 'refused: nothing written, nothing owed');

  await put(stay, { adults: 1 });
  const lowered = openRows(stay.id);
  assert.equal(lowered.length, 1);
  assert.equal(lowered[0].origin, 'lineLowered');
  const view = ficheView(stay.id);
  const excess = view.ledger.rows.find((r) => r.key === 'overpayment');
  assert.equal(lowered[0].amountCents, Math.round(excess.amount * 100), 'the obligation is the trop-perçu the operator confirmed');
  assert.equal(view.ledger.rows.some((r) => String(r.key).startsWith('obligation-')), false, 'one face for the same money');

  // A refund opened on the trop-perçu gives that money back: the obligation is settled by it.
  const res = refund(stay.id, [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: excess.amount }], 'transfer', { fromOverpayment: true });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const settled = obligations.findById(lowered[0].id);
  assert.deepEqual([settled.status, settled.settledBy], ['settled', `refund:${res.body.refund.id}`]);
});

test('rule 23 — a later save that shrinks the excess shrinks the obligation; an unrelated save never opens one', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { adults: 1 });
  const [row] = openRows(stay.id);
  await put(stay, { adults: 2 });
  assert.equal(obligations.findById(row.id).status, 'cancelled', 'the price came back up: nothing is owed any more');
  const other = fiche(NO_ACOMPTE, 'direct');
  await put(other, { notes: 'Arrivée tardive' });
  assert.equal(openRows(other.id).length, 0);
});

test('rule 75 — the register refuses a non-positive amount and an unknown origin', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  assert.throws(() => obligations.open({ reservationId: id, origin: 'basket', amountCents: 0 }), /positive/);
  assert.throws(() => obligations.open({ reservationId: id, origin: 'gift', amountCents: 10 }), /unknown origin/);
});
