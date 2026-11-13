// specs/outside-booking-sas.md rules 4, 15-20, 22 — what is left to pay is SETTLEMENT's answer, never the screen's; a partial payment needs « Reste à percevoir », an over-payment is
// refused with nothing written, a payment is allocated to the lines in sale order (the session first), several payments are several allocation sets, and the
// booking dialog's payment of a visit is a payment of its document, and a reste can be billed by a payment link minted from the visit (no e-mail by itself).
// The booking's money on a document: resource-booking-pricing-and-invoicing rule 52. The link asked from the visit: payment-link-lifecycle rule 69.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

const allocations = (saleRef) => f.db.prepare('SELECT lineRef, amountCents FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(saleRef);

test('rules 4, 15 — the totals come from the server: total, paid and remaining, nothing else adds up', async () => {
  const id = f.book();
  const quoted = (await f.call('quote', { id, body: { extras: [f.extra(f.beer, 2)] } })).body;
  assert.deepEqual(quoted.totals, {
    totalCents: 6300, paidCents: 0, remainingCents: 6300, refundOwedCents: 0,
  });
  assert.deepEqual(quoted.vatByRate, [{ rate: 20, vatCents: 1050 }]);
});

test('rules 17, 19 — a partial payment with « Reste à percevoir »: allocated session first, the reste on the card', async () => {
  const id = f.book();
  const done = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(5500), shortfall: { kind: 'due' } } } })).body.visit;
  assert.deepEqual([done.totals.paidCents, done.totals.remainingCents], [5500, 800]);
  const [session, beer] = done.lines;
  assert.deepEqual([session.status, session.settledCents, beer.status, beer.settledCents], ['paid', 5000, 'due', 500]);
  assert.deepEqual(allocations(f.row(id).saleRef).map((a) => a.amountCents), [5000, 500]);
  assert.deepEqual(f.bookings.findById(id).cardState, { state: 'remaining', label: 'Reste 8,00 €', remainingCents: 800 });
});

test('rule 17 — a payment below the reste without the shortfall choice is refused, nothing written', async () => {
  const id = f.book();
  const refused = await f.call('commit', { id, body: { payment: { tenders: f.card(1000) } } });
  assert.deepEqual([refused.code, refused.body.code], [400, 'TENDERS_INVALID']);
  assert.deepEqual([f.row(id).arrivedAt, f.row(id).saleRef], [null, null]);
});

test('rule 18 — an over-payment is refused with the tender words, the lines kept, nothing written', async () => {
  const id = f.book();
  const refused = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(9000) } } });
  assert.equal(refused.code, 400);
  assert.match(refused.body.error, /^Les moyens font 90,00 € pour 56,50 € dus\.$/);
  assert.deepEqual([f.row(id).arrivedAt, f.row(id).saleRef], [null, null]);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM standalone_sales WHERE originRef = ?").get(`resource-booking:${id}`).n, 0);
});

test('rules 16, 19, 22 — the reste collected later: a second allocation set, the visit « Payé »', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)], payment: { tenders: f.card(3000), shortfall: { kind: 'due' } } } });
  const visit = (await f.call('pay', { id, body: { tenders: f.cash(2400, true) } })).body.visit;
  assert.deepEqual([visit.totals.remainingCents, visit.document.status], [0, 'paid']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM standalone_sale_payments WHERE saleId = ?').get(visit.document.id).n, 2);
  assert.equal(allocations(f.row(id).saleRef).length, 3, '3 000 on the session, then 2 000 + 400 in the caisse interne');
  assert.deepEqual(f.bookings.findById(id).cardState.label, 'Payé');
  const nothing = await f.call('pay', { id, body: { tenders: f.card(100) } });
  assert.equal(nothing.code, 400, 'nothing left: any amount is over the reste');
});

test('rule 34 — the booking dialog\'s payment of a visit pays its document\'s whole reste; « Retirer le paiement » refuses document money', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  assert.equal(f.bookings.recordPayment(id, { tenders: f.card(1000) }).code, 'TENDERS_INVALID');
  assert.deepEqual(f.bookings.recordPayment(id, { tenders: f.card(5650) }), { ok: true });
  const booking = f.bookings.findById(id);
  assert.deepEqual([booking.paid, booking.visit.remainingCents, booking.payment.hasCard], [true, 0, true]);
  assert.equal(f.row(id).paid, 0, 'the booking\'s own payment columns stay empty');
  assert.equal(f.bookings.clearPayment(id).code, 'SALE_PAYMENT');
});

test('rule 20 — « Envoyer un lien » from the visit: shown disabled without an e-mail, the link bills the reste, nothing is mailed by minting', async () => {
  const { createContext } = require('../../sdk/createContext');
  const created = [];
  createContext('online-payment', {}).paymentProvider({
    id: 'qonto', label: 'Qonto', errorCode: 'QONTO_API_ERROR', isReady: () => true,
    createLink: async (args) => { created.push(args); return { id: `rem-${created.length}`, url: `https://pay.example/${created.length}`, status: 'open' }; },
    getPayment: async () => ({ paid: false }), getLinkStatus: async () => 'open', cancelLink: async () => {},
  });
  const id = f.book();
  const before = (await f.call('getVisit', { id })).body.paymentLink;
  assert.deepEqual([before.available, before.reason], [false, 'NO_EMAIL']);
  const refused = await f.call('mintLink', { id, body: {} });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [409, 'NO_EMAIL', 'Adresse e-mail requise.']);
  assert.equal(f.row(id).saleRef, null, 'a refusal writes nothing');
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } });
  const minted = await f.call('mintLink', { id, body: { email: 'client@exemple.fr', amountCents: 1 } });
  assert.equal(minted.code, 200);
  assert.deepEqual([minted.body.link.amountCents, created.at(-1).amountCents], [650, 650], 'the reste, never the request\'s amount');
  assert.equal(minted.body.visit.paymentLink.open.id, minted.body.link.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE saleRef = ?").get(f.row(id).saleRef).n, 0, 'minting mails nothing');
  const withdrawn = await f.call('withdrawLink', { id, linkId: minted.body.link.id });
  assert.equal(withdrawn.body.visit.paymentLink.open, null);
});
