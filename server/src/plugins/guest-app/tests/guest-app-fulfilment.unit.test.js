// specs/guest-app.md rules 41bis, 41ter — delivered to the lodging or picked up: one setting for every lodging, the
// pickup place required, the picker's question, the promise the guest reads once the order stands (built from
// `deliverAt` and the mode, the longest lead of the staff items only), the bath's own line, no time for a self-service
// order, the moved notice, and the staff's words (« à retirer », « Retirée »). On the app's database, stays around today.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, fakeProvider, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { memorySettings } = require('..');
const labels = require('../orderLabels');

const WOOD = addOption({ id: 701, title: 'Panier de bois', price: 15, category: 'Autres' });
const PLATTER = addOption({ id: 702, title: 'Plateau de picodons', price: 18, category: 'Alimentation' });
const CODE = addOption({ id: 703, title: 'Jus en libre-service', price: 4 });
const BATH = addBath({ id: 76 });
sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });
sell('option', PLATTER, { needsStaff: 1, leadMinutes: 60 });
sell('option', CODE);
sell('resource', BATH);

function withShop(name, fn, { settings = {}, card = false, skip = false } = {}) {
  test(name, { skip }, async () => {
    const stayId = seedStay();
    const store = memorySettings(settings);
    const provider = card ? fakeProvider() : null;
    const ctx = await openOrdering(stayId, { card: provider, guestHost: 'sejour.example.test', settingsStore: () => store });
    try {
      await fn({ stayId, store, card: provider, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const firstSlot = async (call, lines) => {
  const data = (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines })).body.data;
  return { data, at: data.days[0].slots[0].at };
};

withShop('rule 41bis: « À retirer » needs its place to save; the mode and the place are one setting for every lodging', async ({ call, store }) => {
  const refused = await call('PUT', '/api/guest-app/studio/settings', { fulfilment: 'pickup' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'Indiquez le lieu de retrait des commandes.');
  assert.equal(store.get('fulfilment'), 'delivery', 'nothing written');
  const saved = await call('PUT', '/api/guest-app/studio/settings', { fulfilment: 'pickup', pickupPlace: '  À l’accueil, maison principale — sonnez à la porte verte ' });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.fulfilment, saved.body.pickupPlace], ['pickup', 'À l’accueil, maison principale — sonnez à la porte verte']);
  assert.equal((await call('PUT', '/api/guest-app/studio/settings', { pickupPlace: '' })).status, 400, 'the place cannot be emptied while pickup');
  assert.equal((await call('PUT', '/api/guest-app/studio/settings', { fulfilment: 'drone' })).status, 400);
  assert.equal((await call('PUT', '/api/guest-app/studio/settings', { pickupPlace: 'x'.repeat(201) })).status, 400);
});

withShop('rule 41bis: the picker asks « Quand souhaitez-vous la recevoir ? » when delivered, « … la récupérer ? » when picked up', async ({ call, store }) => {
  const delivered = (await firstSlot(call, [{ kind: 'option', id: WOOD }])).data;
  assert.deepEqual([delivered.mode, delivered.question], ['delivery', 'Quand souhaitez-vous la recevoir ?']);
  store.set('fulfilment', 'pickup');
  store.set('pickupPlace', 'À l’accueil');
  const pickup = (await firstSlot(call, [{ kind: 'option', id: WOOD }])).data;
  assert.deepEqual([pickup.mode, pickup.question], ['pickup', 'Quand souhaitez-vous la récupérer ?']);
  const en = (await call('POST', '/public/v1/guest/shop/delivery-slots?lang=en', { lines: [{ kind: 'option', id: CODE }] })).body.data;
  assert.deepEqual([en.needed, en.question], [false, 'When would you like to pick it up?']);
  store.set('pickupPlace', '');
  assert.equal((await firstSlot(call, [{ kind: 'option', id: WOOD }])).data.mode, 'delivery', 'no place: delivered rather than nowhere');
});

withShop('rule 41ter: delivered — « Livrée à La Granja … vers … », the chosen time; the longest lead of the staff items only', async ({ call }) => {
  const lines = [{ kind: 'option', id: WOOD, quantity: 1 }, { kind: 'option', id: PLATTER, quantity: 1 }, { kind: 'option', id: CODE, quantity: 1 }];
  const { at } = await firstSlot(call, lines);
  const wood = await firstSlot(call, [{ kind: 'option', id: WOOD }]);
  const platter = await firstSlot(call, [{ kind: 'option', id: PLATTER }, { kind: 'option', id: CODE }]);
  assert.equal(at, platter.at, 'the platter’s 60 min drive the cart, the self-service juice none');
  assert.ok(Date.parse(at) > Date.parse(wood.at));
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines, deliverAt: at, payment: 'note' })).body.data;
  const order = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  const { date, time } = labels.parisMoment(at);
  const day = labels.relativeDay(date, new Date(), 'fr');
  assert.equal(order.fulfilment, 'delivery');
  assert.equal(order.promise, `Livrée à La Granja ${day} vers ${labels.timeLabel(time)}`);
  assert.equal(order.movedNotice, null);
  assert.match(order.deliveryLabel, /^Prévue /);
});

withShop('rule 41ter: picked up — « Prête … à …. Lieu de retrait : … » as typed; the staff reads « à retirer » and checks « Retirée »', async ({ call, store, pushes }) => {
  store.set('fulfilment', 'pickup');
  store.set('pickupPlace', 'À l’accueil, maison principale');
  const { at } = await firstSlot(call, [{ kind: 'option', id: WOOD }]);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 2 }], deliverAt: at, payment: 'note' })).body.data;
  store.set('pickupPlace', 'Ailleurs');
  const order = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  const { date, time } = labels.parisMoment(at);
  assert.equal(order.promise, `Prête ${labels.relativeDay(date, new Date(), 'fr')} à ${labels.timeLabel(time)}. Lieu de retrait : À l’accueil, maison principale`, 'the place of the order, as typed then');
  assert.match(order.deliveryLabel, /^Prête /);
  const en = (await call('GET', `/public/v1/guest/orders/${orderId}?lang=en`)).body.data;
  assert.match(en.promise, /^Ready (today|tomorrow|on .+) at \d{1,2}:\d{2}\. Pick-up point: À l’accueil, maison principale$/);
  await new Promise((resolve) => { setImmediate(resolve); });
  const push = pushes.find((p) => p.payload.title === `Commande client #${orderId}`);
  assert.match(push.payload.body, /2 × Panier de bois à retirer \d{1,2} h( \d{2})? \(sur la note\)$/);
  const row = (await call('GET', '/api/guest-app/orders')).body.orders.find((o) => o.id === orderId);
  assert.deepEqual([row.fulfilment, row.fulfilmentLabel, row.markLabel, row.pickupPlace], ['pickup', 'À retirer', 'Marquer retirée', 'À l’accueil, maison principale']);
  assert.match(row.deliverLabel, /^À retirer /);
  await call('POST', `/api/guest-app/orders/${orderId}/delivered`);
  const done = (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.id === orderId);
  assert.equal(done.statusLabel, 'Retirée');
  const day = labels.parisMoment(at).date;
  const cards = (await call('GET', `/api/guest-app/planning/order-cards?from=${day}&to=${day}`)).body.days.flatMap((d) => d.cards);
  const card = cards.find((c) => c.orderId === orderId);
  assert.deepEqual([card.fulfilment, card.doneLabel, card.delivered], ['pickup', 'Retirée', true]);
  assert.match(card.timeLabel, /^À retirer /);
  assert.equal((await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data.deliveryLabel, 'Retirée');
});

withShop('rule 41ter: a self-service order carries no time; the bath keeps its own line, « il sera chaud »', async ({ call }) => {
  const self = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CODE, quantity: 1 }], payment: 'note' })).body.data;
  const read = (await call('GET', `/public/v1/guest/orders/${self.orderId}`)).body.data;
  assert.equal(read.promise, null);
  assert.equal(read.extraPromises, undefined);
  const tomorrow = isoPlus(1);
  const bath = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: tomorrow, start: '20:00', end: '21:00' }] }], payment: 'note' });
  assert.equal(bath.status, 200, JSON.stringify(bath.body));
  const order = (await call('GET', `/public/v1/guest/orders/${bath.body.data.orderId}`)).body.data;
  assert.equal(order.promise, null);
  assert.deepEqual(order.extraPromises, [`Bain nordique — ${labels.dayLabel(tomorrow)}, 20 h, il sera chaud`]);
}, { skip: !hasHourly });

withShop('rule 41ter: a time moved at payment is the one shown, with « Votre commande sera prête un peu plus tard que prévu »', async ({ call, card, clock }) => {
  const { at } = await firstSlot(call, [{ kind: 'option', id: WOOD }]);
  const { orderId } = (await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 1 }], deliverAt: at, payment: 'card' })).body.data;
  const waiting = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.equal(waiting.promise, null, 'no promise before the card is paid');
  clock.now = new Date(clock.now.getTime() + 40 * 60 * 1000);
  const db = fx.db;
  const linkId = db.prepare('SELECT paymentLinkId FROM guest_orders WHERE id = ?').get(orderId).paymentLinkId;
  card.pay(db.prepare('SELECT providerLinkId FROM payment_links WHERE id = ?').get(linkId).providerLinkId);
  const paid = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.movedNotice, 'Votre commande sera prête un peu plus tard que prévu');
  const { time } = labels.parisMoment(paid.deliverAt);
  assert.ok(paid.promise.endsWith(`vers ${labels.timeLabel(time)}`), paid.promise);
  assert.notEqual(paid.deliverAt, at);
}, { card: true });
