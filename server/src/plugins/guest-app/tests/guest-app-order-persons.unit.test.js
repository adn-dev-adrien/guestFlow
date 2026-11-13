// specs/guest-app.md rule 55 (audit R36-M-H1) — persons ordered beyond what the stay can still be served are refused
// before anything is priced: the engine serves a per-person line at most max(party, the lodging's capacity) persons, so
// the persons above it were delivered and never billed (a repeat order confirmed at 0 €). The whole class: a per-person
// option on the note, by card, at 0 € and in pickup mode, the breakfast line's persons, a pending card order's persons,
// and a priced article the engine adds nothing for. Stays dated around today: the core reads its window on today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, fakeProvider, isoPlus, openOrdering, optionLine, seedStay, sell,
} = require('./guestOrderFixtures');
const { memorySettings } = require('..');

const QUOTE = '/public/v1/guest/orders/quote';
const ORDERS = '/public/v1/guest/orders';
const perPerson = (id, quantity) => ({ lines: [{ kind: 'option', id, quantity }] });
const ordersOf = (reservationId) => db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(reservationId).n;

addOption({ id: 401, title: 'Couverts pique-nique', priceType: 'per_person', price: 4 });
addOption({ id: 402, title: 'Planche apéritive', priceType: 'per_person', price: 10 });
addOption({ id: 403, title: 'Verre de bienvenue', priceType: 'per_person', price: 0 });
addOption({ id: 404, title: 'Fagot de bois', priceType: 'per_stay', price: 12 });
addOption({
  id: 405, title: 'Petit-déjeuner', priceType: 'per_person_per_night', price: 9, autoOptionType: 'breakfast', breakfastTime: '23:59',
});
[401, 402, 403, 404, 405].forEach((id) => sell('option', id, { maxQuantity: 20 }));

async function withOrdering(reservationId, fn, options = {}) {
  const ctx = await openOrdering(reservationId, options);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

test('rule 55: a full party orders a per-person item a second time — refused, never confirmed at 0 € (the auditor’s route probe)', async () => {
  const stay = seedStay({ propertyId: 2, adults: 6 });
  await withOrdering(stay, async ({ call }) => {
    const first = await call('POST', ORDERS, { ...perPerson(401, 6), payment: 'note' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const quote = await call('POST', QUOTE, perPerson(401, 6));
    assert.equal(quote.status, 409);
    assert.equal(quote.body.error.code, 'PERSONS_EXCEEDED');
    assert.equal(quote.body.error.message, '« Couverts pique-nique » sert déjà toutes les personnes du séjour.');
    const again = await call('POST', ORDERS, { ...perPerson(401, 6), payment: 'note' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'PERSONS_EXCEEDED');
    assert.equal(ordersOf(stay), 1, 'no second order');
    assert.equal(optionLine(stay, 401).billedUnits, 6);
  }, { propertyId: 2 });
});

test('rule 55: beyond the persons left, the order says how many are left; up to them it is billed whole (pickup mode too)', async () => {
  const stay = seedStay({ propertyId: 1, adults: 2 });
  const settings = memorySettings({ fulfilment: 'pickup', pickupPlace: 'Accueil' });
  await withOrdering(stay, async ({ call }) => {
    assert.equal((await call('POST', ORDERS, { ...perPerson(402, 5), payment: 'note' })).status, 200);
    const over = await call('POST', ORDERS, { ...perPerson(402, 5), payment: 'note' });
    assert.equal(over.status, 409);
    assert.equal(over.body.error.message, '3 personnes au plus pour « Planche apéritive ».');
    const english = await call('POST', `${QUOTE}?lang=en`, perPerson(402, 5));
    assert.equal(english.body.error.message, 'At most 3 people for “Planche apéritive”.');
    const rest = await call('POST', QUOTE, perPerson(402, 3));
    assert.equal(rest.status, 200);
    assert.equal(rest.body.data.total, 30);
    assert.equal((await call('POST', ORDERS, { ...perPerson(402, 3), payment: 'note' })).status, 200);
    // Rule 85: each order is a line of its own (5 and 3 persons, billed whole).
    const lines = db.prepare('SELECT cardPersons, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 402 ORDER BY lineId').all(stay);
    assert.deepEqual(lines.map((l) => [l.cardPersons, l.totalPrice]), [[5, 50], [3, 30]]);
  }, { settingsStore: () => settings });
});

test('rule 55: a 0 € per-person item is refused beyond the persons too: it would be planned for fewer than ordered', async () => {
  const stay = seedStay({ propertyId: 2, adults: 6 });
  await withOrdering(stay, async ({ call }) => {
    const first = await call('POST', ORDERS, { ...perPerson(403, 6), payment: 'none' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const again = await call('POST', ORDERS, { ...perPerson(403, 2), payment: 'none' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'PERSONS_EXCEEDED');
  }, { propertyId: 2 });
});

test('rule 55: the persons of a card order awaiting its payment are taken; a card order beyond the persons mints no link', async () => {
  const card = fakeProvider();
  const stay = seedStay({ propertyId: 1, adults: 2 });
  await withOrdering(stay, async ({ call }) => {
    const pending = await call('POST', ORDERS, { ...perPerson(402, 6), payment: 'card' });
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    assert.equal(card.created.length, 1);
    const note = await call('POST', ORDERS, { ...perPerson(402, 3), payment: 'note' });
    assert.equal(note.status, 409);
    assert.equal(note.body.error.code, 'CARD_ORDER_PENDING', 'the persons the pending order holds are kept for it (pricing-components rule 26)');
    assert.equal(optionLine(stay, 402), undefined, 'nothing on the fiche');
  }, { card });
  const other = seedStay({ propertyId: 1, adults: 2 });
  await withOrdering(other, async ({ call }) => {
    const over = await call('POST', ORDERS, { ...perPerson(402, 9), payment: 'card' });
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, 'PERSONS_EXCEEDED');
    assert.equal(card.created.length, 1, 'no link minted');
  }, { card });
});

test('rule 55: a breakfast asking more persons than its line already serves is refused, not billed for the line’s', async () => {
  const stay = seedStay({ propertyId: 1, adults: 3 });
  await withOrdering(stay, async ({ call }) => {
    const breakfast = (mornings, persons) => ({ lines: [{ kind: 'breakfast', id: 405, mornings, time: '08:00', persons }] });
    const first = await call('POST', ORDERS, { ...breakfast([isoPlus(1)], 2), payment: 'note' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const more = await call('POST', ORDERS, { ...breakfast([isoPlus(2)], 3), payment: 'note' });
    assert.equal(more.status, 409);
    assert.equal(more.body.error.message, 'Le petit-déjeuner du séjour est prévu pour 2 personnes.');
    assert.equal((await call('POST', ORDERS, { ...breakfast([isoPlus(2)], 2), payment: 'note' })).status, 200);
  });
});

test('specs/pricing-components.md rule 85 (was guest-app rule 55): an article the fiche offers is ordered as a line of its own — billed, never confirmed at 0 €', async () => {
  const stay = seedStay({ propertyId: 1 });
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, 404, 1, 12, 1, 'per_stay', 0, 1)`).run(stay);
  await withOrdering(stay, async ({ call }) => {
    const res = await call('POST', ORDERS, { lines: [{ kind: 'option', id: 404, quantity: 1 }], payment: 'note' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const lines = db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 404 ORDER BY lineId').all(stay);
    assert.deepEqual(lines.map((l) => [l.offered, l.totalPrice]), [[1, 0], [0, 12]]);
  });
});
