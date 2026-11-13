// specs/guest-app.md rules 25, 27, 32-34, 37, 38, 44 — an order « sur la note » and a 0 € order through the real routes,
// written by the core's own save on a started stay: no name is ever asked, the lines land on the fiche and in the
// end-of-stay complement, quantities add to the stay's line, the 0 € allowance holds across orders, the staff is pushed.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, endOfStayDetail, historyOf, openOrdering, optionLine, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 301, title: 'Cidre', price: 6 });
const PLATTER = addOption({ id: 302, title: 'Plateau du terroir', price: 25, prices: { 1: 0 }, category: 'Alimentation' });
const COVERS = addOption({ id: 303, title: 'Couverts pique-nique', priceType: 'per_person', price: 4 });
sell('option', CIDER, { maxQuantity: 6 });
sell('option', PLATTER, { maxQuantity: 2 });
sell('option', COVERS);

function withOrdering(name, fn, options = {}) {
  test(name, async () => {
    const stayId = seedStay(options.stay);
    const ctx = await openOrdering(stayId, options);
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const midStay = (stayId, key) => endOfStayDetail(stayId).filter((l) => l.source === 'midStayExtra' && l.key === key)
  .reduce((sum, l) => sum + Number(l.amount), 0);

withOrdering('rules 33, 34, 46: « Ajouter à ma note » asks no name — confirmed at once, the line on the fiche and in the end-of-stay complement', async ({ stayId, call, pushes }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'confirmed');
  assert.equal(optionLine(stayId, CIDER).quantity, 2);
  assert.equal(midStay(stayId, `opt:${CIDER}`), 12, 'rule 34: a mid-stay extra, exactly like an operator addition');
  const order = db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(res.body.data.orderId);
  assert.deepEqual([order.status, order.payment, order.total], ['confirmed', 'note', 12]);
  assert.ok(historyOf(stayId).some((c) => c.field === 'guestOrder' && c.to === `Commande client #${order.id}`), 'rule 34: « Commande client #N » in the history');
  // Rule 44 — the staff is pushed on the « Commandes clients » channel.
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].key, 'guest-orders');
  assert.equal(pushes[0].payload.body, 'La Granja · Marie — 2 × Cidre (sur la note)');
});

withOrdering('specs/pricing-components.md rules 13, 85: a second order is a line of its own — the first line is untouched, the end-of-stay owes both', async ({ stayId, call }) => {
  await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  const lines = db.prepare('SELECT lineId, quantity FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(stayId, CIDER);
  assert.deepEqual(lines.map((l) => l.quantity), [1, 2]);
  assert.equal(midStay(stayId, `opt:${CIDER}`), 6);
  assert.equal(midStay(stayId, `line:reservation_options:${lines[1].lineId}`), 12);
});

withOrdering('rule 34: a per-person option counts one more person served per unit ordered', async ({ stayId, call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: COVERS, quantity: 3 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const line = optionLine(stayId, COVERS);
  assert.deepEqual([line.quantity, line.cardPersons], [1, 3]);
  assert.equal(midStay(stayId, `opt:${COVERS}`), 12);
});

withOrdering('rule 25: a 0 € order needs no payment — one « Réserver », confirmed, on the fiche at 0 €', async ({ stayId, call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'none' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(res.body.data.orderId);
  assert.deepEqual([order.status, order.payment, order.total], ['confirmed', 'none', 0]);
  assert.equal(optionLine(stayId, PLATTER).quantity, 1);
  assert.equal(midStay(stayId, `opt:${PLATTER}`), 0);
  // A payment asked of a 0 € order is no payment at all.
  const card = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'card' });
  assert.equal(card.status, 200, JSON.stringify(card.body));
  assert.equal(db.prepare('SELECT payment FROM guest_orders WHERE id = ?').get(card.body.data.orderId).payment, 'none');
});

withOrdering('rule 25: a 0 € item is limited per stay to its maxQuantity, counted across orders', async ({ call }) => {
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PLATTER, quantity: 2 }], payment: 'none' })).status, 200);
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }] });
  assert.equal(quote.body.data.lines[0].unavailable, true);
  assert.equal(quote.body.data.lines[0].unavailableReason, 'Limite atteinte pour votre séjour');
  const again = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'none' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'ITEM_UNAVAILABLE');
});

withOrdering('rule 33: a priced order needs a way to pay — « none » is only for 0 €', async ({ call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'none' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_INPUT');
});

withOrdering('rule 37: a quantity over maxQuantity, more than 20 lines, or a total over the ceiling → 400 ORDER_LIMIT', async ({ call }) => {
  const over = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 7 }], payment: 'note' });
  assert.equal(over.status, 400);
  assert.equal(over.body.error.code, 'ORDER_LIMIT');
  const many = Array.from({ length: 21 }, (_, i) => ({ kind: 'option', id: 1000 + i, quantity: 1 }));
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines: many, payment: 'note' })).body.error.code, 'ORDER_LIMIT');
  const ceiling = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 5 }], payment: 'note' });
  assert.equal(ceiling.status, 400);
  assert.equal(ceiling.body.error.code, 'ORDER_LIMIT');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_orders WHERE status = 'confirmed' AND total = 30").get().n, 0, 'nothing was written');
}, { maxOrderTotal: () => 20 });

withOrdering('rule 27: after the end-of-stay complement is collected, no order is taken — 409 SHOP_CLOSED, nothing written', async ({ stayId, call }) => {
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = ?').run(stayId);
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'SHOP_CLOSED');
  assert.equal(optionLine(stayId, CIDER), undefined);
});

withOrdering('rule 38: « Mes commandes » lists the stay’s orders with their chips — « Sur votre note », « Offerte »', async ({ call }) => {
  await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'none' });
  const list = await call('GET', '/public/v1/guest/orders');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.orders.map((o) => o.statusLabel), ['Offerte', 'Sur votre note']);
  assert.equal(list.body.data.orders[1].lines[0].label, '1 × Cidre');
  assert.equal(list.body.data.orders[1].totalLabel, '6\u00a0€');
});

withOrdering('rules 33, 34: an order refused by the fiche’s save writes nothing — not even the order row', async ({ stayId, call }) => {
  // A guest session on a stay the core no longer takes: the window closed between the shop's read and the save.
  db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = ?").run(stayId);
  const before = db.prepare('SELECT COUNT(*) AS n FROM guest_orders').get().n;
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.notEqual(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders').get().n, before);
});

withOrdering('rule 37: a session places 10 orders an hour at most — the 11th is refused, a refused one gives its hit back', async ({ call }) => {
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' })).status, 200);
  }
  const refused = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, 'TOO_MANY_REQUESTS');
}, { limiters: { order: require('../rateLimiters').createGuestLimiters().order } });

withOrdering('rule 11bis: « Mes commandes » off for the lodging → its endpoint answers 404 MODULE_OFF', async ({ call }) => {
  const { defaultModules } = require('../modules');
  require('../models/lodgingsModel')(db).save(1, { modules: defaultModules().map((m) => (m.key === 'orders' ? { ...m, on: false } : m)) });
  const res = await call('GET', '/public/v1/guest/orders');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'MODULE_OFF');
  require('../models/lodgingsModel')(db).save(1, { modules: defaultModules() });
});
