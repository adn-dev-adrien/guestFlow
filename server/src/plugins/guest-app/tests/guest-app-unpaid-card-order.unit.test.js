// specs/guest-app.md rule 35 and rule 108 (reading of 2026-11-13, owner) — an unpaid card order does not exist: it reserves nothing (no offered unit, no
// specs/pricing-components.md rule 87 (owner Q-C3): the guest-app card order's line appears only once paid.
// price, no person counted against a later order, no slot), the staff sees nothing of it and is told nothing until it is paid; a second order — card or note —
// is accepted meanwhile; each card order is sold at the price of the moment it is paid, and a payment the sale cannot honour (offered hour spent, so it
// would cost more than was paid) is kept as an open `orderConflict` refund obligation. A note order is recorded at once.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, fakeProvider, hasHourly, isoPlus, notesOf, openOrdering, optionLine, seedStay, sell,
} = fx;
const paymentLinksModel = require('../../../models/paymentLinksModel');

const BATH = addBath({ id: 96, freeMinutes: { 1: 60 } });
sell('resource', BATH);
const CIDER = addOption({ id: 961, title: 'Cidre carte', price: 6 });
sell('option', CIDER);
const slot = (start, end) => ({ date: isoPlus(1), start, end });
const bath = (...slots) => ({ lines: [{ kind: 'resource', id: BATH, sessions: slots }] });
const cider = (quantity) => ({ lines: [{ kind: 'option', id: CIDER, quantity }] });

function withCard(name, fn, { skip = false } = {}) {
  test(name, { skip }, async () => {
    db.prepare('DELETE FROM guest_orders').run();
    const stayId = seedStay();
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
    try { await fn({ stayId, card, ...ctx }); } finally { await ctx.close(); }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const linkOf = (orderId) => paymentLinksModel.findById(orderRow(orderId).paymentLinkId);
const staffGet = async (base, url) => (await fetch(`${base}/api/guest-app${url}`)).json();
async function pay(call, card, orderId) {
  card.pay(linkOf(orderId).providerLinkId);
  return (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
}
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

withCard('a second order is accepted while a card order awaits its payment, card or note', async ({ call, card }) => {
  const first = await call('POST', '/public/v1/guest/orders', { ...cider(2), payment: 'card' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const secondCard = await call('POST', '/public/v1/guest/orders', { ...cider(1), payment: 'card' });
  assert.equal(secondCard.status, 200, JSON.stringify(secondCard.body));
  const note = await call('POST', '/public/v1/guest/orders', { ...cider(1), payment: 'note' });
  assert.equal(note.status, 200, JSON.stringify(note.body));
  assert.equal(card.created.length, 2, 'one link per card order');
});

withCard('a card order awaiting payment reserves nothing — no price, no unit, no person against the next quote', async ({ call }) => {
  const first = await call('POST', '/public/v1/guest/orders', { ...bath(slot('10:00', '11:00'), slot('14:00', '15:00')), payment: 'card' });
  assert.equal(orderRow(first.body.data.orderId).total, 30, '2 h, the first offered');
  const quote = await call('POST', '/public/v1/guest/orders/quote', bath(slot('17:00', '18:00')));
  assert.equal(quote.body.data.total, 0, 'the offered hour is still there');
}, { skip: !hasHourly });

withCard('the staff sees nothing of an unpaid card order: not in the lists, no push, no stock held; abandoned or expired, nothing either', async ({ call, base, pushes, api, clock }) => {
  const placed = (await call('POST', '/public/v1/guest/orders', { ...cider(2), payment: 'card' })).body.data.orderId;
  const abandoned = (await call('POST', '/public/v1/guest/orders', { ...cider(1), payment: 'card' })).body.data.orderId;
  await call('POST', `/public/v1/guest/orders/${abandoned}/abandon`);
  const expired = (await call('POST', '/public/v1/guest/orders', { ...cider(1), payment: 'card' })).body.data.orderId;
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  api.expireOrders();
  assert.equal(orderRow(expired).status, 'expired');
  const placedAgain = (await call('POST', '/public/v1/guest/orders', { ...cider(1), payment: 'card' })).body.data.orderId;
  for (const query of ['', '?status=all']) {
    // eslint-disable-next-line no-await-in-loop
    const listed = (await staffGet(base, `/orders${query}`)).orders.map((o) => o.id);
    assert.deepEqual(listed.filter((id) => [placed, abandoned, expired, placedAgain].includes(id)), [], `staff list ${query || 'todo'}`);
  }
  await flush();
  assert.deepEqual(pushes, [], 'no push until paid');
  assert.equal(optionLine(fx.db.prepare('SELECT reservationId AS id FROM guest_orders WHERE id = ?').get(placed).id, CIDER), undefined, 'nothing on the fiche');
  assert.ok(placed);
});

withCard('paid, the order appears to the staff, is pushed once, and is sold at the price of that moment', async ({ stayId, call, base, card, pushes }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { ...cider(2), payment: 'card' })).body.data;
  assert.equal((await pay(call, card, orderId)).status, 'paid');
  await flush();
  assert.deepEqual((await staffGet(base, '/orders')).orders.map((o) => o.id), [orderId]);
  assert.equal(pushes.length, 1);
  assert.equal(optionLine(stayId, CIDER).quantity, 2);
  assert.equal(notesOf(stayId).find((n) => n.ref === String(orderId)).total, 12);
});

for (const [name, firstPaid, hours] of [['the first placed is paid first', 'a', ['10', '12', '15', '17']], ['the second placed is paid first', 'b', ['09', '11', '14', '16']]]) {
  withCard(`two card orders awaiting payment, ${name}: the later payment finds the offered hour spent — conflict, an open orderConflict obligation, never a sale above the money`, async ({ stayId, call, card }) => {
    const hour = (h) => slot(`${h}:00`, `${Number(h) + 1}:00`);
    const a = (await call('POST', '/public/v1/guest/orders', { ...bath(hour(hours[0]), hour(hours[1])), payment: 'card' })).body.data.orderId;
    const b = (await call('POST', '/public/v1/guest/orders', { ...bath(hour(hours[2]), hour(hours[3])), payment: 'card' })).body.data.orderId;
    assert.deepEqual([orderRow(a).total, orderRow(b).total], [30, 30], 'both quoted with the offered hour');
    const [early, late] = firstPaid === 'a' ? [a, b] : [b, a];
    assert.equal((await pay(call, card, early)).status, 'paid');
    assert.equal(notesOf(stayId).find((n) => n.ref === String(early)).total, 30);
    assert.equal((await pay(call, card, late)).status, 'paid_conflict', 'sold now it costs 60 €, the card paid 30 €');
    assert.equal(notesOf(stayId).some((n) => n.ref === String(late)), false, 'nothing of it on the fiche');
    const obligation = db.prepare("SELECT origin, amountCents, status FROM refund_obligations WHERE paymentLinkId = ?").get(orderRow(late).paymentLinkId);
    assert.deepEqual([obligation.origin, obligation.amountCents, obligation.status], ['orderConflict', 3000, 'open']);
  }, { skip: !hasHourly });
}

withCard('a note order is recorded at once: on the fiche, confirmed, and the staff sees it', async ({ stayId, call, base }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { ...cider(3), payment: 'note' })).body.data;
  assert.equal(orderRow(orderId).status, 'confirmed');
  assert.equal(optionLine(stayId, CIDER).quantity, 3);
  assert.deepEqual((await staffGet(base, '/orders')).orders.map((o) => o.id), [orderId]);
});
