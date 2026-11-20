// specs/guest-app.md rule 72 (audit of the J-7 branch, item 7 / M19) — the cancellation of a stay's orders is WIRED to the core's events:
// the plugin's own handlers of `reservation.cancelled`, `reservation.deleted` and `reservation.updated` (a stay that stopped being a
// reservation) cancel the orders, a live reservation's update never does, and the created event never does either.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 811, title: 'Cidre', price: 6 });
sell('option', CIDER);

async function orderedStay() {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
  const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  await ctx.close();
  return { stayId, orderId: placed.body.data.orderId };
}

function pluginHandlers() {
  const registry = require('../../sdk/registry');
  const { createContext } = require('../../sdk/createContext');
  registry.reset();
  const { register } = require('..');
  register(createContext('guest-app', { db, settingsModel: () => ({ get: () => '', set: () => {}, raw: () => null }) }));
  return registry.get('guest-app').handlers;
}
const statusOf = (id) => db.prepare('SELECT status, cancelReason FROM guest_orders WHERE id = ?').get(id);

test('rule 72: reservation.cancelled and reservation.deleted cancel the orders of the stay, through the plugin\'s own handlers', async () => {
  const handlers = pluginHandlers();
  for (const [event, kind] of [['reservation.cancelled', 'cancelled'], ['reservation.deleted', 'deleted']]) {
    const { stayId, orderId } = await orderedStay();
    const handlersNow = pluginHandlers();
    db.prepare('UPDATE reservations SET kind = ? WHERE id = ?').run(kind, stayId);
    await handlersNow.get(event)[0]({ reservationId: stayId });
    assert.deepEqual(statusOf(orderId), { status: 'cancelled', cancelReason: 'stay' }, event);
  }
  assert.ok(handlers);
});

test('rule 72: reservation.updated cancels them only once the stay stopped being a reservation (superseded), never for a live one', async () => {
  const { stayId, orderId } = await orderedStay();
  const handlers = pluginHandlers();
  await handlers.get('reservation.updated')[0]({ reservationId: stayId });
  assert.equal(statusOf(orderId).status, 'confirmed', 'a live reservation keeps its orders');
  db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = ?").run(stayId);
  await handlers.get('reservation.updated')[0]({ reservationId: stayId });
  assert.deepEqual(statusOf(orderId), { status: 'cancelled', cancelReason: 'stay' });
});

test('rule 72: reservation.created never cancels', async () => {
  const { stayId, orderId } = await orderedStay();
  const handlers = pluginHandlers();
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
  await handlers.get('reservation.created')[0]({ reservationId: stayId });
  assert.equal(statusOf(orderId).status, 'confirmed');
});
