// specs/guest-app.md rules 25 and 55 (audit R36b N4) — a priced article the engine adds nothing for is refused
// ITEM_UNAVAILABLE, except inside the stay's free units or minutes: those confirm at 0 € and the next unit is billed.
// The exemption was pinned by no test (a mutant removing it refused every order inside its free units). Stays dated
// around today: the core reads its window on today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, hasHourly, isoPlus, openOrdering, optionLine, seedStay, sell,
} = require('./guestOrderFixtures');

const ORDERS = '/public/v1/guest/orders';
const QUOTE = '/public/v1/guest/orders/quote';

const HONEY = addOption({ id: 601, title: 'Pot de miel', priceType: 'per_stay', price: 10 });
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 10, 1)').run(HONEY);
sell('option', HONEY);
const BATH = addBath({ id: 66, freeMinutes: { 1: 60 } });
sell('resource', BATH);

async function withOrdering(reservationId, fn) {
  const ctx = await openOrdering(reservationId);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

const honey = (quantity) => ({ lines: [{ kind: 'option', id: HONEY, quantity }] });

test('rules 25, 55: the free unit of a priced option is confirmed at 0 €, the next unit is billed', async () => {
  const stay = seedStay({ propertyId: 1 });
  await withOrdering(stay, async ({ call }) => {
    const quote = await call('POST', QUOTE, honey(1));
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.data.total, 0);
    const free = await call('POST', ORDERS, { ...honey(1), payment: 'none' });
    assert.equal(free.status, 200, JSON.stringify(free.body));
    assert.equal(optionLine(stay, HONEY).totalPrice, 0, 'the fiche carries the free unit at 0 €');
    const next = await call('POST', ORDERS, { ...honey(1), payment: 'note' });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    // Rule 85: the second order is a line of its own; the article's free unit was taken by the first, so this one is billed.
    const lines = db.prepare('SELECT billedUnits, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(stay, HONEY);
    assert.deepEqual(lines.map((l) => [l.billedUnits, l.totalPrice]), [[1, 0], [1, 10]], 'the second unit is billed, on its own line');
  });
});

test('rules 25, 55: the free hour of the bath is confirmed at 0 €, the next hour is billed', { skip: !hasHourly }, async () => {
  const stay = seedStay({ propertyId: 1 });
  const date = isoPlus(1);
  await withOrdering(stay, async ({ call }) => {
    const free = await call('POST', ORDERS, { lines: [{ kind: 'resource', id: BATH, sessions: [{ date, start: '10:00', end: '11:00' }] }], payment: 'none' });
    assert.equal(free.status, 200, JSON.stringify(free.body));
    const quote = await call('POST', QUOTE, { lines: [{ kind: 'resource', id: BATH, sessions: [{ date, start: '14:00', end: '15:00' }] }] });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.data.total, 30, 'the next hour is billed');
  });
});
