// specs/guest-app.md rules 23, 24, 25, 27, 27bis, 29, 30, 32, 37, 41 — `POST /public/v1/guest/orders/quote` and the
// re-checks of `POST /orders` through the real routes: the quote is the fiche's own engine and writes nothing, the
// sessions of one order are judged against each other and the planning, the breakfast's mornings and hour, the
// delivery time of the staff-prepared items, and the input refused before anything reads it.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, endOfStayDetail, hasHourly, isoPlus, openOrdering, optionLine, seedStay, sell,
} = fx;
const { sellabilityOf } = require('../sellable');
const controller = require('../../../controllers/reservationsController');
const reservationsModel = require('../../../models/reservationsModel');
const { toUpdateBody } = require('../../../utils/reservationUpdateBody');

const CIDER = addOption({ id: 501, title: 'Cidre', price: 6.5 });
const WOOD = addOption({ id: 502, title: 'Panier de bois', price: 15, category: 'Autres' });
const UNSOLD = addOption({ id: 503, title: 'Champagne', price: 60 });
const BATH = addBath({ id: 56, freeMinutes: { 1: 60 } });
sell('option', CIDER, { maxQuantity: 6 });
sell('option', WOOD, { needsStaff: 1, leadMinutes: 30 });
sell('resource', BATH);
const BREAKFAST = db.prepare("SELECT id FROM options WHERE autoOptionType = 'breakfast'").get().id;
db.prepare('UPDATE options SET price = 12 WHERE id = ?').run(BREAKFAST);
[1, 2].forEach((p) => db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)').run(p, BREAKFAST));
sell('option', BREAKFAST);

const TOMORROW = isoPlus(1);
const slot = (start, end, date = TOMORROW) => ({ date, start, end });

function withQuote(name, fn, { skip = false, stay = {}, ...options } = {}) {
  test(name, { skip }, async () => {
    const stayId = seedStay(stay);
    const ctx = await openOrdering(stayId, options);
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const quote = (call, lines, extra = {}) => call('POST', '/public/v1/guest/orders/quote', { lines, ...extra });
const endOfStay = (id) => Number(db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = ?').get(id).endOfStayComplementAmount || 0);

withQuote('rules 24, 32: the quote is the fiche’s own engine — the same addition made by the operator raises the end-of-stay complement by exactly its total', async ({ stayId, call }) => {
  const res = await quote(call, [{ kind: 'option', id: CIDER, quantity: 3 }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.total, 19.5);
  assert.equal(res.body.data.totalLabel, '19,50 €');
  assert.deepEqual(res.body.data.lines.map((l) => [l.label, l.unitPrice, l.total]), [['3 × Cidre', 6.5, 19.5]]);
  assert.equal(optionLine(stayId, CIDER), undefined, 'a quote writes nothing');
  // The operator's save of the same line, on the same fiche.
  controller.performUpdate(stayId, toUpdateBody(reservationsModel.getByIdWithDetails(stayId)));
  const before = endOfStay(stayId);
  const body = toUpdateBody(reservationsModel.getByIdWithDetails(stayId));
  body.options.push({ optionId: CIDER, quantity: 3 });
  assert.equal(controller.performUpdate(stayId, body).status, 200);
  assert.equal(Math.round((endOfStay(stayId) - before) * 100) / 100, res.body.data.total);
});

withQuote('rule 23: an item the lodging does not sell is quoted unavailable, at 0 €, and the order is refused', async ({ call }) => {
  const res = await quote(call, [{ kind: 'option', id: UNSOLD, quantity: 1 }, { kind: 'option', id: CIDER, quantity: 1 }]);
  assert.deepEqual([res.body.data.lines[0].unavailable, res.body.data.lines[0].unavailableReason, res.body.data.lines[0].total], [true, 'Plus disponible', 0]);
  assert.equal(res.body.data.total, 6.5);
  const order = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: UNSOLD, quantity: 1 }], payment: 'note' });
  assert.equal(order.status, 409);
  assert.equal(order.body.error.code, 'ITEM_UNAVAILABLE');
});

test('rule 23: an option of the planning other than the breakfast cannot be flagged — it is sold by moments, not quantities', () => {
  assert.equal(sellabilityOf('option', { priceType: 'per_stay', showsPlanningCard: 1, displayToClient: 1 }).ok, false);
  assert.equal(sellabilityOf('option', { priceType: 'per_person_per_night', showsPlanningCard: 1, autoOptionType: 'breakfast', displayToClient: 1 }).ok, true);
});

withQuote('rule 25: the bath’s free hour is the engine’s — the first hour 0 €, the second at its price', async ({ call }) => {
  const one = await quote(call, [{ kind: 'resource', id: BATH, sessions: [slot('11:00', '12:00')] }]);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.total, 0);
  const two = await quote(call, [{ kind: 'resource', id: BATH, sessions: [slot('11:00', '12:00'), slot('14:00', '15:00')] }]);
  assert.equal(two.body.data.total, 30);
  assert.equal(two.body.data.lines[0].sessions.length, 2);
}, { skip: !hasHourly });

withQuote('rule 29: the sessions of one order occupy the bath for each other — the overlapping one comes back unavailable, the rest is priced', async ({ call }) => {
  const res = await quote(call, [{ kind: 'resource', id: BATH, sessions: [slot('11:00', '12:00'), slot('11:00', '12:00', TOMORROW), slot('16:00', '17:00')] }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const states = res.body.data.lines[0].sessions.map((s) => s.reason || 'ok');
  assert.deepEqual(states, ['ok', 'taken', 'ok']);
  assert.equal(res.body.data.lines[0].sessions[1].reasonLabel, 'Ce créneau vient d’être pris');
  assert.equal(res.body.data.total, 30, 'two hours, the first one offered');
}, { skip: !hasHourly });

withQuote('rule 30: a slot the operator places between the quote and the order is refused — 409 SLOT_TAKEN, nothing written', async ({ stayId, call }) => {
  const lines = [{ kind: 'resource', id: BATH, sessions: [slot('18:00', '19:00')] }];
  assert.equal((await quote(call, lines)).body.data.lines[0].unavailable, undefined);
  const other = seedStay({ propertyId: 2 });
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, sessions) VALUES (?, ?, 1, 'per_hour', ?)")
    .run(other, BATH, JSON.stringify([slot('18:00', '19:00')]));
  const res = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'SLOT_TAKEN');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(stayId).n, 0);
}, { skip: !hasHourly });

withQuote('rule 30: an order of bath hours writes the planning — the session on the stay’s line, its hours sold', async ({ stayId, call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [slot('11:00', '12:00'), slot('14:00', '15:00')] }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const line = db.prepare('SELECT quantity, sessions FROM reservation_resources WHERE reservationId = ? AND resourceId = ?').get(stayId, BATH);
  assert.equal(line.quantity, 2);
  assert.deepEqual(JSON.parse(line.sessions).map((s) => s.start), ['11:00', '14:00']);
  assert.equal(endOfStayDetail(stayId).filter((l) => l.key === `res:${BATH}`).reduce((s, l) => s + l.amount, 0), 30);
}, { skip: !hasHourly });

withQuote('rule 27bis: the breakfast is priced per person and per morning by the engine; a morning out of the stay comes back unavailable', async ({ stayId, call }) => {
  const lines = [{ kind: 'breakfast', id: BREAKFAST, mornings: [isoPlus(1), isoPlus(2), isoPlus(6)], time: '09:00', persons: 2 }];
  const res = await quote(call, lines);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [line] = res.body.data.lines;
  assert.deepEqual(line.mornings, [isoPlus(1), isoPlus(2)]);
  assert.deepEqual(line.unavailableMornings.map((m) => m.date), [isoPlus(6)]);
  assert.equal(line.total, 48);
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' })).body.error.code, 'ITEM_UNAVAILABLE');
  lines[0].mornings = [isoPlus(1), isoPlus(2)];
  const order = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  const stored = optionLine(stayId, BREAKFAST);
  assert.deepEqual(JSON.parse(stored.cardOccurrences).map((o) => [o.date, o.time]), [[isoPlus(1), '09:00'], [isoPlus(2), '09:00']]);
});

withQuote('rule 27bis: the people served by the breakfast cannot outnumber the stay — 400', async ({ call }) => {
  const res = await quote(call, [{ kind: 'breakfast', id: BREAKFAST, mornings: [isoPlus(1)], time: '09:00', persons: 5 }]);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_INPUT');
});

withQuote('rule 41: a staff-prepared item needs a delivery time the service offers — none → 400, one it does not offer → 409', async ({ call }) => {
  const lines = [{ kind: 'option', id: WOOD, quantity: 1 }];
  const res = await quote(call, lines);
  assert.equal(res.body.data.needsDelivery, true);
  const missing = await call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'INVALID_INPUT');
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const quoted = await quote(call, lines, { deliverAt: past });
  assert.equal(quoted.body.data.deliverAtUnavailable, true);
  const refused = await call('POST', '/public/v1/guest/orders', { lines, deliverAt: past, payment: 'note' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'DELIVERY_TIME_UNAVAILABLE');
  const offered = (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines: [{ kind: 'option', id: WOOD }] })).body.data.days[0].slots[0].at;
  const ok = await call('POST', '/public/v1/guest/orders', { lines, deliverAt: offered, payment: 'note' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(db.prepare('SELECT deliverAt FROM guest_orders WHERE id = ?').get(ok.body.data.orderId).deliverAt, new Date(offered).toISOString());
});

withQuote('rule 37: a request of another shape is refused before anything reads it — 400 INVALID_INPUT, never a 500', async ({ call }) => {
  const bad = [
    { lines: [] },
    { lines: [{ kind: 'option', id: CIDER, quantity: 1.5 }] },
    { lines: [{ kind: 'option', id: CIDER, quantity: '2' }] },
    { lines: [{ kind: 'gift', id: CIDER, quantity: 1 }] },
    { lines: [{ kind: 'option', id: CIDER, quantity: 1, price: 0 }] },
    { lines: [{ kind: 'option', id: CIDER, quantity: 1 }, { kind: 'option', id: CIDER, quantity: 2 }] },
    { lines: [{ kind: 'resource', id: BATH, sessions: [{ date: TOMORROW, start: '12:00', end: '11:00' }] }] },
    { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], total: 0 },
    { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], deliverAt: 'demain' },
    [],
  ];
  for (const body of bad) {
    const res = await call('POST', '/public/v1/guest/orders/quote', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'INVALID_INPUT', JSON.stringify(body));
  }
  const payment = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'cash' });
  assert.equal(payment.body.error.code, 'INVALID_INPUT');
});

withQuote('rule 27, §4.3: a pre-arrival session reads the shop but quotes nothing — 403 STAY_REQUIRED', async ({ call }) => {
  const res = await quote(call, [{ kind: 'option', id: CIDER, quantity: 1 }]);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'STAY_REQUIRED');
}, { stay: { start: 3, end: 6 } });

withQuote('edge case: the planning is the truth — a session of an order the operator removed reads « Modifiée par l’équipe »', async ({ stayId, call }) => {
  const placed = await call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'resource', id: BATH, sessions: [slot('20:00', '21:00')] }], payment: 'note' });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.equal((await call('GET', '/public/v1/guest/orders')).body.data.orders[0].notices, undefined);
  db.prepare("UPDATE reservation_resources SET sessions = ? WHERE reservationId = ? AND resourceId = ?").run(JSON.stringify([slot('15:00', '16:00')]), stayId, BATH);
  assert.deepEqual((await call('GET', '/public/v1/guest/orders')).body.data.orders[0].notices, ['Modifiée par l’équipe']);
}, { skip: !hasHourly });
