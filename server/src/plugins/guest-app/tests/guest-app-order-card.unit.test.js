// specs/guest-app.md rules 33, 35, 36, 38, 44 — « Payer maintenant » through the real routes and the core's money path
// with a fake provider: a `complement` link for the order's exact basket, the slots held while it lives, the payment
// committing the order with its money on the ledger, the abandon, the expiry, and the late payment — committed when its
// slots are still free, `paid_conflict` and « à rembourser » when they are not.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, endOfStayDetail, fakeProvider, hasHourly, historyOf, isoPlus, notesOf, openOrdering, optionLine, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const { buildLedger } = require('../../../utils/reservationLedger');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const CIDER = addOption({ id: 401, title: 'Cidre', price: 6 });
const WOOD = addOption({ id: 402, title: 'Panier de bois', price: 15, category: 'Autres' });
const BATH = addBath({ id: 46 });
sell('option', CIDER);
sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });
sell('resource', BATH);

const TOMORROW = isoPlus(1);
const SLOT = { date: TOMORROW, start: '11:00', end: '12:00' };

function withCard(name, fn, { skip = false, ...options } = {}) {
  test(name, { skip }, async () => {
    const stayId = seedStay();
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test', ...options });
    try {
      await fn({ stayId, card, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const linkOf = (order) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(order.paymentLinkId);
const payLate = (link, card) => {
  card.pay(link.providerLinkId);
  return processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
};
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

withCard('rules 33, 35: « Payer maintenant » mints a `complement` link for exactly the order’s basket, 30 minutes, back to the order page', async ({ call, card }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 3 }], payment: 'card' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { orderId, paymentUrl } = res.body.data;
  assert.equal(paymentUrl, 'https://pay.example.test/1');
  const order = orderRow(orderId);
  assert.deepEqual([order.status, order.payment, order.total], ['awaiting_payment', 'card', 18]);
  const link = linkOf(order);
  assert.deepEqual([link.type, link.amountCents, link.status], ['complement', 1800, 'open']);
  assert.deepEqual(JSON.parse(link.basketJson), { source: 'guestOrder', ref: String(orderId) });
  const lifetime = Date.parse(link.expiresAt) - Date.parse(`${link.createdAt.replace(' ', 'T')}Z`);
  assert.ok(lifetime >= 30 * 60 * 1000 && lifetime < 30 * 60 * 1000 + 1000, 'rule 35: its own lifetime is 30 min');
  assert.equal(card.created[0].amountCents, 1800);
  assert.equal(card.created[0].redirectUrl, `https://sejour.example.test/commande/${orderId}`);
  assert.equal(card.created[0].items.reduce((s, i) => s + i.amountCents, 0) <= 1800, true, 'the VAT basket is HT lines for the exact charge');
  // Rule 38 — unpaid: « Paiement par carte en attente », nothing on the fiche yet.
  const page = await call('GET', `/public/v1/guest/orders/${orderId}`);
  assert.equal(page.body.data.statusLabel, 'En attente de paiement');
  assert.deepEqual(page.body.data.notices, ['Paiement par carte en attente']);
});

withCard('rule 35: paid → the lines join the reservation and the payment is recorded as a settled note: the end-of-stay complement owes nothing for them', async ({ stayId, call, card, pushes }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'card' })).body.data;
  assert.equal(optionLine(stayId, CIDER), undefined, 'nothing reaches the fiche before the payment');
  await flush();
  assert.equal(pushes.length, 0, 'rule 44: a card order awaiting its payment pushes nobody');
  card.pay(linkOf(orderRow(orderId)).providerLinkId);
  const page = await call('GET', `/public/v1/guest/orders/${orderId}`);
  assert.equal(page.body.data.status, 'paid');
  assert.equal(page.body.data.statusLabel, 'Payée');
  assert.equal(optionLine(stayId, CIDER).quantity, 2);
  const note = notesOf(stayId).find((n) => n.source === 'guestOrder');
  assert.ok(note, JSON.stringify(notesOf(stayId)));
  assert.deepEqual([note.orderId, note.total, note.paidCash, note.reference], [orderId, 12, 0, `pay_${linkOf(orderRow(orderId)).providerLinkId}`]);
  assert.equal(endOfStayDetail(stayId).filter((l) => l.key === `opt:${CIDER}`).length, 0, 'the remainder owes nothing for the order');
  assert.ok(historyOf(stayId).some((c) => c.field === 'guestOrder' && c.to === `Commande client #${orderId} — payée par carte`));
  await flush();
  assert.equal(pushes.length, 1, 'rule 44: pushed once, on payment');
  assert.match(pushes[0].payload.body, /2 × Cidre \(payée par carte\)$/);
});

withCard('rule 35: the guest abandons from « Mes commandes » — Abandonnée, the link withdrawn, the lines back in the cart', async ({ call, pushes }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' })).body.data;
  const res = await call('POST', `/public/v1/guest/orders/${orderId}/abandon`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.statusLabel, 'Abandonnée');
  assert.deepEqual(res.body.data.cartLines, [{ kind: 'option', id: CIDER, quantity: 1 }]);
  const order = orderRow(orderId);
  assert.deepEqual([order.status, order.heldUntil], ['abandoned', null]);
  assert.equal(linkOf(order).status, 'cancelled');
  const again = await call('POST', `/public/v1/guest/orders/${orderId}/abandon`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'ORDER_NOT_PENDING');
  await flush();
  assert.equal(pushes.length, 0, 'rule 44: an abandoned card order never pushed anyone');
});

withCard('rule 36: unpaid 30 minutes on, the order expires — nothing on the fiche', async ({ stayId, call, api, clock, pushes }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' })).body.data;
  clock.now = new Date(clock.now.getTime() + 29 * 60 * 1000);
  assert.equal(api.expireOrders().some((o) => o.id === orderId), false);
  clock.now = new Date(clock.now.getTime() + 2 * 60 * 1000);
  assert.equal(api.expireOrders().some((o) => o.id === orderId), true);
  assert.deepEqual([orderRow(orderId).status, orderRow(orderId).heldUntil], ['expired', null]);
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data.statusLabel, 'Expirée');
  assert.equal(optionLine(stayId, CIDER), undefined);
  await flush();
  assert.equal(pushes.length, 0, 'rule 44: an expired card order never pushed anyone');
});

withCard('rule 36: a payment confirmed after expiry still commits the order when nothing stands in its way', async ({ stayId, call, card, api, clock }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' })).body.data;
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  api.expireOrders();
  await payLate(linkOf(orderRow(orderId)), card);
  assert.equal(orderRow(orderId).status, 'paid');
  assert.equal(optionLine(stayId, CIDER).quantity, 1);
});

withCard('rule 35: a `deliverAt` earlier than payment + lead moves to the next delivery time, and the order says so', async ({ call, card, clock }) => {
  const slots = await call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: WOOD }] });
  const first = slots.body.data.days[0].slots[0].at;
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 1 }], deliverAt: first, payment: 'card' })).body.data;
  assert.equal(orderRow(orderId).deliverAt, new Date(first).toISOString());
  clock.now = new Date(clock.now.getTime() + 40 * 60 * 1000);
  card.pay(linkOf(orderRow(orderId)).providerLinkId);
  const page = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.equal(page.status, 'paid');
  const moved = orderRow(orderId);
  assert.equal(moved.deliverMoved, 1);
  assert.ok(Date.parse(moved.deliverAt) >= clock.now.getTime() + 30 * 60 * 1000, 'payment + lead');
  assert.match(page.notices[0], /^Livraison décalée au /);
});

withCard('rule 33: « Payer maintenant » is refused while no card provider is connected — the note stays', async ({ call }) => {
  const registry = require('../../sdk/registry');
  registry.ensure('online-payment').paymentProvider = null;
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CARD_UNAVAILABLE');
});

withCard('rule 35: while awaiting payment the order holds its bath slot — another stay is refused it, and gets it once the order expires', async ({ call, api, clock }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [SLOT] }], payment: 'card' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const other = seedStay({ propertyId: 2 });
  const neighbour = await openOrdering(other, { propertyId: 2 });
  try {
    neighbour.clock.now = clock.now;
    const held = await neighbour.call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions: [SLOT] }] });
    assert.equal(held.body.data.lines[0].sessions[0].reason, 'taken', JSON.stringify(held.body));
    clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
    api.expireOrders();
    neighbour.clock.now = clock.now;
    const free = await neighbour.call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions: [SLOT] }] });
    assert.equal(free.body.data.lines[0].unavailable, undefined, JSON.stringify(free.body));
  } finally {
    await neighbour.close();
  }
}, { skip: !hasHourly });

withCard('rule 36: paid late on a slot taken meanwhile → paid_conflict, nothing on the fiche, the money « à rembourser » on the ledger with a history entry', async ({ stayId, call, card, api, clock, pushes }) => {
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [SLOT] }], payment: 'card' })).body.data;
  clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
  api.expireOrders();
  // Another stay takes the slot from its fiche.
  const other = seedStay({ propertyId: 2 });
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, sessions) VALUES (?, ?, 1, 'per_hour', ?)")
    .run(other, BATH, JSON.stringify([SLOT]));
  await payLate(linkOf(orderRow(orderId)), card);
  assert.equal(orderRow(orderId).status, 'paid_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(stayId).n, 0, 'no line is added');
  const link = linkOf(orderRow(orderId));
  assert.equal(link.status, 'paid');
  assert.equal(JSON.parse(link.basketJson).refundOwed, true);
  assert.ok(historyOf(stayId).some((c) => c.field === 'refundOwed' && /à rembourser/.test(c.to)));
  const ledger = buildLedger({ row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId), links: paymentLinksModel.listForReservation(stayId) });
  const row = ledger.rows.find((r) => r.key === 'basketRefunds');
  assert.ok(row, JSON.stringify(ledger.rows.map((r) => r.key)));
  assert.deepEqual([row.label, row.amount, row.stateLabel], ['Commande client à rembourser', 30, 'À rembourser']);
  const page = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.equal(page.statusLabel, 'Payée · à rembourser');
  await flush();
  assert.ok(pushes.some((p) => /à rembourser/.test(p.payload.body)), 'rule 36: the operator is pushed');
}, { skip: !hasHourly });
