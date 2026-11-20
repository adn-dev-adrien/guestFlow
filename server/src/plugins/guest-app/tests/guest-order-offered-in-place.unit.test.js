// specs/guest-app.md rule 107 and specs/pricing-components.md rules 13, 26, 92 (owner answers 2026-11-13) — an article the stay offers and an order asks again
// is billed as a line of its own; the offered units of a DRINK are already in the fridge at the arrival, so the first app order of one is billed — the
// offered allowance is consumed there, never by an app order. An article that is not in place keeps today's rule (rule 25): its free units cover a first order.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, optionLine, seedStay, sell,
} = fx;

const DRINK = addOption({ id: 3401, title: 'Cidre offert', price: 6, category: 'Boissons' });
const SNACK = addOption({ id: 3402, title: 'Planche offerte', price: 9, category: 'Autres' });
const WELCOME = addOption({ id: 3403, title: 'Bouteille de bienvenue', price: 15, category: 'Boissons' });
[DRINK, SNACK].forEach((id) => db.prepare('INSERT OR REPLACE INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, ?, 2)').run(id, id === DRINK ? 6 : 9));
sell('option', DRINK);
sell('option', SNACK);
sell('option', WELCOME);

async function withStay(fn) {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try { await fn({ stayId, ...ctx }); } finally { await ctx.close(); }
}

const order = (call, id, quantity) => call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id, quantity }], payment: 'note' });
const quoteOf = (call, id, quantity) => call('POST', '/public/v1/guest/orders/quote', { lines: [{ kind: 'option', id, quantity }] });

test('rule 107 — a drink flagged « offert déjà en place » is billed from the first app order, the units the stay was granted untouched', async () => {
  db.prepare('UPDATE guest_app_items SET offeredInPlace = 1 WHERE kind = ? AND itemId = ?').run('option', DRINK);
  await withStay(async ({ stayId, call }) => {
    const quote = await quoteOf(call, DRINK, 1);
    assert.equal(quote.body.data.total, 6, 'billed at the quote');
    const placed = await order(call, DRINK, 1);
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(placed.body.data.orderId).total, 6);
    assert.deepEqual(JSON.parse(optionLine(stayId, DRINK).allowanceUsed), { freeUnits: 0, amount: 0 }, 'it stores that it consumed none');
    const again = await order(call, DRINK, 2);
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(again.body.data.orderId).total, 12, 'every later order is billed too');
    const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
    const item = shop.categories.flatMap((c) => c.items).find((i) => i.id === DRINK);
    assert.equal(item.freeLeftLabel, undefined, 'the shop promises no free unit the fridge already took');
  });
});

test('rule 25 — an article that is not in place keeps its free units: the first order is covered, the next is billed', async () => {
  await withStay(async ({ call }) => {
    const first = await order(call, SNACK, 2);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(first.body.data.orderId).total, 0, 'the 2 granted units cover it');
    const next = await order(call, SNACK, 1);
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(next.body.data.orderId).total, 9);
  });
});

test('rules 13, 107 — an article the stay already carries offered is ordered again: a line of its own, billed at the catalogue', async () => {
  db.prepare('INSERT OR REPLACE INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)').run(WELCOME);
  await withStay(async ({ stayId, call }) => {
    db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, offered, unitPrice, totalPrice) VALUES (?, ?, 1, 1, 1, 15, 0)').run(stayId, WELCOME);
    const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
    const item = shop.categories.flatMap((c) => c.items).find((i) => i.id === WELCOME);
    assert.equal(item.unavailableReason, undefined, 'orderable');
    const placed = await order(call, WELCOME, 1);
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    assert.equal(db.prepare('SELECT total FROM guest_orders WHERE id = ?').get(placed.body.data.orderId).total, 15);
    const lines = db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(stayId, WELCOME);
    assert.deepEqual(lines.map((l) => [l.offered, l.totalPrice]), [[1, 0], [0, 15]], 'the offered line is untouched, the order is its own line');
  });
});
