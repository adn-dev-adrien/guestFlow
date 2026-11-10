// specs/guest-app.md rule 87 (audit of the J-7 branch, item 6 / N10) — an unpaid order is no longer editable once the arrival complement
// is collected, even when the arrival was never marked (« Marquer perçu » on the fiche): the amend is refused, nothing written, and the
// amend's own answer carries the order's true `editable` flag while the stay still allows it.
const fx = require('./guestOrderFixtures');
const { buildArrivalOrdersController } = require('../controllers/arrivalOrdersController');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, optionLine, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 961, title: 'Cidre fermier', price: 6 });
sell('option', CIDER, { maxQuantity: 5 });

const place = (call, lines) => call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);

async function withOrder(fn) {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
  try {
    const orderId = (await place(ctx.call, [{ kind: 'option', id: CIDER, quantity: 2 }])).body.data.orderId;
    await fn({ stayId, orderId, ...ctx });
  } finally {
    await ctx.close();
  }
}

test('rule 87 (N10): the arrival complement collected — the stay is no editable stay, whatever the core says of its collection', () => {
  const order = {
    id: 7, reservationId: 1, status: 'confirmed', payment: 'note', collectAt: 'arrival', total: 12, lines: [{ kind: 'option', id: CIDER, title: 'Cidre', quantity: 2, total: 12 }],
  };
  const answer = (state) => {
    let sent = null;
    const res = { status(status) { return { json(body) { sent = { status, ...body }; } }; } };
    const controller = buildArrivalOrdersController({
      orders: () => ({ findById: () => order, atArrivalFor: () => [order] }),
      stays: () => ({ byId: () => ({ id: 1, kind: 'reservation', startDate: '2099-01-01', propertyId: 1 }), arrivalComplementState: () => state }),
      shop: { soldFor: () => ({ sold: [] }) },
      stock: () => ({ states: () => new Map() }),
      alertStock: () => {},
      commit: { orderCollection: () => 'arrival', amendOrder: () => ({ status: 409, body: { code: 'REACHED_THE_CORE' } }) },
      scheduler: () => null,
      now: () => new Date('2099-01-01T10:00:00Z'),
    });
    controller.amend({ params: { id: '7' }, body: { lines: [{ key: `opt:${CIDER}`, quantity: 1 }] }, user: { role: 'admin' } }, res);
    return sent;
  };
  const collected = answer('collected');
  assert.deepEqual([collected.status, collected.code], [409, 'ORDER_NOT_EDITABLE']);
  assert.equal(answer('open').code, 'REACHED_THE_CORE', 'an open complement reaches the core');
});

test('rule 87: the amend answer carries the order\'s own editable flag — true while the stay allows it', async () => {
  await withOrder(async ({ orderId, call }) => {
    const done = await amend(call, orderId, { lines: [{ key: `opt:${CIDER}`, quantity: 1 }] });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.order.editable, true);
    assert.equal(done.body.ordersAtArrival.orders[0].editable, done.body.order.editable);
  });
});
