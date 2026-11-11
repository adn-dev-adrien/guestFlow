// specs/guest-app.md rules 55 and 60 (audit R37-M-L1) — the free units or minutes left explain a 0 € line only up
// to what they cover: a line the fiche offers, asked beyond the free units left, is refused ITEM_UNAVAILABLE on the
// quote and the order, nothing written; inside them it still confirms at 0 €. Stays dated around today: the core
// reads its window on today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, hasHourly, isoPlus, openOrdering, optionLine, seedStay, sell,
} = require('./guestOrderFixtures');

const ctl = require('../../../controllers/reservationsController');
const model = require('../../../models/reservationsModel');
const { toUpdateBody } = require('../../../utils/reservationUpdateBody');

const ORDERS = '/public/v1/guest/orders';
const QUOTE = '/public/v1/guest/orders/quote';

const WOOD = addOption({ id: 611, title: 'Fagot de bois', priceType: 'per_stay', price: 10 });
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 10, 2)').run(WOOD);
sell('option', WOOD);
const BATH = addBath({ id: 67, freeMinutes: { 1: 120 } });
sell('resource', BATH);

/** A stay whose fiche offers one unit of the wood: 1 of the 2 free units used, the line priced 0 €. */
function offeredStay() {
  const stay = seedStay({ propertyId: 1 });
  const body = toUpdateBody(model.getByIdWithDetails(stay), new Set());
  const saved = ctl.performUpdate(stay, { ...body, options: [...(body.options || []), { optionId: WOOD, quantity: 1 }], offeredOptionIds: [WOOD] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(Number(optionLine(stay, WOOD).totalPrice), 0);
  return stay;
}

async function withOrdering(reservationId, fn) {
  const ctx = await openOrdering(reservationId);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

const wood = (quantity) => ({ lines: [{ kind: 'option', id: WOOD, quantity }] });

test('rule 60: an offered line asked beyond the free units left is refused ITEM_UNAVAILABLE, nothing written', async () => {
  const stay = offeredStay();
  const before = optionLine(stay, WOOD);
  await withOrdering(stay, async ({ call }) => {
    const quote = await call('POST', QUOTE, wood(4));
    assert.equal(quote.status, 409, JSON.stringify(quote.body));
    assert.equal(quote.body.error.code, 'ITEM_UNAVAILABLE');
    const order = await call('POST', ORDERS, { ...wood(4), payment: 'none' });
    assert.equal(order.status, 409, JSON.stringify(order.body));
    assert.equal(order.body.error.code, 'ITEM_UNAVAILABLE');
    const note = await call('POST', ORDERS, { ...wood(2), payment: 'note' });
    assert.equal(note.status, 409, 'two units at 0 € with one free unit left: refused too');
  });
  const after = optionLine(stay, WOOD);
  assert.equal(after.quantity, before.quantity);
  assert.equal(Number(after.totalPrice), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stay).n, 0);
});

test('rule 60: inside the free units left an offered line still confirms at 0 €', async () => {
  const stay = offeredStay();
  await withOrdering(stay, async ({ call }) => {
    const order = await call('POST', ORDERS, { ...wood(1), payment: 'none' });
    assert.equal(order.status, 200, JSON.stringify(order.body));
  });
  assert.equal(Number(optionLine(stay, WOOD).totalPrice), 0);
});

test('rule 60: an offered bath line asked beyond the free minutes left is refused, inside them it is 0 €', { skip: !hasHourly }, async () => {
  const stay = seedStay({ propertyId: 1 });
  // The fiche offers one hour of the bath: 60 of the 120 free minutes used, the line at 0 €.
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, totalPrice, offered, sessions) VALUES (?, ?, 1, 0, 1, ?)')
    .run(stay, BATH, JSON.stringify([{ date: isoPlus(2), start: '08:00', end: '09:00' }]));
  const date = isoPlus(1);
  const bath = (end) => ({ lines: [{ kind: 'resource', id: BATH, sessions: [{ date, start: '10:00', end }] }] });
  await withOrdering(stay, async ({ call }) => {
    const inside = await call('POST', QUOTE, bath('11:00'));
    assert.equal(inside.status, 200, JSON.stringify(inside.body));
    assert.equal(inside.body.data.total, 0);
    const beyond = await call('POST', QUOTE, bath('13:00'));
    assert.equal(beyond.status, 409, JSON.stringify(beyond.body));
    assert.equal(beyond.body.error.code, 'ITEM_UNAVAILABLE');
  });
});
