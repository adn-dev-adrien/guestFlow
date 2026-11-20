// specs/guest-app.md rule 44 and specs/pricing-components.md rule 55 — the staff's push « Commandes clients » is an observer of the sale: a sale of source `shop`
// that names an order tells the staff once; a sale of another source, or one that names no order, tells nobody. A cancelled stay cancels its orders (rule 72).
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = fx;
const extraSale = require('../../../utils/extraSale');

const CIDER = addOption({ id: 3701, title: 'Cidre observé', price: 6 });
sell('option', CIDER);
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

test('rule 55 — an order sold tells the staff once; the same article sold by the fiche tells them nothing', async () => {
  const stayId = seedStay();
  const ctx = await openOrdering(stayId);
  try {
    const { orderId } = (await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' })).body.data;
    await flush();
    assert.equal(ctx.pushes.length, 1);
    assert.match(ctx.pushes[0].payload.body, /2 × Cidre observé/);
    assert.equal(ctx.pushes[0].payload.title, `Commande client #${orderId}`);
    assert.equal(extraSale.sell(stayId, [{ articleRef: `option:${CIDER}`, quantity: 1 }], { source: 'fiche' }).status, 200);
    await flush();
    assert.equal(ctx.pushes.length, 1, 'a sale of the fiche is no order');
  } finally { await ctx.close(); }
});

test('rule 72 — a stay cancelled cancels its orders: the order reads « Annulée » and leaves the preparation list', async () => {
  const stayId = seedStay();
  const ctx = await openOrdering(stayId);
  try {
    const { orderId } = (await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' })).body.data;
    db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
    assert.equal(ctx.api.cancelOrdersOf(stayId).length, 1);
    assert.deepEqual([db.prepare('SELECT status, cancelReason FROM guest_orders WHERE id = ?').get(orderId)].map((o) => [o.status, o.cancelReason]), [['cancelled', 'stay']]);
  } finally { await ctx.close(); }
});
