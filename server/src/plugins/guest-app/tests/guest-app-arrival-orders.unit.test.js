// specs/guest-app.md rules 71, 87 — the arrival SAS names the orders the stay took in the app before its arrival (the unpaid ones it
// collects, the card-paid ones read-only), and the operator changes an unpaid one before it is collected: quantity, article, bath
// session, the whole order — re-priced by the core, stock adjusted, journaled, the guest sees the new order.
// Also specs/single-payment-at-check-in.md rule 19 (the orders ride the arrival complement the single payment collects) and
// specs/guest-app.md rules 73 (a moved stay flags an order outside its dates) and 75 (the staff reads the day and the payment).
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, fakeProvider, hasHourly, historyOf, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { processPaidLink } = require('../../../utils/paymentPollRunner');
const { buildPaymentEffectDeps } = require('../../../utils/paymentEffectDeps');
const paymentLinksModel = require('../../../models/paymentLinksModel');

const CIDER = addOption({ id: 901, title: 'Cidre', price: 6 });
const JUICE = addOption({ id: 902, title: 'Jus de pomme', price: 4 });
const BATH = addBath({ id: 91, freeMinutes: {} });
sell('option', CIDER);
sell('option', JUICE);
sell('resource', BATH);
db.prepare('UPDATE resources SET hourlyEveningStart = ?, hourlyEveningRate = 40, showsPlanningCard = 1 WHERE id = ?').run('19:00', BATH);

function withStay(name, fn, { skip = false } = {}) {
  test(name, { skip }, async () => {
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
    const card = fakeProvider();
    const ctx = await openOrdering(stayId, { card, guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, card, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const euros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n);
const orderRow = (id) => db.prepare('SELECT * FROM guest_orders WHERE id = ?').get(id);
const stayRow = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const place = (call, lines, payment = 'note') => call('POST', '/public/v1/guest/orders', { lines, payment });
const amend = (call, id, body) => call('POST', `/api/guest-app/orders/${id}/amend`, body);

async function payCard(call, card, lines) {
  const { orderId } = (await place(call, lines, 'card')).body.data;
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(orderRow(orderId).paymentLinkId);
  card.pay(link.providerLinkId);
  await processPaidLink({
    ...buildPaymentEffectDeps(), link: paymentLinksModel.findById(link.id), paidPayment: { paid: true, paymentId: `pay_${link.providerLinkId}`, paidAt: new Date().toISOString() },
  });
  return orderId;
}

withStay('rule 71: no order, no step — `dataFor` is null; plugin data of the SAS carries `ordersAtArrival` once the stay ordered', async ({ stayId, call, api }) => {
  assert.equal(api.ordersAtArrival(stayId), null);
  await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }]);
  const data = api.ordersAtArrival(stayId);
  assert.equal(data.orders.length, 1);
  assert.deepEqual([data.toCollect, data.toCollectLabel, data.paid, data.paidLabel, data.changed], [12, euros(12), 0, null, false]);
});

withStay('rule 71: each order is a group — number, delivery, status, paid flag, lines with label / quantity × unit / line price, total; a card-paid order is read-only and never counts in « à percevoir »', async ({ stayId, call, card, api }) => {
  const unpaid = (await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }, { kind: 'option', id: JUICE, quantity: 1 }])).body.data.orderId;
  const paid = await payCard(call, card, [{ kind: 'option', id: CIDER, quantity: 1 }]);
  const data = api.ordersAtArrival(stayId);
  assert.deepEqual(data.orders.map((o) => [o.id, o.paid, o.editable, o.statusLabel]), [[unpaid, false, true, 'À régler à l’arrivée'], [paid, true, false, 'Payée par carte']]);
  const first = data.orders[0];
  assert.equal(first.totalLabel, euros(16));
  assert.deepEqual(first.lines[0], {
    key: `opt:${CIDER}`, label: 'Cidre', quantity: 2, unitLabel: `2 × ${euros(6)}`, amountLabel: euros(12), editable: true, removable: true, maxQuantity: 10,
  });
  assert.equal(data.orders[1].lines[0].editable, false);
  assert.deepEqual([data.toCollect, data.paid, data.paidLabel], [16, 6, euros(6)]);
});

withStay('rule 71: an order taken during the stay (collected at the departure) is not in the arrival step', async ({ stayId, call, api }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 1 }]);
  db.prepare("UPDATE guest_orders SET collectAt = 'departure' WHERE reservationId = ?").run(stayId);
  assert.equal(api.ordersAtArrival(stayId), null);
});

withStay('rule 87: a lower quantity — re-priced by the core, the order\'s snapshot and total rewritten, journaled, the guest sees « Modifiée à votre arrivée »', async ({ stayId, call }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 3 }])).body.data.orderId;
  assert.equal(stayRow(stayId).complementAmount, 18);
  const res = await amend(call, orderId, { lines: [{ key: `opt:${CIDER}`, quantity: 1 }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ordersAtArrival.orders[0].totalLabel, euros(6));
  assert.equal(res.body.ordersAtArrival.changed, false, 'an amendment from the step rewrites the snapshots: nothing is « lowered since »');
  const row = orderRow(orderId);
  assert.deepEqual([row.total, JSON.parse(row.linesJson)[0].quantity, JSON.parse(row.linesJson)[0].total, row.status], [6, 1, 6, 'confirmed']);
  assert.equal(JSON.parse(row.amendmentsJson).length, 1);
  assert.deepEqual(Object.keys(JSON.parse(row.amendmentsJson)[0]).sort(), ['at', 'by', 'changes']);
  assert.equal(stayRow(stayId).complementAmount, 6);
  assert.ok(historyOf(stayId).some((c) => c.field === 'guestOrderAmended' && /Cidre 3 → 1/.test(c.to)));
  const view = (await call('GET', `/public/v1/guest/orders/${orderId}`)).body.data;
  assert.deepEqual([view.total, view.amendedLabel], [6, 'Modifiée à votre arrivée']);
});

withStay('rule 87: removing an article, then the whole order — an order left with no line is cancelled (cancelReason « sas »)', async ({ stayId, call }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }, { kind: 'option', id: JUICE, quantity: 1 }])).body.data.orderId;
  const first = await amend(call, orderId, { lines: [{ key: `opt:${JUICE}`, quantity: 0 }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(JSON.parse(orderRow(orderId).linesJson).map((l) => l.id), [CIDER]);
  assert.equal(stayRow(stayId).complementAmount, 12);
  const second = await amend(call, orderId, { removeOrder: true });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const row = orderRow(orderId);
  assert.deepEqual([row.status, row.cancelReason, row.total], ['cancelled', 'sas', 0]);
  assert.equal(stayRow(stayId).complementAmount, 0);
  assert.equal(second.body.ordersAtArrival, null, 'no order left: no step');
});

withStay('rule 87: a paid order is read-only — 409 ORDER_PAID_READ_ONLY; an order of a stay already arrived — 409 ORDER_NOT_EDITABLE; raising past the stock — 409 OUT_OF_STOCK', async ({ stayId, call, card }) => {
  const paid = await payCard(call, card, [{ kind: 'option', id: CIDER, quantity: 1 }]);
  const refusedPaid = await amend(call, paid, { removeOrder: true });
  assert.deepEqual([refusedPaid.status, refusedPaid.body.code, refusedPaid.body.error], [409, 'ORDER_PAID_READ_ONLY', 'Commande payée par carte : non modifiable ici.']);
  assert.equal(orderRow(paid).status, 'paid');
  const WINE = addOption({ id: 903, title: 'Vin', price: 9 });
  sell('option', WINE);
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 3 WHERE itemId = ?').run(WINE);
  const orderId = (await place(call, [{ kind: 'option', id: WINE, quantity: 2 }])).body.data.orderId;
  const tooMany = await amend(call, orderId, { lines: [{ key: `opt:${WINE}`, quantity: 4 }] });
  assert.deepEqual([tooMany.status, tooMany.body.code, tooMany.body.left], [409, 'OUT_OF_STOCK', 1]);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(stayId);
  const arrived = await amend(call, orderId, { removeOrder: true });
  assert.deepEqual([arrived.status, arrived.body.code, arrived.body.error], [409, 'ORDER_NOT_EDITABLE', 'Commande non modifiable.']);
  assert.equal(orderRow(orderId).status, 'confirmed');
  assert.equal(JSON.parse(orderRow(orderId).linesJson)[0].quantity, 2);
});

withStay('rule 87: a request of another shape, an unknown line or order — 400 INVALID_INPUT / 404', async ({ call }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 1 }])).body.data.orderId;
  for (const body of [{ lines: [{ key: 'opt:1', quantity: -1 }] }, { lines: 'x' }, { removeOrder: false }, { other: 1 }, { lines: [{ key: 'opt:999', quantity: 0 }] }]) {
    const res = await amend(call, orderId, body);
    assert.deepEqual([res.status, res.body.code], [400, 'INVALID_INPUT'], JSON.stringify(body));
  }
  assert.equal((await amend(call, 999999, { removeOrder: true })).status, 404);
  assert.equal(JSON.parse(orderRow(orderId).linesJson)[0].quantity, 1);
});

withStay('rule 87: the reception amends on the arrival day only — another day is 403, the admin is never limited', async ({ stayId, call, staff }) => {
  const orderId = (await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }])).body.data.orderId;
  staff.user = { roles: ['reception'] };
  const early = await amend(call, orderId, { lines: [{ key: `opt:${CIDER}`, quantity: 1 }] });
  assert.deepEqual([early.status, early.body.code], [403, 'FORBIDDEN'], 'the stay arrives in 5 days');
  assert.equal(JSON.parse(orderRow(orderId).linesJson)[0].quantity, 2);
  staff.user = { roles: ['admin'] };
  assert.equal((await amend(call, orderId, { lines: [{ key: `opt:${CIDER}`, quantity: 1 }] })).status, 200);
  staff.user = { roles: ['reception', 'admin'] };
  assert.equal((await amend(call, orderId, { removeOrder: true })).status, 200, 'a combined account is an admin');
});

withStay('rule 87: a bath session removed — the order\'s charge follows, the hold on the planning ends', async ({ stayId, call }) => {
  const day = isoPlus(6);
  const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: day, start: '20:00', end: '21:00' }, { date: day, start: '21:00', end: '22:00' }] }];
  const orderId = (await place(call, lines)).body.data.orderId;
  const before = stayRow(stayId).complementAmount;
  assert.ok(before > 0);
  const res = await amend(call, orderId, { removeSessions: [{ resourceId: BATH, date: day, start: '21:00' }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const kept = JSON.parse(orderRow(orderId).linesJson).find((l) => l.kind === 'resource');
  assert.deepEqual(kept.sessions.map((s) => s.start), ['20:00']);
  assert.ok(stayRow(stayId).complementAmount < before);
  assert.equal(JSON.parse(db.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = ?').get(stayId).sessions).length, 1);
}, { skip: !hasHourly });

withStay('specs/single-payment-at-check-in.md rule 19: the orders taken before the arrival are part of the arrival complement — no end-of-stay line, nothing else moved', async ({ stayId, call }) => {
  await place(call, [{ kind: 'option', id: CIDER, quantity: 2 }]);
  const row = stayRow(stayId);
  assert.deepEqual([row.complementAmount, row.endOfStayComplementAmount, row.depositAmount, row.balanceAmount], [12, 0, 0, 400]);
});

withStay('rule 73: a stay moved under its order keeps the order, flagged « Hors des dates du séjour » for the staff and « Horaire à revoir » for the guest', async ({ stayId, call }) => {
  const WOOD = addOption({ id: 904, title: 'Panier de bois', price: 15, category: 'Autres' });
  sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });
  const picker = (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: WOOD }] })).body.data;
  const deliverAt = picker.days.find((d) => d.available).times[0].at;
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: WOOD, quantity: 1 }], deliverAt, payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(isoPlus(20), isoPlus(24), stayId);
  const row = (await call('GET', '/api/guest-app/orders')).body.orders.find((o) => o.id === placed.body.data.orderId);
  assert.deepEqual([row.outsideStay, row.outsideStayLabel], [true, 'Hors des dates du séjour : à replanifier']);
  const guest = await call('GET', `/public/v1/guest/orders/${placed.body.data.orderId}`);
  if (guest.status === 200) assert.ok(guest.body.data.notices.includes('Horaire à revoir avec l’équipe'));
});

test('rule 75: the staff push names the day when the time is not today and says « à régler à l’arrivée »', () => {
  const labels = require('../orderLabels');
  const order = {
    payment: 'note', collectAt: 'arrival', fulfilment: 'delivery', deliverAt: '2099-11-13T17:00:00.000Z', lines: [{ kind: 'option', title: 'Cidre', quantity: 2 }],
  };
  const text = labels.pushText(order, { lodging: 'L’Estiva', firstName: 'Marie', now: new Date('2099-11-06T09:00:00.000Z') });
  assert.match(text, /^L’Estiva · Marie — 2 × Cidre pour ven\. 13 nov\. 18 h \(à régler à l’arrivée\)$/);
  assert.match(labels.pushText({ ...order, collectAt: 'departure' }, { lodging: 'L’Estiva', now: new Date('2099-11-13T08:00:00.000Z') }), /pour 18 h \(sur la note\)/);
});
