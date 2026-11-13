// specs/guest-app.md rules 100, 102, 103 (fifth pass, 2026-11-10) — the arrival SAS step and the bath slots:
//  - a 0 € order (the free bath hour) reads « Offert », never « À régler à l'arrivée », and is editable and removable like any unpaid order;
//    removing it frees its slot;
//  - an article with free units reads its true part (« 2 × 6,50 € · 2 offerts »), never « 4 × 6,50 € » beside a 13 € total;
//  - the bath slots follow the shop's own judge: a stay that cannot order yet is offered no slot.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 971, title: 'Cidre fermier', price: 6.5 });
db.prepare('INSERT OR REPLACE INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 6.5, 2)').run(CIDER);
sell('option', CIDER, { maxQuantity: 10 });
const BATH = addBath({ id: 97, freeMinutes: { 1: 60 } });
sell('resource', BATH);

function withStay(name, stay, fn, { skip = false } = {}) {
  test(name, { skip }, async () => {
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const place = (call, lines, payment = 'note') => call('POST', '/public/v1/guest/orders', { lines, payment });
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);
const slots = async (call) => (await call('GET', `/public/v1/guest/shop/resources/${BATH}/slots`)).body.data;
const freeHour = () => [{ kind: 'resource', id: BATH, sessions: [{ date: isoPlus(6), start: '12:00', end: '13:00' }] }];

withStay('rule 103 (LOW 6): the free bath hour reads « Offert », is editable and removable, and removing it frees the slot', {}, async ({ stayId, call, api }) => {
  const placed = await place(call, freeHour(), 'none');
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const [order] = api.ordersAtArrival(stayId).orders;
  assert.equal(order.statusLabel, 'Offert');
  assert.deepEqual([order.paid, order.editable], [false, true]);
  assert.equal(order.lines[0].removable, true);
  assert.equal(api.ordersAtArrival(stayId).toCollect, 0);
  const taken = (await slots(call)).days.find((d) => d.date === isoPlus(6)).slots.some((s) => s.start === '12:00');
  assert.equal(taken, false, 'the slot is held by the order');
  const removed = await amend(call, order.id, { removeOrder: true });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(db.prepare('SELECT status FROM guest_orders WHERE id = ?').get(order.id).status, 'cancelled');
  const free = (await slots(call)).days.find((d) => d.date === isoPlus(6)).slots.some((s) => s.start === '12:00');
  assert.equal(free, true, 'the slot is free again');
}, { skip: !hasHourly });

withStay('rule 103: a priced order on the note still reads « À régler à l’arrivée » and is editable', {}, async ({ stayId, call, api }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 3 }]);
  const [order] = api.ordersAtArrival(stayId).orders;
  assert.equal(order.statusLabel, 'À régler à l’arrivée');
  assert.equal(order.editable, true);
});

withStay('rule 100 (LOW 2): 4 units with 2 free read « 2 × 6,50 € · 2 offerts » in the SAS list', {}, async ({ stayId, call, api }) => {
  const placed = await place(call, [{ kind: 'option', id: CIDER, quantity: 4 }]);
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const [order] = api.ordersAtArrival(stayId).orders;
  assert.match(order.lines[0].unitLabel, /^2 × 6,50.€ · 2 offerts$/);
  assert.equal(order.lines[0].quantity, 4);
});

withStay('rule 102 (LOW 5): the shop closed (the end-of-stay complement collected) — the slots answer open: false with the shop\'s own sentence and no day', { endOfStayPaid: 1 }, async ({ stayId, call }) => {
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.equal(shop.open, false);
  const data = await slots(call);
  assert.deepEqual([data.open, data.days], [false, []]);
  assert.equal(data.closedReason, shop.closedReason);
  const crafted = await place(call, freeHour(), 'none');
  assert.equal(crafted.status, 409, 'a crafted order is refused before anything is priced');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 0);
}, { skip: !hasHourly });

withStay('rule 102: the shop open — the slots carry open: true and their days', {}, async ({ call }) => {
  const data = await slots(call);
  assert.equal(data.open, true);
  assert.ok(data.days.length > 0);
}, { skip: !hasHourly });
