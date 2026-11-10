// specs/guest-app.md rule 56 (audit R36-PUB-L1) — every refusal of `/public/v1/guest/**` answers in the request's
// language: the `code` never moves, the `message` follows `?lang=` (else the guest's language), as the public API's own
// envelope does. The auditor's probes (`g5`): an order over the ceiling, a card order without a provider, an empty
// basket, a quantity over its maximum, an unknown order — in English. Stays dated around today (the core's window).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  addOption, openOrdering, seedStay, sell,
} = require('./guestOrderFixtures');
const { TEXTS } = require('../refusals');
const { createGuestLimiters } = require('../rateLimiters');
const { freshDb, startApi, enable } = require('./guestAppFixtures');

addOption({ id: 501, title: 'Champagne', priceType: 'per_stay', price: 300 });
sell('option', 501, { maxQuantity: 3 });

test('rule 56: every refusal has its words in French and in English', () => {
  assert.deepEqual(Object.keys(TEXTS.en).sort(), Object.keys(TEXTS.fr).sort());
  Object.entries(TEXTS.en).forEach(([key, entry]) => {
    const text = typeof entry === 'function' ? entry({ min: 2, max: 3, left: 2, title: 'X', amount: '€5' }) : entry;
    assert.equal(/[àâçéèêëîôûù]/i.test(text), false, `${key} reads French: ${text}`);
  });
});

test('rule 56: no guest route writes a refusal in its own words, outside the table', () => {
  const dir = path.join(__dirname, '..');
  const files = ['controllers', 'middleware'].flatMap((folder) => fs.readdirSync(path.join(dir, folder)).map((f) => path.join(dir, folder, f)));
  const offenders = files.filter((file) => /publicHttp\.fail\(/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.basename(f)), []);
});

test('rule 56: the auditor’s refused orders answer in English with ?lang=en, and in French without', async () => {
  const stay = seedStay({ propertyId: 1 });
  const ctx = await openOrdering(stay);
  try {
    const order = (body, lang = 'en') => ctx.call('POST', `/public/v1/guest/orders${lang ? `?lang=${lang}` : ''}`, body);
    const over = await order({ lines: [{ kind: 'option', id: 501, quantity: 2 }], payment: 'note' });
    assert.equal(over.body.error.code, 'ORDER_LIMIT');
    assert.equal(over.body.error.message, 'An order is at most €500.');
    const card = await order({ lines: [{ kind: 'option', id: 501, quantity: 1 }], payment: 'card' });
    assert.equal(card.body.error.code, 'CARD_UNAVAILABLE');
    assert.equal(card.body.error.message, 'Card payment is unavailable: add the order to your bill.');
    assert.equal((await order({ lines: [], payment: 'note' })).body.error.message, 'The basket is empty.');
    assert.equal((await order({ lines: [{ kind: 'option', id: 501, quantity: 4 }], payment: 'note' })).body.error.message, 'At most 3 for “Champagne”.');
    const unknown = await ctx.call('GET', '/public/v1/guest/orders/999999?lang=en');
    assert.deepEqual(unknown.body.error, { code: 'ORDER_NOT_FOUND', message: 'Order not found.' });
    assert.equal((await order({ lines: [], payment: 'note' }, null)).body.error.message, 'Le panier est vide.');
  } finally {
    await ctx.close();
  }
});

test('rule 56: the lookup, a dead session and the throttle answer in English too', async () => {
  const db = freshDb();
  const ctx = await startApi(db, { limiters: { lookup: createGuestLimiters().lookup } });
  enable(ctx.api, db);
  try {
    const answers = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      answers.push(await ctx.call('POST', '/public/v1/guest/sessions/lookup?lang=en', { lastName: 'x', reservationNumber: `n${i}` }));
    }
    assert.equal(answers[0].body.error.message, 'We could not find this stay. Check the name and the number.');
    assert.deepEqual(answers[5].body.error, { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, try again later.' });
    const dead = await ctx.call('GET', '/public/v1/guest/me?lang=en', null, { cookie: 'gf_guest=gone' });
    assert.deepEqual(dead.body.error, { code: 'SESSION_EXPIRED', message: 'Your session has expired.' });
  } finally {
    await ctx.close();
  }
});
