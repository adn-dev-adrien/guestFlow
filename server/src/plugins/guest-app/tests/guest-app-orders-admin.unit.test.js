// specs/guest-app.md rules 11, 38, 43, 45 — the staff's side of the guest orders through the real routes: the « Commandes
// clients » list by delivery time (« À préparer » / « Toutes »), « Marquer livrée », the planning's « Commande client »
// cards (what the staff prepares, never the breakfast nor the bath), and the reception's access.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, isoPlus, openOrdering, seedStay, sell,
} = fx;

const WOOD = addOption({ id: 601, title: 'Panier de bois', price: 15, category: 'Autres' });
const CIDER = addOption({ id: 602, title: 'Cidre', price: 6 });
sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });
sell('option', CIDER);

async function withStaff(name, fn) {
  test(name, async () => {
    db.prepare('DELETE FROM guest_orders').run();
    const stayId = seedStay();
    const ctx = await openOrdering(stayId);
    try {
      const nextDelivery = async () => (await ctx.call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: WOOD }] })).body.data.days[0].slots;
      await fn({ stayId, nextDelivery, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const staff = async (base, method, url) => {
  const res = await fetch(`${base}/api/guest-app${url}`, { method });
  return { status: res.status, body: await res.json() };
};

withStaff('rule 45: « À préparer » lists the orders on the fiche by delivery time, with lodging, guest, lines, delivery, payment and status', async ({ call, base, nextDelivery }) => {
  const slots = await nextDelivery();
  const later = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 2 }], deliverAt: slots[1].at, payment: 'note' })).body.data.orderId;
  const sooner = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 1 }, { kind: 'option', id: CIDER, quantity: 1 }], deliverAt: slots[0].at, payment: 'note' })).body.data.orderId;
  const { status, body } = await staff(base, 'GET', '/orders');
  assert.equal(status, 200);
  assert.deepEqual(body.orders.map((o) => o.id), [sooner, later]);
  const [first] = body.orders;
  assert.deepEqual(
    [first.lodging, first.guest, first.lines.map((l) => l.label), first.paymentLabel, first.statusLabel, first.canMarkDelivered],
    ['La Granja', 'Marie Le Goff-Durand', ['1 × Panier de bois', '1 × Cidre'], 'Sur la note', 'À préparer', true],
  );
  assert.ok(first.deliverLabel);
});

withStaff('rule 45: « Marquer livrée » — the order leaves « À préparer », stays in « Toutes », and the guest sees « Livrée »', async ({ call, base, nextDelivery }) => {
  const [slot] = await nextDelivery();
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 1 }], deliverAt: slot.at, payment: 'note' })).body.data;
  const mine = (await call('GET', '/public/v1/guest/orders')).body.data.orders[0];
  assert.match(mine.deliveryLabel, /^Prévue /, 'rule 38: « Prévue {jour heure} » before');
  assert.deepEqual((await staff(base, 'POST', `/orders/${orderId}/delivered`)).body, { status: 'delivered' });
  assert.deepEqual((await staff(base, 'POST', `/orders/${orderId}/delivered`)).body, { status: 'delivered' }, 'twice is once');
  assert.deepEqual((await staff(base, 'GET', '/orders')).body.orders, []);
  const all = (await staff(base, 'GET', '/orders?status=all')).body.orders;
  assert.deepEqual(all.map((o) => [o.id, o.statusLabel, o.canMarkDelivered]), [[orderId, 'Livrée', false]]);
  assert.equal((await call('GET', '/public/v1/guest/orders')).body.data.orders[0].deliveryLabel, 'Livrée');
  // Rule 11 — « Votre commande est prête » on the home within the hour.
  assert.equal((await call('GET', '/public/v1/guest/me')).body.data.highlight.key, 'order');
});

withStaff('rule 45: an order not on the fiche cannot be delivered; an unknown one is a 404; a bad filter a 400', async ({ base }) => {
  const id = db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt)
    VALUES (1, 'card', 'awaiting_payment', '[]', 10, ?)`).run(new Date().toISOString()).lastInsertRowid;
  const refused = await staff(base, 'POST', `/orders/${id}/delivered`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'ORDER_NOT_DELIVERABLE');
  assert.equal((await staff(base, 'POST', '/orders/999999/delivered')).status, 404);
  assert.equal((await staff(base, 'GET', '/orders?status=done')).status, 400);
});

withStaff('rule 43: a « Commande client » card on the planning day of its delivery, with the lines the staff prepares and a « Livrée » state', async ({ call, base, nextDelivery }) => {
  const [slot] = await nextDelivery();
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 2 }], deliverAt: slot.at, payment: 'note' })).body.data;
  const day = slot.at.slice(0, 10);
  const { body } = await staff(base, 'GET', `/planning/order-cards?from=${isoPlus(-1)}&to=${isoPlus(3)}`);
  const cards = body.days.find((d) => d.date === day).cards;
  assert.deepEqual(cards.map((c) => [c.orderId, c.lodging, c.guest, c.lines, c.delivered]), [[orderId, 'La Granja', 'Marie Le Goff-Durand', ['2 × Panier de bois'], false]]);
  assert.equal(cards[0].time, slot.at.slice(11, 16));
  assert.equal((await staff(base, 'GET', '/planning/order-cards?from=2099-01-01')).status, 400);
});

withStaff('rules 27bis, 43: an order of breakfast or bath only has no « Commande client » card — they have their own cards', async ({ base }) => {
  db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, deliverAt, createdAt)
    VALUES (1, 'note', 'confirmed', ?, 24, ?, ?)`).run(JSON.stringify([{ kind: 'breakfast', id: 9, title: 'Petit déjeuner', mornings: [isoPlus(1)], time: '09:00', persons: 2, total: 24 }]),
    new Date(Date.now() + 3600 * 1000).toISOString(), new Date().toISOString());
  const { body } = await staff(base, 'GET', `/planning/order-cards?from=${isoPlus(-1)}&to=${isoPlus(3)}`);
  assert.deepEqual(body.days, []);
});

test('rules 43, 45: the reception, who prepares and delivers, reads the orders and marks them delivered — nothing else', () => {
  const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
  require('../../loader').registerAll({ db: null, isInstalled: () => false });
  require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
  const passes = (roles, method, path) => {
    const res = { status() { return this; }, json() { return this; } };
    let passed = false;
    enforceRoleAccess({ user: { roles }, method, path }, res, () => { passed = true; });
    return passed;
  };
  assert.equal(passes(['reception'], 'GET', '/guest-app/orders'), true);
  assert.equal(passes(['reception'], 'POST', '/guest-app/orders/12/delivered'), true);
  assert.equal(passes(['reception'], 'GET', '/guest-app/planning/order-cards'), true);
  assert.equal(passes(['reception'], 'GET', '/guest-app/service-hours'), false);
  assert.equal(passes(['accountant'], 'GET', '/guest-app/orders'), false);
});
