// specs/guest-app.md rule 61 (audit R37-C-L2) — the quote's line labels and every refusal naming an article (its
// quantity cap, the persons left of rule 55, a line the engine adds nothing for) read the article's title in the
// request's language, as the shop shows it; the order stores the French catalogue title (stay-link notes). Stays
// dated around today: the core reads its window on today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = require('./guestOrderFixtures');

const ctl = require('../../../controllers/reservationsController');
const model = require('../../../models/reservationsModel');
const { toUpdateBody } = require('../../../utils/reservationUpdateBody');

const QUOTE = '/public/v1/guest/orders/quote';
const ORDERS = '/public/v1/guest/orders';

function translate(entryKey, text) {
  db.prepare("INSERT INTO translation_entries (entryKey, kind, sourceText, seenAt) VALUES (?, 'x', 'x', '2099-01-01')").run(entryKey);
  db.prepare("INSERT INTO translation_values (entryKey, lang, text, sourceAtTime) VALUES (?, 'en', ?, 'x')").run(entryKey, text);
}

const CIDER = addOption({ id: 631, title: 'Cidre fermier', priceType: 'per_stay', price: 6 });
const BOARD = addOption({ id: 632, title: 'Planche de charcuterie', priceType: 'per_person', price: 10 });
const WOOD = addOption({ id: 633, title: 'Fagot de chêne', priceType: 'per_stay', price: 12 });
sell('option', CIDER, { maxQuantity: 3 });
sell('option', BOARD, { maxQuantity: 20 });
sell('option', WOOD, { maxQuantity: 5 });
translate(`option:${CIDER}:title`, 'Farm cider');
translate(`option:${BOARD}:title`, 'Charcuterie board');
translate(`option:${WOOD}:title`, 'Oak firewood');

async function withOrdering(reservationId, fn) {
  const ctx = await openOrdering(reservationId);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

const line = (id, quantity) => ({ lines: [{ kind: 'option', id, quantity }] });

test('rule 61: the English quote labels its lines with the English title; the order stores the French one', async () => {
  const stay = seedStay({ propertyId: 1 });
  await withOrdering(stay, async ({ call }) => {
    const quote = await call('POST', `${QUOTE}?lang=en`, line(CIDER, 2));
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.data.lines[0].title, 'Farm cider');
    assert.equal(quote.body.data.lines[0].label, '2 × Farm cider');
    const french = await call('POST', `${QUOTE}?lang=fr`, line(CIDER, 2));
    assert.equal(french.body.data.lines[0].label, '2 × Cidre fermier');
    const order = await call('POST', `${ORDERS}?lang=en`, { ...line(CIDER, 2), payment: 'note' });
    assert.equal(order.status, 200, JSON.stringify(order.body));
  });
  const stored = JSON.parse(db.prepare('SELECT linesJson FROM guest_orders WHERE reservationId = ?').get(stay).linesJson);
  assert.equal(stored[0].title, 'Cidre fermier', 'the stored line keeps the French catalogue title');
});

test('rule 61: the quantity cap names the article in English', async () => {
  const stay = seedStay({ propertyId: 1 });
  await withOrdering(stay, async ({ call }) => {
    const over = await call('POST', `${QUOTE}?lang=en`, line(CIDER, 4));
    assert.equal(over.status, 400, JSON.stringify(over.body));
    assert.equal(over.body.error.message, 'At most 3 for “Farm cider”.');
    const french = await call('POST', `${QUOTE}?lang=fr`, line(CIDER, 4));
    assert.equal(french.body.error.message, '3 au plus pour « Cidre fermier ».');
  });
});

test('rule 61: the persons left of rule 55 name the article in English', async () => {
  const stay = seedStay({ propertyId: 1, adults: 2 });
  await withOrdering(stay, async ({ call }) => {
    assert.equal((await call('POST', ORDERS, { ...line(BOARD, 5), payment: 'note' })).status, 200);
    const over = await call('POST', `${QUOTE}?lang=en`, line(BOARD, 20));
    assert.equal(over.status, 409, JSON.stringify(over.body));
    assert.equal(over.body.error.code, 'PERSONS_EXCEEDED');
    assert.match(over.body.error.message, /“Charcuterie board”/);
    assert.doesNotMatch(over.body.error.message, /Planche/);
  });
});

test('specs/pricing-components.md rule 85 (was guest-app rule 61): an article the fiche offers is quoted as a new billed line, in English too', async () => {
  const stay = seedStay({ propertyId: 1 });
  const body = toUpdateBody(model.getByIdWithDetails(stay), new Set());
  const saved = ctl.performUpdate(stay, { ...body, options: [...(body.options || []), { optionId: WOOD, quantity: 1 }], offeredOptionIds: [WOOD] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  await withOrdering(stay, async ({ call }) => {
    const quote = await call('POST', `${QUOTE}?lang=en`, line(WOOD, 1));
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.ok(quote.body.data.total > 0);
  });
});
