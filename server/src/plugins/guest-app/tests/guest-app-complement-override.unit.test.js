// specs/guest-app.md rule 94 (fourth pass, 2026-11-10) — a stay whose arrival complement carries an operator's adjustment
// (`complementAmountOverride`) pins that bucket whatever the lines say, so an order could never grow it: the shop, the order
// routes, the J-7 / J-2 e-mail flags and the commit all read « unavailable » together, on a platform stay and on a direct one,
// an override of 0 included.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = fx;
const commit = require('../../../utils/midStayOrderCommit');

const CIDER = addOption({ id: 961, title: 'Cidre', price: 6 });
sell('option', CIDER);

function withOverride(name, stay, override, fn) {
  test(name, async () => {
    const stayId = seedStay({ start: 5, end: 9, checkedIn: 0, ...stay });
    db.prepare('UPDATE reservations SET complementAmountOverride = ? WHERE id = ?').run(override, stayId);
    const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

for (const [label, stay, override] of [
  ['a platform stay, override 70', { platform: 'booking', balancePaid: 0 }, 70],
  ['a direct stay, override 0', {}, 0],
]) {
  withOverride(`rule 94: ${label} — the shop, the quote, the order, the e-mail flags and the commit all refuse together`, stay, override, async ({ stayId, call, api }) => {
    assert.equal(commit.orderCollection(stayId), 'unavailable');
    const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
    assert.deepEqual([shop.open, shop.orderCollection], [false, 'unavailable']);
    assert.deepEqual(api.emailFacts(stayId), { shop: false, bath: false });
    const lines = [{ kind: 'option', id: CIDER, quantity: 1 }];
    const quote = await call('POST', '/public/v1/guest/orders/quote', { lines });
    assert.deepEqual([quote.status, quote.body.error.code], [409, 'ORDERS_OPEN_ON_ARRIVAL']);
    const order = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.equal(order.status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 0);
    assert.equal(commit.priceOrder(stayId, lines).body.code, 'ORDER_OFF_ARRIVAL_COMPLEMENT');
  });
}

withOverride('rule 94: the adjustment removed, the same stay orders again — the judge reads the column, nothing else', {}, null, async ({ stayId, call }) => {
  assert.equal(commit.orderCollection(stayId), 'arrival');
  const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
  assert.deepEqual([shop.open, shop.orderCollection], [true, 'arrival']);
});
