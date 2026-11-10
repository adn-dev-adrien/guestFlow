// specs/guest-app.md rules 71, 87 (audit of the J-7 branch, items 3-5, 10-12) — what the arrival SAS step reads of the stay's app orders:
// the collapsible list's labels as the server words them (one row per article, the bath's evening supplement said inside its row, a key
// namespace per kind), what it counts, when it disappears (arrival complement collected), what a refusal says (stock and the article's
// own bound apart), and the staff's payment label of an order that will never be collected.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, fakeProvider, hasHourly, isoPlus, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 951, title: 'Cidre fermier', price: 6 });
const WINE = addOption({ id: 952, title: 'Vin', price: 9 });
const BATH = addBath({ id: 95, freeMinutes: { 1: 60 } });
sell('option', CIDER, { maxQuantity: 5 });
sell('option', WINE, { maxQuantity: 10 });
sell('resource', BATH);
db.prepare('UPDATE resources SET hourlyEveningStart = ?, hourlyEveningRate = 40, showsPlanningCard = 1 WHERE id = ?').run('19:00', BATH);

function withStay(name, fn, { skip = false } = {}) {
  test(name, { skip }, async () => {
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
    const ctx = await openOrdering(stayId, { card: fakeProvider(), guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const euros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
const place = (call, lines, payment = 'note') => call('POST', '/public/v1/guest/orders', { lines, payment });
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);

withStay('rule 71: the payload words its own summary and its recap note — « 2 commandes · 21 € à percevoir »', async ({ stayId, call, api }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }]);
  await place(call, [{ kind: 'option', id: WINE, quantity: 1 }]);
  const data = api.ordersAtArrival(stayId);
  assert.equal(data.summaryLabel, `2 commandes · ${euros(21)} à percevoir`);
  await place(call, [{ kind: 'option', id: CIDER, quantity: 1 }], 'card');
  db.prepare("UPDATE guest_orders SET payment = 'card', status = 'paid', collectAt = 'arrival' WHERE id = (SELECT MAX(id) FROM guest_orders)").run();
  assert.equal(api.ordersAtArrival(stayId).summaryLabel, `3 commandes · ${euros(21)} à percevoir · ${euros(6)} payés par carte`);
  assert.equal(data.recapNote, `Commandes Mon séjour : ${euros(21)} (dans le complément d’arrivée)`);
});

withStay('rule 71: the arrival complement collected — no step, whatever the orders say (the SAS never names what was collected)', async ({ stayId, call, api }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }]);
  assert.ok(api.ordersAtArrival(stayId));
  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = ?').run(stayId);
  assert.equal(api.ordersAtArrival(stayId), null);
});

withStay('rule 71: `changed` reads « the fiche was lowered since the orders » — Σ unpaid snapshots above the arrival complement', async ({ stayId, call, api }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }]);
  assert.equal(api.ordersAtArrival(stayId).changed, false);
  db.prepare('UPDATE reservations SET complementAmount = 6 WHERE id = ?').run(stayId);
  assert.equal(api.ordersAtArrival(stayId).changed, true);
  db.prepare('UPDATE reservations SET complementAmount = 30 WHERE id = ?').run(stayId);
  assert.equal(api.ordersAtArrival(stayId).changed, false, 'a complement above the orders (tourist tax, other lines) is no change');
});

withStay('rule 71: the bath is ONE row — sessions, « offerte » and « + 10 € soirée » said inside it, the charge adds to the row\'s price and has no row of its own; every key lives in its kind\'s namespace', async ({ stayId, call, api }) => {
  const day = isoPlus(6);
  const placed = await place(call, [{ kind: 'resource', id: BATH, sessions: [{ date: day, start: '20:00', end: '21:00' }] }, { kind: 'option', id: CIDER, quantity: 1 }]);
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const [order] = api.ordersAtArrival(stayId).orders;
  const stored = JSON.parse(db.prepare('SELECT linesJson FROM guest_orders WHERE id = ?').get(order.id).linesJson);
  assert.ok(stored.some((l) => l.kind === 'charge'), 'the evening supplement is a charge line of the order');
  assert.equal(order.lines.length, 2, 'the charge is not a row');
  const bath = order.lines.find((l) => l.key === `res:${BATH}`);
  assert.match(bath.unitLabel, /20 h – 21 h · offerte · \+ .*10.* soirée$/);
  assert.equal(bath.amountLabel, euros(10), 'the free hour (0 €) plus the evening supplement (10 €)');
  assert.equal(bath.editable, false);
  assert.equal(bath.removable, true);
  assert.equal(new Set(order.lines.map((l) => l.key)).size, 2);
  assert.ok(order.lines.every((l) => /^(opt|res|brk):/.test(l.key)));
}, { skip: !hasHourly });

withStay('rule 71: the bath row\'s price is the line plus its evening charge — and the order total is the same figure', async ({ stayId, call, api }) => {
  const day = isoPlus(6);
  await place(call, [{ kind: 'resource', id: BATH, sessions: [{ date: day, start: '20:00', end: '21:00' }] }]);
  const [order] = api.ordersAtArrival(stayId).orders;
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].amountLabel, order.totalLabel);
}, { skip: !hasHourly });

withStay('rule 87 (item 11): the article\'s own bound and the stock are two refusals, each with its words', async ({ call }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }])).body.data.orderId;
  const over = await amend(call, orderId, { lines: [{ key: `opt:${CIDER}`, quantity: 6 }] });
  assert.deepEqual([over.status, over.body.code, over.body.error, over.body.max], [409, 'ITEM_MAX_QUANTITY', '5 au plus pour « Cidre fermier ».', 5]);
  const cellar = addOption({ id: 953, title: 'Cave', price: 7 });
  sell('option', cellar, { maxQuantity: 20 });
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 3 WHERE itemId = ?').run(cellar);
  const second = (await place(call, [{ kind: 'option', id: cellar, quantity: 2 }])).body.data.orderId;
  const out = await amend(call, second, { lines: [{ key: `opt:${cellar}`, quantity: 8 }] });
  assert.deepEqual([out.status, out.body.code, out.body.error], [409, 'OUT_OF_STOCK', 'Plus que 1 en stock.']);
});

withStay('rule 87 (item 11): the step\'s « + » stops at the smaller of the two — maxQuantity carries it', async ({ stayId, call, api }) => {
  const juice = addOption({ id: 954, title: 'Jus', price: 3 });
  sell('option', juice, { maxQuantity: 5 });
  await place(call, [{ kind: 'option', id: juice, quantity: 2 }]);
  assert.equal(api.ordersAtArrival(stayId).orders[0].lines[0].maxQuantity, 5);
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 5 WHERE itemId = ?').run(juice);
  const left = api.ordersAtArrival(stayId).orders[0].lines[0].maxQuantity;
  assert.ok(left <= 5);
  db.prepare('UPDATE guest_app_items SET stockQuantity = 3 WHERE itemId = ?').run(juice);
  assert.ok(api.ordersAtArrival(stayId).orders[0].lines[0].maxQuantity <= 3, 'the stock, smaller than the bound, wins');
});

withStay('rule 72 (item 12): a cancelled order of a cancelled stay reads « Rien à percevoir », never « À régler à l\'arrivée »; a paid one keeps « Carte »', async ({ stayId, call }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 1 }])).body.data.orderId;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(stayId);
  db.prepare("UPDATE guest_orders SET status = 'cancelled', cancelReason = 'stay' WHERE id = ?").run(orderId);
  const row = (await call('GET', '/api/guest-app/orders?status=all')).body.orders.find((o) => o.id === orderId);
  assert.deepEqual([row.statusLabel, row.paymentLabel], ['Séjour annulé', 'Rien à percevoir']);
});

withStay('rule 80 (item 12): a crafted session on the day before the arrival reads « hors de votre séjour », not « passé »', async ({ call }) => {
  const day = isoPlus(4);
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: day, start: '20:00', end: '21:00' }] }] });
  const [line] = quote.body.data.lines;
  assert.equal(line.unavailable, true);
  assert.equal(line.unavailableReason, 'Ce créneau est hors de votre séjour');
}, { skip: !hasHourly });
