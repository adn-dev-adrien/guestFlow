// specs/guest-app.md rule 57 (audit R36-PUB-L2) — the card orders of a stay are limited per STAY, whatever its sessions:
// each one mints a payment link at the provider, abandoning frees the next one at once, and a new session costs only a
// stay-link exchange — one holder of the link minted about 300 links an hour. Six an hour per stay; a refused card
// order spends nothing; the note stays open. Stays dated around today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, openOrdering, seedStay, sell,
} = require('./guestOrderFixtures');
const { createGuestLimiters } = require('../rateLimiters');

addOption({ id: 601, title: 'Cidre', priceType: 'per_stay', price: 6 });
sell('option', 601);

const CARD = { lines: [{ kind: 'option', id: 601, quantity: 1 }], payment: 'card' };

test('rule 57: the seventh card order of a stay in an hour is refused, across sessions; refused ones and the note are free', async () => {
  const card = fakeProvider();
  const stay = seedStay({ propertyId: 1 });
  const ctx = await openOrdering(stay, { card, limiters: { cardOrder: createGuestLimiters().cardOrder } });
  try {
    const token = require('../models/stayLinksModel')(db).ensure(stay, new Date()).token;
    const second = (await fetch(`${ctx.base}/public/v1/guest/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stayToken: token }),
    })).headers.get('set-cookie').split(';')[0];
    const callAs = async (cookie, method, url, body) => {
      const res = await fetch(`${ctx.base}${url}`, {
        method, headers: { 'content-type': 'application/json', cookie }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    };
    for (let i = 0; i < 6; i += 1) {
      const useSecond = i % 2 === 1;
      // eslint-disable-next-line no-await-in-loop
      const placed = useSecond ? await callAs(second, 'POST', '/public/v1/guest/orders', CARD) : await ctx.call('POST', '/public/v1/guest/orders', CARD);
      assert.equal(placed.status, 200, JSON.stringify(placed.body));
      if (i < 5) {
        // eslint-disable-next-line no-await-in-loop
        const pending = await ctx.call('POST', '/public/v1/guest/orders', CARD);
        assert.equal(pending.body.error.code, 'CARD_ORDER_PENDING', 'refused: spends nothing');
      }
      // eslint-disable-next-line no-await-in-loop
      await ctx.call('POST', `/public/v1/guest/orders/${placed.body.data.orderId}/abandon`, {});
    }
    const seventh = await callAs(second, 'POST', '/public/v1/guest/orders?lang=en', CARD);
    assert.equal(seventh.status, 429);
    assert.deepEqual(seventh.body.error, { code: 'TOO_MANY_REQUESTS', message: 'Too many card payments for this stay in an hour: add the order to your bill.' });
    assert.equal(card.created.length, 6, 'six links minted, no more');
    const note = await ctx.call('POST', '/public/v1/guest/orders', { ...CARD, payment: 'note' });
    assert.equal(note.status, 200, 'the note stays open');
  } finally {
    await ctx.close();
  }
});
